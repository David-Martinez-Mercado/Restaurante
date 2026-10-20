import { logger } from "./logger.js";

/**
 * Eventos de dominio hacia el Notification Service.
 * Igual que la auditoría, es "fire and forget": que el servicio de avisos
 * esté caído nunca debe romper la operación del usuario (un pedido listo
 * sigue estando listo aunque no llegue el mensaje).
 * Si NOTIFICATION_SERVICE_URL no está definido, no hace nada (útil en pruebas).
 */
export function emitEvent(type: string, payload: Record<string, unknown>): void {
  const url = process.env.NOTIFICATION_SERVICE_URL;
  if (!url) return;

  fetch(`${url.replace(/\/$/, "")}/api/v1/internal/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-key": process.env.INTERNAL_API_KEY ?? "",
    },
    body: JSON.stringify({ type, ...payload }),
    signal: AbortSignal.timeout(3000),
  }).catch((err: unknown) => {
    logger.warn({ err, type }, "No se pudo enviar el evento al servicio de notificaciones");
  });
}
