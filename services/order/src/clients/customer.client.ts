import { AppError } from "@resto/core";
import type { CustomerInternalDTO } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

/** Cliente HTTP interno del Customer Service (ruta protegida con la llave interna). */
export const customerClient = {
  /** null si esa cuenta aún no tiene perfil de cliente. */
  async getByUser(userId: string, requestId: string): Promise<CustomerInternalDTO | null> {
    let res: Response;
    try {
      res = await fetch(`${config.CUSTOMER_SERVICE_URL}/api/v1/internal/customers/by-user/${userId}`, {
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
  },
};
