import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger.js";

/**
 * ACCOUNTING (tercera "A") — cliente de auditoría.
 * Cada servicio reporta qué ocurrió al Audit Service por HTTP. Es "fire and
 * forget": un fallo de auditoría nunca debe romper la petición del usuario.
 * Si AUDIT_SERVICE_URL no está definido, no hace nada (útil en pruebas).
 */
export interface AuditEvent {
  service: string;
  action: string;
  resource: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  statusCode?: number;
  userId?: string;
  username?: string;
  role?: string;
  method?: string;
  path?: string;
  ip?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export function emitAudit(event: AuditEvent): void {
  const url = process.env.AUDIT_SERVICE_URL;
  if (!url) return;

  fetch(`${url.replace(/\/$/, "")}/api/v1/audit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": process.env.INTERNAL_API_KEY ?? "",
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(2000),
  }).catch((err: unknown) => {
    logger.warn({ err, action: event.action }, "No se pudo enviar evento de auditoría");
  });
}

function outcomeFromStatus(status: number): AuditEvent["outcome"] {
  if (status === 401 || status === 403) return "denied";
  return status >= 400 ? "failure" : "success";
}

export interface AuditActor {
  userId?: string;
  username?: string;
  role?: string;
}

/**
 * Middleware de auditoría de ruta. Colocarlo ANTES del guard para que
 * también queden registrados los intentos denegados (401/403).
 * Un controller puede fijar `res.locals.auditActor` (p. ej. en el login,
 * donde todavía no existe req.user).
 */
export function auditAction(service: string, action: string, resource: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      const actor = (res.locals.auditActor as AuditActor | undefined) ?? {};
      emitAudit({
        service,
        action,
        resource,
        resourceId: req.params.id as string | undefined,
        outcome: outcomeFromStatus(res.statusCode),
        statusCode: res.statusCode,
        userId: req.user?.sub ?? actor.userId,
        username: req.user?.username ?? actor.username,
        role: req.user?.role ?? actor.role,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        ip: req.ip,
        requestId: req.requestId,
      });
    });
    next();
  };
}
