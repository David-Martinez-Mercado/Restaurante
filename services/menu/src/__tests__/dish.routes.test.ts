import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// Los services se simulan: aquí se prueba routes + controller + guards
// (autenticación y autorización), sin tocar la base de datos.
vi.mock("../services/dish.service.js", () => ({
  dishService: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setAvailability: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("../services/table.service.js", () => ({
  tableService: {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { dishService } = await import("../services/dish.service.js");
const { app } = await import("../app.js");
const { signAccessToken } = await import("@resto/auth");

const tokenFor = (role: "admin" | "manager" | "waiter" | "cook" | "cashier") =>
  signAccessToken({ sub: "u1", username: `user-${role}`, role });

const validDish = {
  name: "Tacos al pastor",
  priceCents: 8500,
  category: "main",
};

describe("autenticación", () => {
  it("401 sin token", async () => {
    const res = await request(app).get("/api/v1/dishes");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 TOKEN_INVALID con token falso", async () => {
    const res = await request(app)
      .get("/api/v1/dishes")
      .set("Authorization", "Bearer no-es-un-jwt");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("TOKEN_INVALID");
  });
});

describe("autorización por permisos", () => {
  it("un mesero puede leer el menú", async () => {
    const res = await request(app)
      .get("/api/v1/dishes")
      .set("Authorization", `Bearer ${tokenFor("waiter")}`);
    expect(res.status).toBe(200);
  });

  it("un cocinero NO puede crear platillos (403)", async () => {
    const res = await request(app)
      .post("/api/v1/dishes")
      .set("Authorization", `Bearer ${tokenFor("cook")}`)
      .send(validDish);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(dishService.create).not.toHaveBeenCalled();
  });

  it("un cocinero SÍ puede marcar un platillo como agotado", async () => {
    vi.mocked(dishService.setAvailability).mockResolvedValue({} as never);
    const res = await request(app)
      .patch("/api/v1/dishes/8a3c1f1e-0000-4000-8000-000000000001/availability")
      .set("Authorization", `Bearer ${tokenFor("cook")}`)
      .send({ available: false });
    expect(res.status).toBe(200);
  });

  it("un gerente crea un platillo (201)", async () => {
    vi.mocked(dishService.create).mockResolvedValue({ id: "d1", ...validDish } as never);
    const res = await request(app)
      .post("/api/v1/dishes")
      .set("Authorization", `Bearer ${tokenFor("manager")}`)
      .send(validDish);
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe("d1");
  });
});

describe("validación", () => {
  it("422 si el precio no es positivo", async () => {
    const res = await request(app)
      .post("/api/v1/dishes")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ ...validDish, priceCents: -5 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("422 si la categoría del filtro no existe", async () => {
    const res = await request(app)
      .get("/api/v1/dishes?category=pizza")
      .set("Authorization", `Bearer ${tokenFor("admin")}`);
    expect(res.status).toBe(422);
  });
});

describe("GET /readyz", () => {
  it("200 cuando no hay readyCheck registrado", async () => {
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
  });
});
