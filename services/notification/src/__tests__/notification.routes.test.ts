import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/notification.service.js", () => ({
  notificationService: {
    dispatch: vi.fn().mockResolvedValue({ stored: 2 }),
    listMine: vi.fn().mockResolvedValue([]),
    unreadCount: vi.fn().mockResolvedValue(3),
    markRead: vi.fn().mockResolvedValue({ id: "n1" }),
    markAllRead: vi.fn().mockResolvedValue({ updated: 4 }),
    outbox: vi.fn().mockResolvedValue([]),
    telegramInfo: vi.fn().mockResolvedValue({ configured: false, botUsername: null }),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { notificationService } = await import("../services/notification.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

type Role = "admin" | "manager" | "waiter" | "cook" | "cashier" | "customer";
const bearer = (role: Role) => `Bearer ${signAccessToken({ sub: `u-${role}`, username: role, role })}`;
const INTERNAL = "test-internal-key-min-16-chars";

const ORDER = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("campana del cliente", () => {
  it("401 sin token", async () => {
    expect((await request(app).get("/api/v1/notifications/mine")).status).toBe(401);
  });

  it("el cliente lee SOLO los suyos (el id sale del token)", async () => {
    await request(app).get("/api/v1/notifications/mine?unread=true").set("Authorization", bearer("customer")).expect(200);
    expect(notificationService.listMine).toHaveBeenCalledWith("u-customer", true, undefined);
  });

  it("conteo de no leídas, marcar una y marcar todas", async () => {
    const count = await request(app).get("/api/v1/notifications/mine/unread-count").set("Authorization", bearer("customer")).expect(200);
    expect(count.body.data.unread).toBe(3);

    await request(app).patch("/api/v1/notifications/n1/read").set("Authorization", bearer("customer")).expect(200);
    expect(notificationService.markRead).toHaveBeenCalledWith("n1", "u-customer");

    const all = await request(app).post("/api/v1/notifications/mine/read-all").set("Authorization", bearer("customer")).expect(200);
    expect(all.body.data.updated).toBe(4);
  });

  it("'mine' y 'telegram' no se confunden con un :id", async () => {
    await request(app).get("/api/v1/notifications/telegram").set("Authorization", bearer("customer")).expect(200);
    expect(notificationService.outbox).not.toHaveBeenCalled();
  });
});

describe("bitácora de envíos (personal)", () => {
  it("solo el gerente y el admin la ven; el cliente y el mesero no (403)", async () => {
    for (const role of ["manager", "admin"] as const) {
      await request(app).get("/api/v1/notifications").set("Authorization", bearer(role)).expect(200);
    }
    for (const role of ["customer", "waiter", "cook"] as const) {
      await request(app).get("/api/v1/notifications").set("Authorization", bearer(role)).expect(403);
    }
  });

  it("pasa los filtros al servicio", async () => {
    await request(app).get("/api/v1/notifications?delivery=failed&channel=telegram&limit=20").set("Authorization", bearer("manager")).expect(200);
    expect(notificationService.outbox).toHaveBeenLastCalledWith({ type: undefined, channel: "telegram", delivery: "failed", limit: 20 });
  });
});

describe("entrada de eventos (interna)", () => {
  const event = { type: "order.ready", orderId: ORDER, orderCode: "A-0042", customerUserId: USER };
  const post = () => request(app).post("/api/v1/internal/events");

  it("401 sin llave interna, y ni el JWT de un admin la sustituye", async () => {
    await post().send(event).expect(401);
    await post().set("Authorization", bearer("admin")).send(event).expect(401);
    await post().set("x-internal-key", "otra-llave-equivocada-123").send(event).expect(401);
  });

  it("acepta un evento válido con 202", async () => {
    const res = await post().set("x-internal-key", INTERNAL).send(event).expect(202);
    expect(res.body.data.stored).toBe(2);
    expect(notificationService.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "order.ready", orderCode: "A-0042" }));
  });

  it("422 con un tipo desconocido o con datos faltantes", async () => {
    await post().set("x-internal-key", INTERNAL).send({ ...event, type: "order.exploded" }).expect(422);
    await post().set("x-internal-key", INTERNAL).send({ type: "order.ready", orderId: ORDER }).expect(422);
    await post().set("x-internal-key", INTERNAL).send({ ...event, customerUserId: "no-es-uuid" }).expect(422);
  });

  it("valida el resumen de consumo (al menos un platillo)", async () => {
    const paid = {
      type: "order.paid", orderId: ORDER, orderCode: "A-1", customerUserId: USER, items: [],
      subtotalCents: 0, taxCents: 0, totalCents: 0, paymentMethod: "cash", channel: "dine_in",
    };
    await post().set("x-internal-key", INTERNAL).send(paid).expect(422);
    await post()
      .set("x-internal-key", INTERNAL)
      .send({ ...paid, items: [{ name: "Ribeye", quantity: 1, lineTotalCents: 54000 }] })
      .expect(202);
  });
});
