import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../services/audit.service.js", () => ({
  auditService: {
    record: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 }),
    summary: vi.fn().mockResolvedValue({
      total: 0,
      byOutcome: {},
      byAction: [],
      byUser: [],
    }),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { auditService } = await import("../services/audit.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

const event = {
  service: "menu-service",
  action: "dishes.create",
  resource: "dish",
  outcome: "success",
  username: "ana",
};

describe("POST /api/v1/audit (ingesta interna)", () => {
  it("401 sin llave interna", async () => {
    const res = await request(app).post("/api/v1/audit").send(event);
    expect(res.status).toBe(401);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it("401 con un JWT de usuario en lugar de la llave interna", async () => {
    const token = signAccessToken({ sub: "u1", username: "ana", role: "admin" });
    const res = await request(app)
      .post("/api/v1/audit")
      .set("Authorization", `Bearer ${token}`)
      .send(event);
    expect(res.status).toBe(401);
  });

  it("202 con llave interna válida", async () => {
    const res = await request(app)
      .post("/api/v1/audit")
      .set("x-internal-key", "test-internal-key-min-16-chars")
      .send(event);
    expect(res.status).toBe(202);
    expect(auditService.record).toHaveBeenCalledOnce();
  });

  it("422 con un evento mal formado", async () => {
    const res = await request(app)
      .post("/api/v1/audit")
      .set("x-internal-key", "test-internal-key-min-16-chars")
      .send({ service: "x" });
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/audit (consulta)", () => {
  it("403 para un mesero: no tiene audit:read", async () => {
    const token = signAccessToken({ sub: "u2", username: "luis", role: "waiter" });
    const res = await request(app)
      .get("/api/v1/audit")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("200 para un gerente", async () => {
    const token = signAccessToken({ sub: "u3", username: "mar", role: "manager" });
    const res = await request(app)
      .get("/api/v1/audit?outcome=denied&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("422 con un filtro de resultado inválido", async () => {
    const token = signAccessToken({ sub: "u3", username: "mar", role: "manager" });
    const res = await request(app)
      .get("/api/v1/audit?outcome=quizas")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(422);
  });
});
