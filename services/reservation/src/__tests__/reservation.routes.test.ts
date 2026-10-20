import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/reservation.service.js", () => ({
  reservationService: {
    create: vi.fn().mockResolvedValue({ id: "r1" }),
    createFromTelegram: vi.fn().mockResolvedValue({ id: "r2" }),
    availability: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: "r1" }),
    changeStatus: vi.fn().mockResolvedValue({ id: "r1" }),
    upcomingForChat: vi.fn().mockResolvedValue([]),
    cancelFromTelegram: vi.fn().mockResolvedValue({ id: "r1" }),
    runReminders: vi.fn().mockResolvedValue(2),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { reservationService } = await import("../services/reservation.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

type Role = "admin" | "manager" | "waiter" | "cook" | "cashier" | "customer";
const bearer = (role: Role) => `Bearer ${signAccessToken({ sub: `u-${role}`, username: role, role })}`;
const INTERNAL = "test-internal-key-min-16-chars";

const body = { reservedFor: new Date(Date.now() + 3 * 86_400_000).toISOString(), partySize: 4 };

describe("seguridad de rutas", () => {
  it("401 sin token", async () => {
    expect((await request(app).get("/api/v1/reservations")).status).toBe(401);
  });

  it("cliente, mesero, gerente y admin reservan; cocinero y cajero no (403)", async () => {
    for (const role of ["customer", "waiter", "manager", "admin"] as const) {
      await request(app).post("/api/v1/reservations").set("Authorization", bearer(role)).send(body).expect(201);
    }
    for (const role of ["cook", "cashier"] as const) {
      await request(app).post("/api/v1/reservations").set("Authorization", bearer(role)).send(body).expect(403);
    }
  });

  it("cliente y personal de sala listan; cocina y caja no (403)", async () => {
    for (const role of ["customer", "waiter", "manager"] as const) {
      await request(app).get("/api/v1/reservations").set("Authorization", bearer(role)).expect(200);
    }
    for (const role of ["cook", "cashier"] as const) {
      await request(app).get("/api/v1/reservations").set("Authorization", bearer(role)).expect(403);
    }
  });

  it("'availability' no se confunde con un :id y exige la fecha", async () => {
    await request(app).get("/api/v1/reservations/availability").set("Authorization", bearer("customer")).expect(422);
    await request(app).get("/api/v1/reservations/availability?date=2030-06-04&partySize=4").set("Authorization", bearer("customer")).expect(200);
    expect(reservationService.availability).toHaveBeenCalledWith("2030-06-04", 4);
    expect(reservationService.get).not.toHaveBeenCalled();
  });

  it("422 con un tamaño de grupo inválido en la disponibilidad", async () => {
    for (const size of ["0", "13", "abc"]) {
      await request(app).get(`/api/v1/reservations/availability?date=2030-06-04&partySize=${size}`).set("Authorization", bearer("customer")).expect(422);
    }
  });

  it("cliente y mesero pueden intentar cambiar el estado; cocina no (403)", async () => {
    await request(app).patch("/api/v1/reservations/r1/status").set("Authorization", bearer("customer")).send({ status: "cancelled" }).expect(200);
    await request(app).patch("/api/v1/reservations/r1/status").set("Authorization", bearer("waiter")).send({ status: "arrived" }).expect(200);
    await request(app).patch("/api/v1/reservations/r1/status").set("Authorization", bearer("cook")).send({ status: "arrived" }).expect(403);
  });
});

describe("validación", () => {
  const post = (b: object) => request(app).post("/api/v1/reservations").set("Authorization", bearer("customer")).send(b);

  it("422 con grupo de 0 o de más de 12, fecha inválida o notas muy largas", async () => {
    expect((await post({ ...body, partySize: 0 })).status).toBe(422);
    expect((await post({ ...body, partySize: 13 })).status).toBe(422);
    expect((await post({ ...body, reservedFor: "mañana" })).status).toBe(422);
    expect((await post({ ...body, notes: "x".repeat(201) })).status).toBe(422);
  });

  it("422 con un estado inexistente, tanto en el filtro como al cambiar", async () => {
    await request(app).get("/api/v1/reservations?status=volando").set("Authorization", bearer("waiter")).expect(422);
    await request(app).patch("/api/v1/reservations/r1/status").set("Authorization", bearer("waiter")).send({ status: "teletransportada" }).expect(422);
  });
});

describe("rutas internas (bot de Telegram y operación)", () => {
  it("401 con un JWT de usuario: ni el de admin sirve", async () => {
    await request(app).post("/api/v1/internal/reminders/run").set("Authorization", bearer("admin")).expect(401);
    await request(app).post("/api/v1/internal/reservations/telegram").set("Authorization", bearer("admin")).send({}).expect(401);
  });

  it("el bot reserva con la llave interna y valida el cuerpo", async () => {
    const post = (b: object) => request(app).post("/api/v1/internal/reservations/telegram").set("x-internal-key", INTERNAL).send(b);
    expect((await post({ reservedFor: body.reservedFor, partySize: 2 })).status).toBe(422); // falta el chat
    expect((await post({ telegramChatId: "777", reservedFor: body.reservedFor, partySize: 2, customerName: "Beto Ruiz" })).status).toBe(201);
    expect(reservationService.createFromTelegram).toHaveBeenCalledWith(expect.objectContaining({ telegramChatId: "777" }), expect.any(String));
  });

  it("consulta y cancela por chat", async () => {
    await request(app).get("/api/v1/internal/reservations/by-chat/777").set("x-internal-key", INTERNAL).expect(200);
    await request(app).post("/api/v1/internal/reservations/telegram/cancel").set("x-internal-key", INTERNAL).send({ chatId: "777", code: "ABC234" }).expect(200);
    await request(app).post("/api/v1/internal/reservations/telegram/cancel").set("x-internal-key", INTERNAL).send({ chatId: "777" }).expect(422);
  });

  it("fuerza el escaneo de recordatorios", async () => {
    const res = await request(app).post("/api/v1/internal/reminders/run").set("x-internal-key", INTERNAL).expect(200);
    expect(res.body.sent).toBe(2);
  });
});
