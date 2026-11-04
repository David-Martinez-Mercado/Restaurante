import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.PROFACT_TOKEN = "token-de-prueba";
process.env.BILLING_TIMEZONE = "America/Mexico_City";

vi.mock("../repositories/invoice.repository.js", () => ({
  invoiceRepository: {
    createPendingIfNone: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn(),
    markIssued: vi.fn(),
    markRejected: vi.fn(),
    markCancelled: vi.fn(),
  },
}));
vi.mock("../clients/order.client.js", () => ({ orderClient: { get: vi.fn() } }));
vi.mock("../clients/customer.client.js", () => ({ customerClient: { getByUser: vi.fn(), getByChat: vi.fn() } }));
vi.mock("../clients/profact.client.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../clients/profact.client.js")>();
  return { ...real, profactClient: { configured: true, timbrar: vi.fn(), cancelar: vi.fn() } };
});
vi.mock("@resto/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@resto/http")>()),
  emitEvent: vi.fn(),
}));

const { emitEvent } = await import("@resto/http");
const { invoiceRepository } = await import("../repositories/invoice.repository.js");
const { orderClient } = await import("../clients/order.client.js");
const { customerClient } = await import("../clients/customer.client.js");
const { profactClient, PacRejected } = await import("../clients/profact.client.js");
const { AppError } = await import("@resto/core");
const { invoiceService } = await import("../services/invoice.service.js");

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const INV = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2030-06-20T18:00:00Z");

const customer = { userId: CUSTOMER, role: "customer" as const, requestId: "r1" };
const other = { userId: OTHER, role: "customer" as const, requestId: "r2" };
const cashier = { userId: "c1", role: "cashier" as const, requestId: "r3" };
const manager = { userId: "m1", role: "manager" as const, requestId: "r4" };

const order = (o: Record<string, unknown> = {}) =>
  ({
    id: ORDER, code: "A1B2C3", customerUserId: CUSTOMER, status: "paid", paymentMethod: "card", paidAt: "2030-06-10T20:00:00Z",
    subtotalCents: 91800, taxCents: 14688, totalCents: 106488,
    items: [
      { id: "i1", dishName: "Rib eye", unitPriceCents: 42900, quantity: 2, lineTotalCents: 85800 },
      { id: "i2", dishName: "Cerveza", unitPriceCents: 6000, quantity: 1, lineTotalCents: 6000 },
    ],
    ...o,
  }) as never;

const profile = (billing: unknown = {
  rfc: "XIA190128J61", businessName: "Xenon Industrial Articles", postalCode: "76343", taxRegime: "601", cfdiUse: "G03",
}) => ({ userId: CUSTOMER, fullName: "Ana", billing }) as never;

const row = (o: Record<string, unknown> = {}) =>
  ({
    id: INV, orderId: ORDER, orderCode: "A1B2C3", customerUserId: CUSTOMER, requestedBy: CUSTOMER, serie: "A", folio: 7, status: "pending",
    emisorRfc: "EKU9003173C9", emisorName: "ESCUELA KEMPER URGATE", emisorRegime: "601", emisorPostalCode: "42501",
    receptorRfc: "XIA190128J61", receptorName: "XENON INDUSTRIAL ARTICLES", receptorPostalCode: "76343", receptorRegime: "601", receptorCfdiUse: "G03",
    concepts: [], subtotalCents: 91800, ivaCents: 14688, totalCents: 106488, paymentForm: "04",
    uuid: null, stampedAt: null, xml: null, selloCfd: null, selloSat: null, noCertificadoSat: null, cadenaOriginal: null, qrBase64: null,
    errorMessage: null, cancelledAt: null, cancelReason: null, cancelMessage: null, cancelledBy: null, createdAt: NOW, updatedAt: NOW, ...o,
  }) as never;

