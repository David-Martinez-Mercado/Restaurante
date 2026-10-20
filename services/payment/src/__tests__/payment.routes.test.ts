import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/payment.service.js", () => ({
  paymentService: {
    create: vi.fn().mockResolvedValue({ id: "p1" }),
    get: vi.fn().mockResolvedValue({ id: "p1" }),
    listMine: vi.fn().mockResolvedValue([]),
    listAll: vi.fn().mockResolvedValue([]),
    applyWebhook: vi.fn().mockResolvedValue("processed"),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.PAYMENT_WEBHOOK_SECRET = "test-webhook-secret-min-16-chars";

const { paymentService } = await import("../services/payment.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");
const { signBody } = await import("../domain/payment.js");

type Role = "admin" | "manager" | "waiter" | "cook" | "cashier" | "customer";
const bearer = (role: Role) => `Bearer ${signAccessToken({ sub: `u-${role}`, username: role, role })}`;
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET!;

const ORDER = "22222222-2222-4222-8222-222222222222";
const PAY = "33333333-3333-4333-8333-333333333333";

describe("cobros del cliente", () => {
  it("401 sin token", async () => {
    await request(app).post("/api/v1/payments").send({ orderId: ORDER }).expect(401);
  });

  it("solo el cliente crea cobros (el personal de sala y caja no paga por el cliente)", async () => {
    await request(app).post("/api/v1/payments").set("Authorization", bearer("customer")).send({ orderId: ORDER }).expect(201);
    // El admin tiene todos los permisos, pero el servicio solo cobra pedidos de quien lo pide (404 si no es suyo).
    for (const role of ["waiter", "cashier", "manager", "cook"] as const) {
      await request(app).post("/api/v1/payments").set("Authorization", bearer(role)).send({ orderId: ORDER }).expect(403);
    }
  });

  it("422 sin orderId o con un id que no es uuid", async () => {
    await request(app).post("/api/v1/payments").set("Authorization", bearer("customer")).send({}).expect(422);
    await request(app).post("/api/v1/payments").set("Authorization", bearer("customer")).send({ orderId: "123" }).expect(422);
  });

  it("el cliente NO puede fijar el importe: se ignora lo que mande", async () => {
    await request(app).post("/api/v1/payments").set("Authorization", bearer("customer")).send({ orderId: ORDER, amountCents: 1 }).expect(201);
    expect(paymentService.create).toHaveBeenLastCalledWith({ orderId: ORDER }, expect.any(Object));
  });

  it("'mine' no se confunde con un :id", async () => {
    await request(app).get("/api/v1/payments/mine").set("Authorization", bearer("customer")).expect(200);
    expect(paymentService.get).not.toHaveBeenCalled();
  });

  it("caja y gerencia ven todos los pagos; el cliente y el mesero no (403)", async () => {
    for (const role of ["cashier", "manager"] as const) {
      await request(app).get("/api/v1/payments").set("Authorization", bearer(role)).expect(200);
    }
    for (const role of ["customer", "waiter"] as const) {
      await request(app).get("/api/v1/payments").set("Authorization", bearer(role)).expect(403);
    }
  });
});

describe("webhook de la pasarela", () => {
  const payload = {
    eventId: "evt_1", type: "payment.succeeded", reference: PAY, gatewayReference: "gw_1", amountCents: 58000, currency: "MXN", method: "card",
  };
  const send = (body: unknown, headers: Record<string, string> = {}) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return request(app).post("/api/v1/payments/webhook").set("content-type", "application/json").set(headers).send(raw);
  };
  const signed = (body: unknown) => ({ "x-signature": signBody(SECRET, JSON.stringify(body)) });

  it("acepta un aviso con firma válida (sin JWT) y lo procesa", async () => {
    const res = await send(payload, signed(payload)).expect(200);
    expect(res.body.data).toEqual({ received: true, outcome: "processed" });
    expect(paymentService.applyWebhook).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_1", reference: PAY }), expect.any(String));
  });

  it("401 sin firma, con firma de otro secreto o con el cuerpo alterado", async () => {
    vi.mocked(paymentService.applyWebhook).mockClear();

    await send(payload).expect(401);
    await send(payload, { "x-signature": signBody("otro-secreto-distinto-1234567", JSON.stringify(payload)) }).expect(401);
    await send({ ...payload, amountCents: 1 }, signed(payload)).expect(401);
    await send(payload, { authorization: bearer("admin") }).expect(401);

    expect(paymentService.applyWebhook).not.toHaveBeenCalled();
  });

  it("422 con firma válida pero cuerpo que no cumple el contrato", async () => {
    const bad = { ...payload, currency: "USD" };
    await send(bad, signed(bad)).expect(422);
    const noRef = { ...payload, reference: "no-uuid" };
    await send(noRef, signed(noRef)).expect(422);
    const noType = { ...payload, type: "payment.refunded" };
    await send(noType, signed(noType)).expect(422);
  });

  it("la firma se calcula sobre los bytes originales: el mismo JSON con otros espacios necesita su propia firma", async () => {
    const pretty = JSON.stringify(payload, null, 2);
    await send(pretty, signed(payload)).expect(401);
    await send(pretty, { "x-signature": signBody(SECRET, pretty) }).expect(200);
  });
});
