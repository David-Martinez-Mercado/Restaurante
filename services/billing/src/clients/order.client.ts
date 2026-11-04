import { AppError } from "@resto/core";
import type { OrderDTO } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

/** Cliente HTTP interno del Order Service (ruta protegida con la llave interna). */
export const orderClient = {
  /** null si el pedido no existe. */
  async get(orderId: string, requestId: string): Promise<OrderDTO | null> {
    let res: Response;
    try {
      res = await fetch(`${config.ORDER_SERVICE_URL}/api/v1/internal/orders/${orderId}`, {
        headers: { "x-internal-key": config.INTERNAL_API_KEY, "x-request-id": requestId },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw AppError.serviceUnavailable("Order Service");
    }
    if (res.status === 404) return null;
    if (res.status === 401) logger.error("El Order Service rechazó la llave interna: revisa INTERNAL_API_KEY");
    if (!res.ok) throw AppError.serviceUnavailable("Order Service");
    return ((await res.json()) as { data: OrderDTO }).data;
  },
};