const stamped = {
  uuid: "109cdce9-113d-45f6-ae83-3c2900dac6b2",
  xml: '<cfdi:Comprobante><tfd:TimbreFiscalDigital UUID="109cdce9-113d-45f6-ae83-3c2900dac6b2" SelloCFD="AAA" NoCertificadoSAT="3000" SelloSAT="BBB"/></cfdi:Comprobante>',
  qrBase64: "/9j/",
  cadenaOriginal: "||1.1||",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(orderClient.get).mockResolvedValue(order());
  vi.mocked(customerClient.getByUser).mockResolvedValue(profile());
  vi.mocked(invoiceRepository.createPendingIfNone).mockResolvedValue({ ok: true, invoice: row() });
  vi.mocked(profactClient.timbrar).mockResolvedValue(stamped);
  vi.mocked(invoiceRepository.markIssued).mockImplementation(async (_id, s) => row({ status: "issued", ...s }));
  vi.mocked(invoiceRepository.markRejected).mockResolvedValue(row({ status: "rejected" }));
});

describe("issue · el cliente factura su pedido", () => {
  it("timbra con los datos del PEDIDO y del PERFIL, y devuelve la factura emitida", async () => {
    const dto = await invoiceService.issue(ORDER, customer, NOW);

    const xml = vi.mocked(profactClient.timbrar).mock.calls[0]![0];
    expect(xml).toContain('Serie="A" Folio="7"');
    expect(xml).toContain('SubTotal="918.00"');
    expect(xml).toContain('Total="1064.88"');
    expect(xml).toContain('FormaPago="04"');
    expect(xml).toContain('Rfc="XIA190128J61" Nombre="XENON INDUSTRIAL ARTICLES"');
    expect(xml).toContain('Descripcion="Rib eye"');
    expect(vi.mocked(profactClient.timbrar).mock.calls[0]![1]).toBe(INV);
    expect(dto).toMatchObject({ status: "issued", uuid: stamped.uuid, selloSat: "BBB", noCertificadoSat: "3000", qrBase64: "/9j/" });
  });

  it("reserva el folio con los importes del pedido (nunca de quien pide) y el receptor del perfil", async () => {
    await invoiceService.issue(ORDER, customer, NOW);
    expect(invoiceRepository.createPendingIfNone).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER, customerUserId: CUSTOMER, requestedBy: CUSTOMER, subtotalCents: 91800, ivaCents: 14688, totalCents: 106488,
        paymentForm: "04", receptorRfc: "XIA190128J61", receptorName: "XENON INDUSTRIAL ARTICLES", emisorRfc: "EKU9003173C9",
      }),
      NOW
    );
  });

  it("emite el evento invoice.issued para avisar al cliente", async () => {
    await invoiceService.issue(ORDER, customer, NOW);
    expect(emitEvent).toHaveBeenCalledWith("invoice.issued", {
      invoiceId: INV, orderId: ORDER, orderCode: "A1B2C3", customerUserId: CUSTOMER, folio: "A-7", uuid: stamped.uuid, totalCents: 106488,
    });
  });

  it("el efectivo se factura con la forma de pago 01", async () => {
    vi.mocked(orderClient.get).mockResolvedValue(order({ paymentMethod: "cash" }));
    await invoiceService.issue(ORDER, customer, NOW);
    expect(vi.mocked(profactClient.timbrar).mock.calls[0]![0]).toContain('FormaPago="01"');
  });
});

