import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.PAYMENT_WEBHOOK_SECRET = "test-webhook-secret-min-16-chars";

vi.mock("../repositories/payment.repository.js", () => ({
  paymentRepository: {
    getOrCreatePending: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    transition: vi.fn(),
    eventSeen: vi.fn(),
    recordEvent: vi.fn(),
  },
}));
vi.mock("../clients/order.client.js", () => ({ orderClient: { get: vi.fn(), confirmPayment: vi.fn() } }));
vi.mock("../clients/gateway.client.js", () => ({
  gatewayClient: { configured: false, charge: vi.fn() },
  GatewayError: class GatewayError extends Error {},
}));
vi.mock("@resto/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@resto/http")>()),
  emitEvent: vi.fn(),
  emitAudit: vi.fn(),
}));

const { AppError } = await import("@resto/core");
const { emitEvent, emitAudit } = await import("@resto/http");
const { paymentRepository } = await import("../repositories/payment.repository.js");
const { orderClient } = await import("../clients/order.client.js");
const { gatewayClient, GatewayError } = await import("../clients/gateway.client.js");
const { paymentService } = await import("../services/payment.service.js");

const USER = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const PAY = "33333333-3333-4333-8333-333333333333";
const customer = { userId: USER, role: "customer" as const, requestId: "r1" };
const NOW = new Date("2030-06-04T18:00:00Z");

const order = (o: Record<string, unknown> = {}) =>
  ({
    id: ORDER, code: "A-0042", customerUserId: USER, customerName: "Ana López", status: "pending", paidAt: null,
    taxCents: 8000, totalCents: 58000,
    items: [{ id: "i", dishId: "d", dishName: "Ribeye", unitPriceCents: 50000, quantity: 1, lineTotalCents: 50000 }],
    ...o,
  }) as never;

const payment = (o: Record<string, unknown> = {}) =>
  ({
    id: PAY, orderId: ORDER, orderCode: "A-0042", customerUserId: USER, amountCents: 58000, status: "pending", method: null,
    gatewayReference: null, checkoutUrl: null, expiresAt: null, failureReason: null, paidAt: null, requestSnapshot: null,
    createdAt: NOW, updatedAt: NOW, ...o,
  }) as never;

const setGateway = (configured: boolean) => ((gatewayClient as { configured: boolean }).configured = configured);

beforeEach(() => {
  vi.clearAllMocks();
  setGateway(false);
  vi.mocked(orderClient.get).mockResolvedValue(order());
  vi.mocked(paymentRepository.getOrCreatePending).mockResolvedValue({ payment: payment(), created: true });
  vi.mocked(paymentRepository.update).mockImplementation(async (_id, data) => payment(data as Record<string, unknown>));
});

