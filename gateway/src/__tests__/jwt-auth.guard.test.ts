import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";

const { JwtAuthGuard } = await import("../auth/jwt-auth.guard");

const SECRET = process.env.JWT_ACCESS_SECRET;
const audit = { emit: vi.fn() };
const guard = new JwtAuthGuard(audit as never);

function contextFor(method: string, path: string, authorization?: string) {
  const req: Record<string, unknown> = {
    method,
    path,
    ip: "127.0.0.1",
    requestId: "req-1",
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? authorization : undefined,
  };
  return {
    req,
    ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never,
  };
}

const sign = (payload: object, options: jwt.SignOptions = { expiresIn: "5m" }) =>
  jwt.sign(payload, SECRET, options);

beforeEach(() => audit.emit.mockClear());

describe("JwtAuthGuard", () => {
  it("deja pasar rutas públicas sin token", () => {
    const { ctx } = contextFor("POST", "/api/v1/auth/login");
    expect(guard.canActivate(ctx)).toBe(true);
    expect(audit.emit).not.toHaveBeenCalled();
  });

  it("rechaza una ruta privada sin token y lo audita como denied", () => {
    const { ctx } = contextFor("GET", "/api/v1/dishes");
    expect(() => guard.canActivate(ctx)).toThrowError();
    expect(audit.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "gateway.auth.denied",
        outcome: "denied",
        path: "/api/v1/dishes",
      })
    );
  });

  it("rechaza un token firmado con otro secreto", () => {
    const forged = jwt.sign({ sub: "u1", type: "access" }, "otro-secreto-distinto-123");
    const { ctx } = contextFor("GET", "/api/v1/dishes", `Bearer ${forged}`);
    expect(() => guard.canActivate(ctx)).toThrowError();
    expect(audit.emit).toHaveBeenCalledOnce();
  });

  it("rechaza un token expirado", () => {
    const expired = sign({ sub: "u1", type: "access" }, { expiresIn: -10 });
    const { ctx } = contextFor("GET", "/api/v1/dishes", `Bearer ${expired}`);
    expect(() => guard.canActivate(ctx)).toThrowError(/expirado/);
  });

  it("rechaza un refresh token usado como token de acceso", () => {
    const refresh = sign({ sub: "u1", jti: "j", type: "refresh" });
    const { ctx } = contextFor("GET", "/api/v1/dishes", `Bearer ${refresh}`);
    expect(() => guard.canActivate(ctx)).toThrowError();
  });

  it("acepta un token de acceso válido y deja las claims en req.user", () => {
    const token = sign({ sub: "u1", username: "ana", role: "waiter", type: "access" });
    const { ctx, req } = contextFor("GET", "/api/v1/dishes", `Bearer ${token}`);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.user).toMatchObject({ sub: "u1", username: "ana", role: "waiter" });
    expect(audit.emit).not.toHaveBeenCalled();
  });
});
