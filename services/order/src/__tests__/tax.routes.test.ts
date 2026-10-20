import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../repositories/order.repository.js", () => ({
  orderRepository: { findPaidBetween: vi.fn().mockResolvedValue([]) },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

type Role = "admin" | "manager" | "waiter" | "cook" | "cashier" | "customer";
const bearer = (role: Role) => `Bearer ${signAccessToken({ sub: `u-${role}`, username: role, role })}`;

describe("POST /tax/calculate", () => {
  const post = (role: Role, body: object) =>
    request(app).post("/api/v1/tax/calculate").set("Authorization", bearer(role)).send(body);

  it("401 sin token", async () => {
    expect((await request(app).post("/api/v1/tax/calculate").send({})).status).toBe(401);
  });

  it("gerente, cajero y admin calculan; mesero, cocinero y cliente no (403)", async () => {
    for (const role of ["manager", "cashier", "admin"] as const) {
      await post(role, { mode: "add", amountCents: 10000 }).expect(200);
    }
    for (const role of ["waiter", "cook", "customer"] as const) {
      await post(role, { mode: "add", amountCents: 10000 }).expect(403);
    }
  });

  it("la tasa por defecto es 16 % y devuelve base, IVA y total", async () => {
    const res = await post("cashier", { mode: "extract", amountCents: 11600 }).expect(200);
    expect(res.body.data).toEqual({ mode: "extract", ratePercent: 16, baseCents: 10000, ivaCents: 1600, totalCents: 11600 });
  });

  it("422 con tasa inventada, monto cero/negativo/decimal/enorme o modo desconocido", async () => {
    await post("cashier", { mode: "add", amountCents: 10000, ratePercent: 10 }).expect(422);
    await post("cashier", { mode: "add", amountCents: 0 }).expect(422);
    await post("cashier", { mode: "add", amountCents: -5 }).expect(422);
    await post("cashier", { mode: "add", amountCents: 10.5 }).expect(422);
    await post("cashier", { mode: "add", amountCents: 1_000_000_001 }).expect(422);
    await post("cashier", { mode: "restar", amountCents: 100 }).expect(422);
  });
});

describe("GET /tax/report", () => {
  const get = (role: Role, qs: string) =>
    request(app).get(`/api/v1/tax/report${qs}`).set("Authorization", bearer(role));

  it("gerente y cajero ven el reporte; mesero y cliente no (403)", async () => {
    for (const role of ["manager", "cashier"] as const) await get(role, "?from=2030-06-01&to=2030-06-30").expect(200);
    for (const role of ["waiter", "customer"] as const) await get(role, "?from=2030-06-01&to=2030-06-30").expect(403);
  });

  it("422 si faltan fechas, el formato es malo o el rango es inválido", async () => {
    await get("manager", "").expect(422);
    await get("manager", "?from=01-06-2030&to=2030-06-30").expect(422);
    await get("manager", "?from=2030-06-30&to=2030-06-01").expect(422);
  });
});
