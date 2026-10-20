import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/attendance.service.js", () => ({
  attendanceService: {
    clockIn: vi.fn().mockResolvedValue({ id: "r1" }),
    clockOut: vi.fn().mockResolvedValue({ id: "r1" }),
    status: vi.fn().mockResolvedValue({ open: null, todayMinutes: 0, stale: false }),
    listMine: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    summary: vi.fn().mockResolvedValue({ period: "2030-06", rules: {}, rows: [] }),
    summaryOf: vi.fn().mockResolvedValue({ userId: "u" }),
    manualCreate: vi.fn().mockResolvedValue({ id: "m1" }),
    edit: vi.fn().mockResolvedValue({ id: "r1" }),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { attendanceService } = await import("../services/attendance.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

type Role = "admin" | "manager" | "waiter" | "cook" | "cashier" | "customer";
const bearer = (role: Role) => `Bearer ${signAccessToken({ sub: `u-${role}`, username: role, role })}`;
const INTERNAL = "test-internal-key-min-16-chars";
const UID = "11111111-1111-4111-8111-111111111111";

describe("checar (cualquier trabajador, nunca un cliente)", () => {
  it("401 sin token", async () => {
    expect((await request(app).post("/api/v1/attendance/clock-in")).status).toBe(401);
  });

  it("todo el personal checa; el cliente no (403)", async () => {
    for (const role of ["admin", "manager", "waiter", "cook", "cashier"] as const) {
      await request(app).post("/api/v1/attendance/clock-in").set("Authorization", bearer(role)).expect(201);
      await request(app).post("/api/v1/attendance/clock-out").set("Authorization", bearer(role)).expect(200);
    }
    await request(app).post("/api/v1/attendance/clock-in").set("Authorization", bearer("customer")).expect(403);
  });

  it("la identidad sale del token: no se puede checar por otra persona", async () => {
    await request(app).post("/api/v1/attendance/clock-in").set("Authorization", bearer("waiter")).send({ userId: UID, username: "otro" }).expect(201);
    expect(attendanceService.clockIn).toHaveBeenLastCalledWith({ userId: "u-waiter", username: "waiter", role: "waiter" });
  });

  it("'me' no se confunde con un :id y estado/historial son del propio usuario", async () => {
    await request(app).get("/api/v1/attendance/me/status").set("Authorization", bearer("cook")).expect(200);
    await request(app).get("/api/v1/attendance/me").set("Authorization", bearer("cook")).expect(200);
    expect(attendanceService.listMine).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-cook" }), expect.any(Date), expect.any(Date));
  });

  it("422 con un periodo inválido en mi resumen", async () => {
    await request(app).get("/api/v1/attendance/me/summary?period=2030-13").set("Authorization", bearer("cook")).expect(422);
    await request(app).get("/api/v1/attendance/me/summary?period=2030-06").set("Authorization", bearer("cook")).expect(200);
  });
});

describe("gerencia", () => {
  it("solo gerente y admin ven a todos; mesero, cocinero y cajero no (403)", async () => {
    for (const role of ["manager", "admin"] as const) {
      await request(app).get("/api/v1/attendance").set("Authorization", bearer(role)).expect(200);
      await request(app).get("/api/v1/attendance/summary?period=2030-06").set("Authorization", bearer(role)).expect(200);
    }
    for (const role of ["waiter", "cook", "cashier"] as const) {
      await request(app).get("/api/v1/attendance").set("Authorization", bearer(role)).expect(403);
      await request(app).get("/api/v1/attendance/summary?period=2030-06").set("Authorization", bearer(role)).expect(403);
    }
  });

  it("422 con rango inválido o userId que no es uuid", async () => {
    await request(app).get("/api/v1/attendance?from=2030-06-10&to=2030-06-01").set("Authorization", bearer("manager")).expect(422);
    await request(app).get("/api/v1/attendance?userId=123").set("Authorization", bearer("manager")).expect(422);
  });

  const manual = { userId: UID, username: "ana", clockIn: "2030-06-10T09:00:00", clockOut: "2030-06-10T17:00:00", note: "Olvidó checar" };

  it("solo el gerente captura y corrige a mano; el mesero no (403)", async () => {
    await request(app).post("/api/v1/attendance/manual").set("Authorization", bearer("manager")).send(manual).expect(201);
    await request(app).patch("/api/v1/attendance/r1").set("Authorization", bearer("manager")).send({ note: "Salió a las 6", clockOut: "2030-06-10T18:00:00" }).expect(200);
    await request(app).post("/api/v1/attendance/manual").set("Authorization", bearer("waiter")).send(manual).expect(403);
    await request(app).patch("/api/v1/attendance/r1").set("Authorization", bearer("cashier")).send({ note: "motivo" }).expect(403);
  });

  it("422 si falta el motivo, si la salida es anterior a la entrada o si faltan datos", async () => {
    const post = (b: object) => request(app).post("/api/v1/attendance/manual").set("Authorization", bearer("manager")).send(b);
    expect((await post({ ...manual, note: "" })).status).toBe(422);
    expect((await post({ ...manual, note: "ab" })).status).toBe(422);
    expect((await post({ ...manual, clockOut: "2030-06-10T08:00:00" })).status).toBe(422);
    expect((await post({ ...manual, userId: "no-uuid" })).status).toBe(422);
    await request(app).patch("/api/v1/attendance/r1").set("Authorization", bearer("manager")).send({ clockOut: "2030-06-10T18:00:00" }).expect(422);
  });
});

describe("ruta interna del resumen (Payroll Service)", () => {
  const q = `?period=2030-06&userId=${UID}&since=2030-06-01`;

  it("401 con JWT de usuario (ni el de admin sirve) y 401 sin llave", async () => {
    await request(app).get(`/api/v1/internal/summary${q}`).set("Authorization", bearer("admin")).expect(401);
    await request(app).get(`/api/v1/internal/summary${q}`).expect(401);
  });

  it("con llave interna devuelve el resumen y pasa la fecha de ingreso", async () => {
    await request(app).get(`/api/v1/internal/summary${q}`).set("x-internal-key", INTERNAL).expect(200);
    expect(attendanceService.summaryOf).toHaveBeenLastCalledWith(UID, "", "2030-06", "2030-06-01");
  });

  it("422 si falta el periodo o el usuario", async () => {
    await request(app).get("/api/v1/internal/summary?period=2030-06").set("x-internal-key", INTERNAL).expect(422);
  });
});