describe("create · el cliente paga su pedido", () => {
  it("el importe sale del PEDIDO, no del cliente", async () => {
    await paymentService.create({ orderId: ORDER }, customer, NOW);

    expect(paymentRepository.getOrCreatePending).toHaveBeenCalledWith(
      { orderId: ORDER, orderCode: "A-0042", customerUserId: USER, amountCents: 58000 },
      NOW
    );
  });

  it("sin pasarela conectada: crea el cobro, NO contacta a nadie y devuelve el cuerpo que se enviaría", async () => {
    const dto = await paymentService.create({ orderId: ORDER }, customer, NOW);

    expect(gatewayClient.charge).not.toHaveBeenCalled();
    expect(dto).toMatchObject({ status: "pending", gatewayConfigured: false, checkoutUrl: null });
    expect(dto.gatewayRequest).toMatchObject({ reference: PAY, amountCents: 58000, currency: "MXN" });
  });

  it("con pasarela: la manda a cobrar y guarda la referencia y la página de pago", async () => {
    setGateway(true);
    vi.mocked(gatewayClient.charge).mockResolvedValue({
      gatewayReference: "gw_123", checkoutUrl: "https://pay.example/checkout/gw_123", expiresAt: "2030-06-04T18:30:00.000Z",
    });

    const dto = await paymentService.create({ orderId: ORDER }, customer, NOW);

    expect(gatewayClient.charge).toHaveBeenCalledWith(expect.objectContaining({ reference: PAY, amountCents: 58000 }));
    expect(dto).toMatchObject({
      checkoutUrl: "https://pay.example/checkout/gw_123", gatewayReference: "gw_123", gatewayConfigured: true, gatewayRequest: null,
    });
    expect(dto.expiresAt).toBe("2030-06-04T18:30:00.000Z");
  });

  it("si la pasarela falla, el cobro se cierra como 'failed' y se responde 503 (el cliente puede reintentar)", async () => {
    setGateway(true);
    vi.mocked(gatewayClient.charge).mockRejectedValue(new GatewayError("La pasarela respondió 500"));

    await expect(paymentService.create({ orderId: ORDER }, customer, NOW)).rejects.toMatchObject({ statusCode: 503 });
    expect(paymentRepository.update).toHaveBeenCalledWith(PAY, expect.objectContaining({ status: "failed", failureReason: "La pasarela respondió 500" }));
  });

  it("si ya hay un cobro pendiente vigente lo devuelve, sin volver a cobrar", async () => {
    setGateway(true);
    vi.mocked(paymentRepository.getOrCreatePending).mockResolvedValue({
      payment: payment({ checkoutUrl: "https://pay.example/c/1", gatewayReference: "gw_1" }),
      created: false,
    });

    const dto = await paymentService.create({ orderId: ORDER }, customer, NOW);

    expect(gatewayClient.charge).not.toHaveBeenCalled();
    expect(dto.checkoutUrl).toBe("https://pay.example/c/1");
  });

  it("404 si el pedido no existe o es de otra persona (no se revela)", async () => {
    vi.mocked(orderClient.get).mockResolvedValue(null);
    await expect(paymentService.create({ orderId: ORDER }, customer, NOW)).rejects.toMatchObject({ statusCode: 404 });

    vi.mocked(orderClient.get).mockResolvedValue(order({ customerUserId: "otro" }));
    await expect(paymentService.create({ orderId: ORDER }, customer, NOW)).rejects.toMatchObject({ statusCode: 404 });

    vi.mocked(orderClient.get).mockResolvedValue(order({ customerUserId: null }));
    await expect(paymentService.create({ orderId: ORDER }, customer, NOW)).rejects.toMatchObject({ statusCode: 404 });
    expect(paymentRepository.getOrCreatePending).not.toHaveBeenCalled();
  });

  it("409 si el pedido ya está pagado o cancelado", async () => {
    vi.mocked(orderClient.get).mockResolvedValue(order({ paidAt: "2030-06-04T17:00:00Z" }));
    await expect(paymentService.create({ orderId: ORDER }, customer, NOW)).rejects.toThrow(/ya está pagado/);

    vi.mocked(orderClient.get).mockResolvedValue(order({ status: "cancelled" }));
    await expect(paymentService.create({ orderId: ORDER }, customer, NOW)).rejects.toThrow(/cancelado/);
  });
});

