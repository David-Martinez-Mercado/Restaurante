import { AppError } from "@resto/core";
import type { DishDTO, TableDTO, TableStatus } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

/** Credenciales de quien originó la petición; se reenvían al Menu Service. */
export interface CallContext {
  token: string;
  requestId: string;
}

async function call<T>(
  path: string,
  ctx: CallContext,
  init: { method?: string; body?: unknown } = {}
): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${config.MENU_SERVICE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${ctx.token}`,
        "x-request-id": ctx.requestId,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw AppError.serviceUnavailable("Menu Service");
  }

  if (res.status === 404) return null;
  if (res.status === 401) throw AppError.unauthorized();
  if (res.status === 403) throw AppError.forbidden();
  if (!res.ok) throw AppError.serviceUnavailable("Menu Service");

  return ((await res.json()) as { data: T }).data;
}

/**
 * Cambios de mesa iniciados por el SISTEMA (no por una persona), p. ej. al
 * confirmarse un pago en línea. Usa la ruta interna con llave, sin JWT de usuario.
 */
async function setTableStatusInternal(id: string, status: TableStatus, requestId: string): Promise<void> {
  try {
    const res = await fetch(`${config.MENU_SERVICE_URL}/api/v1/internal/tables/${id}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-internal-key": config.INTERNAL_API_KEY,
        "x-request-id": requestId,
      },
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) logger.warn({ tableId: id, status, code: res.status }, "No se pudo actualizar el estado de la mesa");
  } catch (err) {
    logger.warn({ err, tableId: id, status }, "No se pudo actualizar el estado de la mesa");
  }
}

/** Cliente HTTP del Menu Service: el Order Service no toca su base de datos. */
export const menuClient = {
  setTableStatusInternal,

  getDish: (id: string, ctx: CallContext) =>
    call<DishDTO>(`/api/v1/dishes/${id}`, ctx),

  getTable: (id: string, ctx: CallContext) =>
    call<TableDTO>(`/api/v1/tables/${id}`, ctx),

  /** Mejor esfuerzo: el pedido ya quedó guardado, un fallo aquí solo se registra. */
  async setTableStatus(
    id: string,
    status: TableStatus,
    ctx: CallContext
  ): Promise<void> {
    try {
      await call(`/api/v1/tables/${id}/status`, ctx, {
        method: "PATCH",
        body: { status },
      });
    } catch (err) {
      logger.warn({ err, tableId: id, status }, "No se pudo actualizar el estado de la mesa");
    }
  },
};
