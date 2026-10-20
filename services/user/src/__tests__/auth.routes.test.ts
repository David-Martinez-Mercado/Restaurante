import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// El service se simula por completo: esta prueba verifica únicamente
// que routes + controller devuelvan el status y la forma de JSON
// correctos, sin tocar la base de datos.
vi.mock("../services/auth.service.js", () => ({
  authService: {
    login: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
    logout: vi.fn(),
    createUser: vi.fn(),
  },
}));

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-16-chars";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

const { authService } = await import("../services/auth.service.js");
const { app } = await import("../app.js");

describe("POST /api/v1/auth/login", () => {
  it("responde 200 con tokens cuando el service resuelve", async () => {
    vi.mocked(authService.login).mockResolvedValue({
      success: true,
      user: {
        id: "u1",
        username: "jperez",
        email: "j@example.com",
        role: "waiter",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      accessToken: "access.token.here",
      refreshToken: "refresh.token.here",
      expiresIn: 900,
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "jperez", password: "Secreta123" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBe("access.token.here");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("responde 422 con VALIDATION_ERROR cuando faltan campos", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({});

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it("responde 401 INVALID_CREDENTIALS cuando el service rechaza", async () => {
    const { AppError } = await import("@resto/core");
    vi.mocked(authService.login).mockRejectedValue(
      AppError.invalidCredentials()
    );

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: "jperez", password: "mala-clave" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("POST /api/v1/auth/register", () => {
  it("responde 422 si la contraseña no cumple la política", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      username: "jperez",
      email: "jperez@example.com",
      password: "corta",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/auth/users (alta de personal)", () => {
  const body = {
    username: "cocinero1",
    email: "cocinero1@example.com",
    password: "Secreta123",
    role: "cook",
  };

  it("401 sin token", async () => {
    const res = await request(app).post("/api/v1/auth/users").send(body);
    expect(res.status).toBe(401);
  });

  it("403 si quien llama no tiene users:manage (cliente, mesero o gerente)", async () => {
    const { signAccessToken } = await import("@resto/auth");
    for (const role of ["customer", "waiter", "manager"] as const) {
      const token = signAccessToken({ sub: "u1", username: role, role });
      const res = await request(app)
        .post("/api/v1/auth/users")
        .set("Authorization", `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(403);
    }
    expect(authService.createUser).not.toHaveBeenCalled();
  });

  it("201 para un admin", async () => {
    const { signAccessToken } = await import("@resto/auth");
    vi.mocked(authService.createUser).mockResolvedValue({ id: "u9", ...body } as never);
    const token = signAccessToken({ sub: "a1", username: "admin", role: "admin" });
    const res = await request(app)
      .post("/api/v1/auth/users")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
  });

  it("422 si el rol no existe", async () => {
    const { signAccessToken } = await import("@resto/auth");
    const token = signAccessToken({ sub: "a1", username: "admin", role: "admin" });
    const res = await request(app)
      .post("/api/v1/auth/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...body, role: "superhero" });
    expect(res.status).toBe(422);
  });
});

describe("GET /healthz", () => {
  it("responde 200 ok", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