describe("issue · quién puede y qué se necesita", () => {
  it("un cliente no factura el pedido de otro (404, no se revela)", async () => {
    await expect(invoiceService.issue(ORDER, other, NOW)).rejects.toMatchObject({ statusCode: 404 });
    expect(profactClient.timbrar).not.toHaveBeenCalled();
  });

  it("el personal de caja sí factura por el cliente registrado, con los datos fiscales de ese cliente", async () => {
    await invoiceService.issue(ORDER, cashier, NOW);
    expect(customerClient.getByUser).toHaveBeenCalledWith(CUSTOMER, "r3");
    expect(invoiceRepository.createPendingIfNone).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: "c1", customerUserId: CUSTOMER }), NOW);
  });

  it("404 si el pedido no existe", async () => {
    vi.mocked(orderClient.get).mockResolvedValue(null);
    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("409 si el pedido no es de un cliente registrado (no hay a quién facturar)", async () => {
    vi.mocked(orderClient.get).mockResolvedValue(order({ customerUserId: null }));
    await expect(invoiceService.issue(ORDER, cashier, NOW)).rejects.toThrow(/no está ligado a un cliente registrado/);
  });

  it("409 si aún no está pagado, o está cancelado", async () => {
    for (const status of ["pending", "served", "cancelled"]) {
      vi.mocked(orderClient.get).mockResolvedValue(order({ status, paidAt: null }));
      await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toThrow(/ya esté pagado/);
    }
    expect(profactClient.timbrar).not.toHaveBeenCalled();
  });

  it("409 pasado el mes del consumo", async () => {
    vi.mocked(orderClient.get).mockResolvedValue(order({ paidAt: "2030-05-28T20:00:00Z" }));
    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toThrow(/plazo para facturar/);
  });

  it("409 con instrucciones si el cliente no tiene datos fiscales", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile(null));
    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toThrow(/datos fiscales.*Mi perfil/);
    expect(invoiceRepository.createPendingIfNone).not.toHaveBeenCalled();
  });

  it("409 si el pedido ya tiene factura timbrada o una en curso", async () => {
    vi.mocked(invoiceRepository.createPendingIfNone).mockResolvedValueOnce({ ok: false, reason: "issued", invoice: row({ status: "issued", folio: 5 }) });
    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toThrow(/ya tiene la factura A-5/);

    vi.mocked(invoiceRepository.createPendingIfNone).mockResolvedValueOnce({ ok: false, reason: "in_progress", invoice: row() });
    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toThrow(/Ya se está facturando/);
    expect(profactClient.timbrar).not.toHaveBeenCalled();
  });

  it("503 si el PAC no está configurado, sin reservar folio", async () => {
    (profactClient as { configured: boolean }).configured = false;
    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toMatchObject({ statusCode: 503 });
    expect(invoiceRepository.createPendingIfNone).not.toHaveBeenCalled();
    (profactClient as { configured: boolean }).configured = true;
  });
});

