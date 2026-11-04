import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/invoice.service.js", () => ({
  invoiceService: {
    issue: vi.fn().mockResolvedValue({ id: "i1" }),
    issueFromTelegram: vi.fn().mockResolvedValue({ id: "i2" }),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: "i1" }),
    xml: vi.fn().mockResolvedValue({ xml: "<cfdi:Comprobante/>", filename: "A-1_x.xml" }),
    cancel: vi.fn().mockResolvedValue({ id: "i1" }),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { invoiceService } = await import("../services/invoice.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

type Role = "admin" | "manager" | "waiter" | "cook" | "cashier" | "customer";
const bearer = (role: Role) => `Bearer ${signAccessToken({ sub: `u-${role}`, username: role, role })}`;
const INTERNAL = "test-internal-key-min-16-chars";
const ORDER = "33333333-3333-4333-8333-333333333333";
const INV = "44444444-4444-4444-8444-444444444444";

describe("emitir", () => {
  it("401 sin token", async () => {
    await request(app).post("/api/v1/invoices").send({ orderId: ORDER }).expect(401);
  });

  it("el cliente, el cajero, el gerente y el admin emiten; mesero y cocinero no (403)", async () => {
    for (const role of ["customer", "cashier", "manager", "admin"] as const) {
      await request(app).post("/api/v1/invoices").set("Authorization", bearer(role)).send({ orderId: ORDER }).expect(201);
    }
    for (const role of ["waiter", "cook"] as const) {
      await request(app).post("/api/v1/invoices").set("Authorization", bearer(role)).send({ orderId: ORDER }).expect(403);
    }
  });

  it("solo importa el orderId: los importes y los datos fiscales NUNCA vienen del cliente", async () => {
    await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", bearer("customer"))
      .send({ orderId: ORDER, totalCents: 1, rfc: "AAA010101AAA", receptor: { rfc: "X" } })
      .expect(201);
    expect(invoiceService.issue).toHaveBeenLastCalledWith(ORDER, expect.objectContaining({ userId: "u-customer", role: "customer" }));
  });

  it("422 sin orderId o con un id que no es uuid", async () => {
    await request(app).post("/api/v1/invoices").set("Authorization", bearer("customer")).send({}).expect(422);
    await request(app).post("/api/v1/invoices").set("Authorization", bearer("customer")).send({ orderId: "123" }).expect(422);
  });
});

describe("consultar", () => {
  it("cliente, cajero y gerente listan; mesero y cocinero no (403)", async () => {
    for (const role of ["customer", "cashier", "manager"] as const) {
      await request(app).get("/api/v1/invoices").set("Authorization", bearer(role)).expect(200);
    }
    for (const role of ["waiter", "cook"] as const) {
      await request(app).get("/api/v1/invoices").set("Authorization", bearer(role)).expect(403);
    }
  });

  it("el detalle y el XML solo con un id válido (422 si no)", async () => {
    await request(app).get(`/api/v1/invoices/${INV}`).set("Authorization", bearer("customer")).expect(200);
    await request(app).get("/api/v1/invoices/no-es-uuid").set("Authorization", bearer("customer")).expect(422);
    await request(app).get("/api/v1/invoices/no-es-uuid/xml").set("Authorization", bearer("customer")).expect(422);
  });

  it("el XML se descarga como archivo adjunto con tipo application/xml", async () => {
    const res = await request(app).get(`/api/v1/invoices/${INV}/xml`).set("Authorization", bearer("customer")).expect(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="A-1_x.xml"');
    expect(res.text).toBe("<cfdi:Comprobante/>");
  });
});

describe("cancelar (solo gerencia)", () => {
  it("gerente y admin cancelan; el cajero y el cliente no (403)", async () => {
    for (const role of ["manager", "admin"] as const) {
      await request(app).post(`/api/v1/invoices/${INV}/cancel`).set("Authorization", bearer(role)).send({ reason: "02" }).expect(200);
    }
    for (const role of ["cashier", "customer", "waiter"] as const) {
      await request(app).post(`/api/v1/invoices/${INV}/cancel`).set("Authorization", bearer(role)).send({ reason: "02" }).expect(403);
    }
  });

  it("422 con un motivo que no existe en el catálogo del SAT o sin la sustituta del motivo 01", async () => {
    const post = (b: object) => request(app).post(`/api/v1/invoices/${INV}/cancel`).set("Authorization", bearer("manager")).send(b);
    expect((await post({ reason: "09" })).status).toBe(422);
    expect((await post({})).status).toBe(422);
    expect((await post({ reason: "01" })).status).toBe(422);
    expect((await post({ reason: "01", replacementInvoiceId: INV })).status).toBe(200);
  });
});

describe("ruta interna del bot de Telegram", () => {
  const body = { chatId: "777", orderId: ORDER };

  it("401 sin llave interna; ni el JWT de un admin la sustituye", async () => {
    await request(app).post("/api/v1/internal/invoices/telegram").send(body).expect(401);
    await request(app).post("/api/v1/internal/invoices/telegram").set("Authorization", bearer("admin")).send(body).expect(401);
  });

  it("con la llave interna factura por el chat", async () => {
    await request(app).post("/api/v1/internal/invoices/telegram").set("x-internal-key", INTERNAL).send(body).expect(201);
    expect(invoiceService.issueFromTelegram).toHaveBeenCalledWith("777", ORDER, expect.any(String));
  });

  it("422 con datos incompletos", async () => {
    await request(app).post("/api/v1/internal/invoices/telegram").set("x-internal-key", INTERNAL).send({ chatId: "777" }).expect(422);
  });
});
