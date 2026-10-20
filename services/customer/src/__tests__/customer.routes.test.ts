import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/customer.service.js", () => ({
  customerService: {
    getMine: vi.fn().mockResolvedValue({ id: "c1" }),
    upsertMine: vi.fn().mockResolvedValue({ id: "c1" }),
    createLinkCode: vi.fn().mockResolvedValue({ code: "ABC234", expiresAt: "" }),
    unlinkTelegram: vi.fn().mockResolvedValue({ id: "c1" }),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: "c1" }),
    getByUserInternal: vi.fn().mockResolvedValue({ id: "c1" }),
    getByChatInternal: vi.fn().mockResolvedValue({ id: "c1" }),
    linkTelegram: vi.fn().mockResolvedValue({ id: "c1" }),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { customerService } = await import("../services/customer.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

type Role = "admin" | "manager" | "waiter" | "cook" | "cashier" | "customer";
const bearer = (role: Role) => `Bearer ${signAccessToken({ sub: `u-${role}`, username: role, role })}`;
const INTERNAL = "test-internal-key-min-16-chars";

const profile = { fullName: "Ana López", phone: "5512345678" };

describe("perfil propio (solo clientes)", () => {
  it("401 sin token", async () => {
    expect((await request(app).get("/api/v1/customers/me")).status).toBe(401);
  });

  it("el personal NO usa /me (403): no tiene perfil de cliente", async () => {
    for (const role of ["waiter", "cook", "cashier", "manager"] as const) {
      await request(app).get("/api/v1/customers/me").set("Authorization", bearer(role)).expect(403);
    }
  });

  it("el cliente lee y guarda SU perfil; el servicio recibe SU userId", async () => {
    await request(app).get("/api/v1/customers/me").set("Authorization", bearer("customer")).expect(200);
    expect(customerService.getMine).toHaveBeenCalledWith("u-customer");

    await request(app).put("/api/v1/customers/me").set("Authorization", bearer("customer")).send(profile).expect(200);
    expect(customerService.upsertMine).toHaveBeenCalledWith("u-customer", expect.objectContaining({ phone: "5512345678" }));
  });

  it("/me no se confunde con un :id", async () => {
    await request(app).get("/api/v1/customers/me").set("Authorization", bearer("customer")).expect(200);
    expect(customerService.get).not.toHaveBeenCalled();
  });

  it("genera el código de Telegram y desvincula", async () => {
    await request(app).post("/api/v1/customers/me/telegram-link").set("Authorization", bearer("customer")).expect(200);
    await request(app).delete("/api/v1/customers/me/telegram").set("Authorization", bearer("customer")).expect(200);
    expect(customerService.createLinkCode).toHaveBeenCalledWith("u-customer");
  });
});

describe("validación del perfil", () => {
  const put = (b: object) => request(app).put("/api/v1/customers/me").set("Authorization", bearer("customer")).send(b);

  it("422 con teléfono o nombre inválidos", async () => {
    expect((await put({ ...profile, phone: "123" })).status).toBe(422);
    expect((await put({ ...profile, fullName: "A" })).status).toBe(422);
  });

  it("422 con datos fiscales mal formados; 200 con datos válidos", async () => {
    const billing = { rfc: "LOPA900101AB1", businessName: "Ana López", postalCode: "06600", taxRegime: "612", cfdiUse: "G03" };
    expect((await put({ ...profile, billing: { ...billing, rfc: "XX" } })).status).toBe(422);
    expect((await put({ ...profile, billing: { ...billing, postalCode: "6600" } })).status).toBe(422);
    expect((await put({ ...profile, billing: { ...billing, cfdiUse: "99" } })).status).toBe(422);
    expect((await put({ ...profile, billing: { ...billing, rfc: "lopa900101ab1" } })).status).toBe(200);
    expect(vi.mocked(customerService.upsertMine).mock.lastCall![1].billing?.rfc).toBe("LOPA900101AB1");
  });
});

describe("búsqueda del personal", () => {
  it("el cliente NO puede listar clientes (403); mesero y gerente sí", async () => {
    await request(app).get("/api/v1/customers").set("Authorization", bearer("customer")).expect(403);
    await request(app).get("/api/v1/customers").set("Authorization", bearer("waiter")).expect(200);
    await request(app).get("/api/v1/customers").set("Authorization", bearer("manager")).expect(200);
    await request(app).get("/api/v1/customers").set("Authorization", bearer("cook")).expect(403);
  });
});

describe("rutas internas (servicio a servicio)", () => {
  it("401 con un JWT de usuario: ni el de admin sirve", async () => {
    await request(app).get("/api/v1/internal/customers/by-user/u1").set("Authorization", bearer("admin")).expect(401);
  });

  it("200 con la llave interna", async () => {
    await request(app).get("/api/v1/internal/customers/by-user/u1").set("x-internal-key", INTERNAL).expect(200);
    await request(app).get("/api/v1/internal/customers/by-chat/777").set("x-internal-key", INTERNAL).expect(200);
  });

  it("vincular exige código de 6 caracteres y chat (422 si no)", async () => {
    const post = (b: object) => request(app).post("/api/v1/internal/telegram/link").set("x-internal-key", INTERNAL).send(b);
    expect((await post({ code: "abc", chatId: "1" })).status).toBe(422);
    expect((await post({ code: "abc234" })).status).toBe(422);
    expect((await post({ code: "abc234", chatId: "777", username: "ana" })).status).toBe(200);
    expect(customerService.linkTelegram).toHaveBeenCalledWith({ code: "ABC234", chatId: "777", username: "ana" });
  });
});
