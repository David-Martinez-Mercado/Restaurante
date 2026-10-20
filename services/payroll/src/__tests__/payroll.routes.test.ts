import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/payroll.service.js", () => ({
  payrollService: {
    listCompensations: vi.fn().mockResolvedValue([]),
    saveCompensation: vi.fn().mockResolvedValue({ userId: "u" }),
    calculate: vi.fn().mockResolvedValue({ period: "2030-06" }),
    listRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn().mockResolvedValue({ period: "2030-06" }),
    approve: vi.fn().mockResolvedValue({ period: "2030-06" }),
    payslips: vi.fn().mockResolvedValue([]),
    engineStatus: vi.fn().mockResolvedValue({ available: true }),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { payrollService } = await import("../services/payroll.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

type Role = "admin" | "manager" | "waiter" | "cook" | "cashier" | "customer";
const bearer = (role: Role) => `Bearer ${signAccessToken({ sub: `u-${role}`, username: role, role })}`;
const UID = "11111111-1111-4111-8111-111111111111";

describe("recibos propios", () => {
  it("401 sin token y 403 para el cliente", async () => {
    await request(app).get("/api/v1/payroll/me").expect(401);
    await request(app).get("/api/v1/payroll/me").set("Authorization", bearer("customer")).expect(403);
  });

  it("todo el personal ve SOLO sus recibos (el id sale del token)", async () => {
    for (const role of ["admin", "manager", "waiter", "cook", "cashier"] as const) {
      await request(app).get("/api/v1/payroll/me").set("Authorization", bearer(role)).expect(200);
    }
    expect(payrollService.payslips).toHaveBeenLastCalledWith("u-cashier");
  });

  it("'me' no se confunde con un periodo", async () => {
    await request(app).get("/api/v1/payroll/me").set("Authorization", bearer("waiter")).expect(200);
    expect(payrollService.getRun).not.toHaveBeenCalled();
  });
});

describe("sueldos y nóminas: solo gerencia", () => {
  it("mesero, cocinero, cajero y cliente no ven sueldos ni nóminas ajenas (403)", async () => {
    for (const role of ["waiter", "cook", "cashier", "customer"] as const) {
      for (const path of ["/compensations", "/runs", "/runs/2030-06", "/engine"]) {
        await request(app).get(`/api/v1/payroll${path}`).set("Authorization", bearer(role)).expect(403);
      }
    }
  });

  it("gerente y admin consultan", async () => {
    for (const role of ["manager", "admin"] as const) {
      for (const path of ["/compensations", "/runs", "/runs/2030-06", "/engine"]) {
        await request(app).get(`/api/v1/payroll${path}`).set("Authorization", bearer(role)).expect(200);
      }
    }
  });

  const comp = { fullName: "Ana López", position: "Mesera", monthlySalaryCents: 1_200_000, hireDate: "2030-06-01", active: true };

  it("gerente y admin capturan sueldos; los demás no", async () => {
    for (const role of ["manager", "admin"] as const) {
      await request(app).put(`/api/v1/payroll/compensations/${UID}`).set("Authorization", bearer(role)).send(comp).expect(200);
    }
    for (const role of ["waiter", "cashier"] as const) {
      await request(app).put(`/api/v1/payroll/compensations/${UID}`).set("Authorization", bearer(role)).send(comp).expect(403);
    }
  });

  it("422 con sueldo absurdo, nombre corto, fecha mal escrita o userId que no es uuid", async () => {
    const put = (id: string, b: object) => request(app).put(`/api/v1/payroll/compensations/${id}`).set("Authorization", bearer("manager")).send(b);
    expect((await put(UID, { ...comp, monthlySalaryCents: 5 })).status).toBe(422);
    expect((await put(UID, { ...comp, monthlySalaryCents: 99_999_999_999 })).status).toBe(422);
    expect((await put(UID, { ...comp, monthlySalaryCents: 1000.5 })).status).toBe(422);
    expect((await put(UID, { ...comp, fullName: "Al" })).status).toBe(422);
    expect((await put(UID, { ...comp, hireDate: "01/06/2030" })).status).toBe(422);
    expect((await put("no-uuid", comp)).status).toBe(422);
  });
});

describe("calcular y aprobar", () => {
  it("el gerente y el admin calculan; el mesero y el cajero no (403)", async () => {
    for (const role of ["manager", "admin"] as const) {
      await request(app).post("/api/v1/payroll/runs").set("Authorization", bearer(role)).send({ period: "2030-06" }).expect(200);
    }
    for (const role of ["waiter", "cashier", "cook"] as const) {
      await request(app).post("/api/v1/payroll/runs").set("Authorization", bearer(role)).send({ period: "2030-06" }).expect(403);
    }
  });

  it("422 con un periodo mal formado", async () => {
    for (const period of ["2030-13", "2030-6", "junio", ""]) {
      await request(app).post("/api/v1/payroll/runs").set("Authorization", bearer("manager")).send({ period }).expect(422);
    }
    await request(app).post("/api/v1/payroll/runs").set("Authorization", bearer("manager")).send({}).expect(422);
  });

  it("SOLO el administrador aprueba: el gerente no (segregación de funciones)", async () => {
    await request(app).post("/api/v1/payroll/runs/2030-06/approve").set("Authorization", bearer("admin")).expect(200);
    await request(app).post("/api/v1/payroll/runs/2030-06/approve").set("Authorization", bearer("manager")).expect(403);
    await request(app).post("/api/v1/payroll/runs/2030-06/approve").set("Authorization", bearer("cashier")).expect(403);
  });

  it("422 si el periodo de la ruta es inválido", async () => {
    await request(app).post("/api/v1/payroll/runs/2030-99/approve").set("Authorization", bearer("admin")).expect(422);
    await request(app).get("/api/v1/payroll/runs/xx").set("Authorization", bearer("manager")).expect(422);
  });
});
