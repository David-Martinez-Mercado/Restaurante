import { AppError } from "@resto/core";
import type { CustomerInternalDTO } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

/** Devuelve null si el Customer Service responde 404; lanza ante cualquier otro fallo. */
async function call(path: string, requestId: string): Promise<CustomerInternalDTO | null> {
  let res: Response;
  try {
    res = await fetch(`${config.CUSTOMER_SERVICE_URL}/api/v1/internal${path}`, {
      headers: { "x-internal-key": config.INTERNAL_API_KEY, "x-request-id": requestId },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw AppError.serviceUnavailable("Customer Service");
  }

  if (res.status === 404) return null;
  if (res.status === 401) {
    logger.error("El Customer Service rechazó la llave interna: revisa INTERNAL_API_KEY");
    throw AppError.serviceUnavailable("Customer Service");
  }
  if (!res.ok) throw AppError.serviceUnavailable("Customer Service");

  return ((await res.json()) as { data: CustomerInternalDTO }).data;
}

/** Cliente HTTP interno del Customer Service: este servicio no toca su base de datos. */
export const customerClient = {
  getByUser: (userId: string, requestId: string) => call(`/customers/by-user/${userId}`, requestId),
  getByChat: (chatId: string, requestId: string) => call(`/customers/by-chat/${chatId}`, requestId),
};
