import { describe, expect, it } from "vitest";
import { extraForwardedHeaders, isPublic, matchRoute } from "../routing";

describe("matchRoute", () => {
  it.each([
    ["/api/v1/auth/login", "user"],
    ["/api/v1/auth/me", "user"],
    ["/api/v1/dishes", "menu"],
    ["/api/v1/dishes/abc/availability", "menu"],
    ["/api/v1/tables/abc/status", "menu"],
    ["/api/v1/orders/abc/status", "order"],
    ["/api/v1/audit/summary", "audit"],
    ["/api/v1/customers/me", "customer"],
    ["/api/v1/customers/me/telegram-link", "customer"],
    ["/api/v1/reservations/availability", "reservation"],
    ["/api/v1/reservations/abc/status", "reservation"],
    ["/api/v1/notifications/mine", "notification"],
    ["/api/v1/payments", "payment"],
    ["/api/v1/payments/webhook", "payment"],
    ["/api/v1/tax/calculate", "order"],
    ["/api/v1/tax/report", "order"],
    ["/api/v1/attendance/clock-in", "attendance"],
    ["/api/v1/attendance/me/status", "attendance"],
    ["/api/v1/payroll/runs", "payroll"],
    ["/api/v1/payroll/me", "payroll"],
  ])("%s -> %s", (path, service) => {
    expect(matchRoute(path)?.service).toBe(service);
  });

  it("las rutas internas NO se publican: ningún prefijo las alcanza", () => {
    for (const path of [
      "/api/v1/internal/events",
      "/api/v1/internal/orders/abc/payment-confirmed",
      "/api/v1/internal/customers/by-user/abc",
      "/api/v1/internal/reminders/run",
    ]) {
      expect(matchRoute(path)).toBeNull();
    }
  });

  it("no confunde prefijos nuevos parecidos", () => {
    expect(matchRoute("/api/v1/paymentsX")).toBeNull();
    expect(matchRoute("/api/v1/customersX/me")).toBeNull();
    expect(matchRoute("/api/v1/reservation")).toBeNull();
    expect(matchRoute("/api/v1/taxes")).toBeNull();
    expect(matchRoute("/api/v1/payrolls")).toBeNull();
    expect(matchRoute("/api/v1/attendances")).toBeNull();
  });

  it("no confunde prefijos parecidos", () => {
    expect(matchRoute("/api/v1/dishesX")).toBeNull();
    expect(matchRoute("/api/v1/authz/login")).toBeNull();
  });

  it("rutas desconocidas no coinciden", () => {
    expect(matchRoute("/api/v1/secret")).toBeNull();
  });

  it("la auditoría solo admite GET desde el exterior", () => {
    expect(matchRoute("/api/v1/audit")?.methods).toEqual(["GET"]);
  });
});

describe("isPublic", () => {
  it("el flujo de login es público", () => {
    expect(isPublic("POST", "/api/v1/auth/login")).toBe(true);
    expect(isPublic("POST", "/api/v1/auth/register")).toBe(true);
    expect(isPublic("POST", "/api/v1/auth/refresh-token")).toBe(true);
  });

  it("tolera barra final y distingue el método", () => {
    expect(isPublic("POST", "/api/v1/auth/login/")).toBe(true);
    expect(isPublic("GET", "/api/v1/auth/login")).toBe(false);
  });

  it("todo lo demás es privado", () => {
    expect(isPublic("GET", "/api/v1/auth/me")).toBe(false);
    expect(isPublic("GET", "/api/v1/auth/users")).toBe(false);
    expect(isPublic("GET", "/api/v1/dishes")).toBe(false);
  });

  it("el webhook de la pasarela es público SOLO por POST (se autentica con su firma)", () => {
    expect(isPublic("POST", "/api/v1/payments/webhook")).toBe(true);
    expect(isPublic("POST", "/api/v1/payments/webhook/")).toBe(true);
    expect(isPublic("GET", "/api/v1/payments/webhook")).toBe(false);
  });

  it("el resto de los pagos y las rutas nuevas siguen siendo privadas", () => {
    expect(isPublic("POST", "/api/v1/payments")).toBe(false);
    expect(isPublic("GET", "/api/v1/payments/mine")).toBe(false);
    expect(isPublic("GET", "/api/v1/notifications/mine")).toBe(false);
    expect(isPublic("POST", "/api/v1/reservations")).toBe(false);
    expect(isPublic("GET", "/api/v1/customers/me")).toBe(false);
    expect(isPublic("POST", "/api/v1/internal/events")).toBe(false);
    expect(isPublic("POST", "/api/v1/attendance/clock-in")).toBe(false);
    expect(isPublic("GET", "/api/v1/payroll/me")).toBe(false);
    expect(isPublic("POST", "/api/v1/tax/calculate")).toBe(false);
  });

  it("las sondas de salud son públicas", () => {
    expect(isPublic("GET", "/healthz")).toBe(true);
    expect(isPublic("GET", "/api/v1/gateway/health")).toBe(true);
  });
});

describe("extraForwardedHeaders", () => {
  it("la firma cruza el gateway solo en el webhook de pagos", () => {
    expect(extraForwardedHeaders("/api/v1/payments/webhook")).toEqual(["x-signature"]);
    expect(extraForwardedHeaders("/api/v1/payments/webhook/")).toEqual(["x-signature"]);
    expect(extraForwardedHeaders("/api/v1/payments")).toEqual([]);
    expect(extraForwardedHeaders("/api/v1/orders")).toEqual([]);
  });
});