describe("issue · cuando el PAC o el SAT rechazan", () => {
  it("rechazo fiscal (RFC/nombre/régimen): 422 con el mensaje del SAT y la factura queda 'rejected' para poder reintentar", async () => {
    vi.mocked(profactClient.timbrar).mockRejectedValue(new PacRejected("CFDI40147 - El RFC del receptor no existe", 21001, "CFDI40147"));

    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toMatchObject({
      statusCode: 422,
      message: "No se pudo timbrar: CFDI40147 - El RFC del receptor no existe",
    });
    expect(invoiceRepository.markRejected).toHaveBeenCalledWith(INV, "CFDI40147 - El RFC del receptor no existe");
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("si el PAC no responde: 503 y la factura queda 'rejected'", async () => {
    vi.mocked(profactClient.timbrar).mockRejectedValue(AppError.serviceUnavailable("de facturación (Profact)"));
    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toMatchObject({ statusCode: 503 });
    expect(invoiceRepository.markRejected).toHaveBeenCalled();
  });

  it("si ya se timbró pero falla guardarla, NO se marca como rechazada (existe en el SAT) y no se emite aviso", async () => {
    vi.mocked(invoiceRepository.markIssued).mockRejectedValue(new Error("db caída"));
    await expect(invoiceService.issue(ORDER, customer, NOW)).rejects.toThrow("db caída");
    expect(invoiceRepository.markRejected).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

describe("issueFromTelegram", () => {
  it("factura por el cliente cuyo chat está vinculado", async () => {
    vi.mocked(customerClient.getByChat).mockResolvedValue(profile());
    const dto = await invoiceService.issueFromTelegram("777", ORDER, "rt", NOW);
    expect(customerClient.getByChat).toHaveBeenCalledWith("777", "rt");
    expect(dto.status).toBe("issued");
  });

  it("un chat sin vincular, o vinculado a otro cliente, no factura el pedido ajeno", async () => {
    vi.mocked(customerClient.getByChat).mockResolvedValue(null);
    await expect(invoiceService.issueFromTelegram("999", ORDER, "rt", NOW)).rejects.toMatchObject({ statusCode: 404 });

    vi.mocked(customerClient.getByChat).mockResolvedValue({ userId: OTHER } as never);
    await expect(invoiceService.issueFromTelegram("555", ORDER, "rt", NOW)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("consultar", () => {
  it("el cliente ve solo las suyas; el personal con read-all ve todas", async () => {
    vi.mocked(invoiceRepository.findMany).mockResolvedValue([]);
    await invoiceService.list({}, customer);
    expect(invoiceRepository.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ customerUserId: CUSTOMER }));
    await invoiceService.list({ status: "issued" }, cashier);
    expect(vi.mocked(invoiceRepository.findMany).mock.lastCall![0].customerUserId).toBeUndefined();
  });

  it("422 con un estado inexistente", async () => {
    await expect(invoiceService.list({ status: "regalada" }, manager)).rejects.toMatchObject({ statusCode: 422 });
  });

  it("la factura de otro cliente no existe para mí (404), ni su XML", async () => {
    vi.mocked(invoiceRepository.findById).mockResolvedValue(row({ status: "issued", xml: "<x/>" }));
    await expect(invoiceService.get(INV, other)).rejects.toMatchObject({ statusCode: 404 });
    await expect(invoiceService.xml(INV, other)).rejects.toMatchObject({ statusCode: 404 });
    await expect(invoiceService.get(INV, customer)).resolves.toMatchObject({ id: INV, emisor: { rfc: "EKU9003173C9" } });
    await expect(invoiceService.get(INV, cashier)).resolves.toBeTruthy();
  });

  it("el XML lleva un nombre de archivo con folio y UUID; una factura que no se timbró no tiene XML", async () => {
    vi.mocked(invoiceRepository.findById).mockResolvedValue(row({ status: "issued", xml: "<x/>", uuid: "abc" }));
    expect(await invoiceService.xml(INV, customer)).toEqual({ xml: "<x/>", filename: "A-7_abc.xml" });

    vi.mocked(invoiceRepository.findById).mockResolvedValue(row({ status: "rejected" }));
    await expect(invoiceService.xml(INV, customer)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("cancel", () => {
  const issued = (o: Record<string, unknown> = {}) => row({ status: "issued", uuid: "uuid-1", xml: "<x/>", ...o });

  beforeEach(() => {
    vi.mocked(invoiceRepository.findById).mockResolvedValue(issued());
    vi.mocked(profactClient.cancelar).mockResolvedValue({ message: "El comprobante será cancelado", acuseXml: null });
    vi.mocked(invoiceRepository.markCancelled).mockImplementation(async (_id, c) => row({ status: "cancelled", uuid: "uuid-1", cancelReason: c.reason, cancelMessage: c.message }));
  });

  it("cancela ante el SAT con el RFC del emisor TAL COMO SE TIMBRÓ, guarda el motivo y avisa al cliente", async () => {
    const dto = await invoiceService.cancel(INV, { reason: "02" }, manager, NOW);

    expect(profactClient.cancelar).toHaveBeenCalledWith({ rfcEmisor: "EKU9003173C9", uuid: "uuid-1", reason: "02", replacementUuid: undefined });
    expect(invoiceRepository.markCancelled).toHaveBeenCalledWith(INV, { reason: "02", message: "El comprobante será cancelado", by: "m1", at: NOW });
    expect(dto).toMatchObject({ status: "cancelled", cancelReason: "02" });
    expect(emitEvent).toHaveBeenCalledWith("invoice.cancelled", expect.objectContaining({ invoiceId: INV, folio: "A-7", customerUserId: CUSTOMER }));
  });

  it("404 si no existe; 409 si no está vigente (rechazada o ya cancelada)", async () => {
    vi.mocked(invoiceRepository.findById).mockResolvedValueOnce(null);
    await expect(invoiceService.cancel(INV, { reason: "02" }, manager)).rejects.toMatchObject({ statusCode: 404 });

    for (const status of ["rejected", "cancelled", "pending"]) {
      vi.mocked(invoiceRepository.findById).mockResolvedValueOnce(issued({ status }));
      await expect(invoiceService.cancel(INV, { reason: "02" }, manager)).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(profactClient.cancelar).not.toHaveBeenCalled();
  });

  it("motivo 01: manda el UUID de la factura sustituta", async () => {
    const REPL = "55555555-5555-4555-8555-555555555555";
    vi.mocked(invoiceRepository.findById).mockImplementation(async (id) => (id === REPL ? issued({ id: REPL, uuid: "uuid-2" }) : issued()));

    await invoiceService.cancel(INV, { reason: "01", replacementInvoiceId: REPL }, manager, NOW);

    expect(profactClient.cancelar).toHaveBeenCalledWith(expect.objectContaining({ reason: "01", replacementUuid: "uuid-2" }));
  });

  it("motivo 01 con una sustituta inválida (inexistente, la misma, o no vigente) -> 422", async () => {
    const REPL = "55555555-5555-4555-8555-555555555555";
    vi.mocked(invoiceRepository.findById).mockImplementation(async (id) => (id === REPL ? null : issued()));
    await expect(invoiceService.cancel(INV, { reason: "01", replacementInvoiceId: REPL }, manager)).rejects.toMatchObject({ statusCode: 422 });
    await expect(invoiceService.cancel(INV, { reason: "01", replacementInvoiceId: INV }, manager)).rejects.toMatchObject({ statusCode: 422 });

    vi.mocked(invoiceRepository.findById).mockImplementation(async (id) => (id === REPL ? issued({ id: REPL, status: "cancelled", uuid: "u2" }) : issued()));
    await expect(invoiceService.cancel(INV, { reason: "01", replacementInvoiceId: REPL }, manager)).rejects.toMatchObject({ statusCode: 422 });
    expect(profactClient.cancelar).not.toHaveBeenCalled();
  });

  it("si el SAT rechaza la cancelación: 422 con su mensaje y la factura sigue vigente", async () => {
    vi.mocked(profactClient.cancelar).mockRejectedValue(new PacRejected("El CFDI ya fue cancelado", 1, "205"));
    await expect(invoiceService.cancel(INV, { reason: "02" }, manager)).rejects.toMatchObject({ statusCode: 422, message: "No se pudo cancelar: El CFDI ya fue cancelado" });
    expect(invoiceRepository.markCancelled).not.toHaveBeenCalled();
  });

  it("recién timbrada el SAT aún no la conoce: 409 que pide reintentar, y la factura sigue vigente", async () => {
    vi.mocked(profactClient.cancelar).mockRejectedValue(new PacRejected("Documento sin acuse de timbrado.", 1, "0"));
    await expect(invoiceService.cancel(INV, { reason: "02" }, manager)).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("de nuevo en unos minutos") });
    expect(invoiceRepository.markCancelled).not.toHaveBeenCalled();
  });

  it("409 si otra cancelación simultánea se adelantó", async () => {
    vi.mocked(invoiceRepository.markCancelled).mockResolvedValue(null);
    await expect(invoiceService.cancel(INV, { reason: "02" }, manager)).rejects.toMatchObject({ statusCode: 409 });
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