describe("get / listas", () => {
  it("el cliente solo ve sus pagos (404 si es de otro); caja y gerencia ven todos", async () => {
    vi.mocked(paymentRepository.findById).mockResolvedValue(payment({ customerUserId: "otro" }));
    await expect(paymentService.get(PAY, customer)).rejects.toMatchObject({ statusCode: 404 });
    await expect(paymentService.get(PAY, { userId: "c1", role: "cashier", requestId: "r" })).resolves.toMatchObject({ id: PAY });
  });

  it("la lista del cliente se filtra por su cuenta, y la del personal valida el estado (422)", async () => {
    vi.mocked(paymentRepository.findMany).mockResolvedValue([]);
    await paymentService.listMine(USER, { orderId: ORDER });
    expect(paymentRepository.findMany).toHaveBeenLastCalledWith({ customerUserId: USER, orderId: ORDER });

    await expect(paymentService.listAll({ status: "regalado" })).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("applyWebhook", () => {
  const hook = (o: Record<string, unknown> = {}) =>
    ({
      eventId: "evt_1", type: "payment.succeeded", reference: PAY, gatewayReference: "gw_1", amountCents: 58000, currency: "MXN",
      method: "card", paidAt: new Date("2030-06-04T18:05:00Z"), ...o,
    }) as never;

  beforeEach(() => {
    vi.mocked(paymentRepository.eventSeen).mockResolvedValue(false);
    vi.mocked(paymentRepository.findById).mockResolvedValue(payment());
    vi.mocked(paymentRepository.transition).mockImplementation(async (_id, _from, data) =>
      payment(data as Record<string, unknown>)
    );
    vi.mocked(paymentRepository.recordEvent).mockResolvedValue(true);
    vi.mocked(orderClient.confirmPayment).mockResolvedValue(undefined);
  });

  it("pago exitoso: marca pagado, avisa al pedido y manda la notificación 'payment.confirmed'", async () => {
    expect(await paymentService.applyWebhook(hook(), "r", NOW)).toBe("processed");

    expect(paymentRepository.transition).toHaveBeenCalledWith(
      PAY, ["pending", "failed", "expired"],
      expect.objectContaining({ status: "paid", method: "card", gatewayReference: "gw_1", paidAt: new Date("2030-06-04T18:05:00Z") })
    );
    expect(orderClient.confirmPayment).toHaveBeenCalledWith(ORDER, { paymentId: PAY, paidAt: new Date("2030-06-04T18:05:00Z") }, "r");
    expect(emitEvent).toHaveBeenCalledWith("payment.confirmed", {
      orderId: ORDER, orderCode: "A-0042", customerUserId: USER, amountCents: 58000,
    });
    expect(emitAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "payments.webhook", outcome: "success" }));
  });

  it("el mismo eventId no se procesa dos veces", async () => {
    vi.mocked(paymentRepository.eventSeen).mockResolvedValue(true);

    expect(await paymentService.applyWebhook(hook(), "r", NOW)).toBe("duplicate");
    expect(paymentRepository.transition).not.toHaveBeenCalled();
    expect(orderClient.confirmPayment).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("rechaza (422) un importe distinto al cobro y deja constancia en auditoría", async () => {
    await expect(paymentService.applyWebhook(hook({ amountCents: 100 }), "r", NOW)).rejects.toMatchObject({ statusCode: 422 });

    expect(paymentRepository.transition).not.toHaveBeenCalled();
    expect(orderClient.confirmPayment).not.toHaveBeenCalled();
    expect(emitAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "payments.webhook-amount-mismatch", outcome: "denied" }));
  });

  it("404 si la referencia no es de ningún cobro", async () => {
    vi.mocked(paymentRepository.findById).mockResolvedValue(null);
    await expect(paymentService.applyWebhook(hook(), "r", NOW)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("si el Order Service está caído, falla SIN registrar el evento para que la pasarela reintente", async () => {
    vi.mocked(orderClient.confirmPayment).mockRejectedValue(AppError.serviceUnavailable("Order Service"));

    await expect(paymentService.applyWebhook(hook(), "r", NOW)).rejects.toMatchObject({ statusCode: 503 });
    expect(paymentRepository.recordEvent).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("el reintento tras esa caída (pago ya marcado 'paid') sí sincroniza el pedido", async () => {
    vi.mocked(paymentRepository.findById).mockResolvedValue(payment({ status: "paid", paidAt: new Date("2030-06-04T18:05:00Z") }));

    expect(await paymentService.applyWebhook(hook(), "r", NOW)).toBe("processed");
    expect(paymentRepository.transition).not.toHaveBeenCalled();
    expect(orderClient.confirmPayment).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith("payment.confirmed", expect.any(Object));
  });

  it("si el pedido se canceló antes del pago, el pago queda registrado y se marca 'requiere reembolso'", async () => {
    vi.mocked(orderClient.confirmPayment).mockRejectedValue(AppError.conflict("cancelado"));

    expect(await paymentService.applyWebhook(hook(), "r", NOW)).toBe("processed");
    expect(emitAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "payments.refund-required" }));
    expect(paymentRepository.recordEvent).toHaveBeenCalled();
  });

  it("un pago fallido o vencido lo cierra con su motivo y NO toca el pedido", async () => {
    await paymentService.applyWebhook(hook({ eventId: "e2", type: "payment.failed", failureReason: "Fondos insuficientes" }), "r", NOW);
    expect(paymentRepository.transition).toHaveBeenLastCalledWith(
      PAY, ["pending"], expect.objectContaining({ status: "failed", failureReason: "Fondos insuficientes" })
    );

    await paymentService.applyWebhook(hook({ eventId: "e3", type: "payment.expired" }), "r", NOW);
    expect(paymentRepository.transition).toHaveBeenLastCalledWith(
      PAY, ["pending"], expect.objectContaining({ status: "expired", failureReason: "El cobro venció sin pagarse" })
    );
    expect(orderClient.confirmPayment).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("un aviso de 'falló' sobre un pago ya pagado se ignora (200, sin cambios)", async () => {
    vi.mocked(paymentRepository.findById).mockResolvedValue(payment({ status: "paid" }));

    expect(await paymentService.applyWebhook(hook({ eventId: "e4", type: "payment.failed" }), "r", NOW)).toBe("ignored");
    expect(paymentRepository.transition).not.toHaveBeenCalled();
    expect(paymentRepository.recordEvent).toHaveBeenCalled();
  });
});
