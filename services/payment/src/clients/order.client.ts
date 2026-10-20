import { AppError } from "@resto/core";
import type { OrderDTO } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

async function call(path: string, requestId: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${config.ORDER_SERVICE_URL}/api/v1/internal${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-internal-key": config.INTERNAL_API_KEY, "x-request-id": requestId },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw AppError.serviceUnavailable("Order Service");
  }
  if (res.status === 401) {
    logger.error("El Order Service rechazó la llave interna: revisa INTERNAL_API_KEY");
    throw AppError.serviceUnavailable("Order Service");
  }
  return res;
}

/** Cliente HTTP interno del Order Service (rutas protegidas con la llave interna). */
export const orderClient = {
  /** null si el pedido no existe. */
  async get(orderId: string, requestId: string): Promise<OrderDTO | null> {
    const res = await call(`/orders/${orderId}`, requestId);
    if (res.status === 404) return null;
    if (!res.ok) throw AppError.serviceUnavailable("Order Service");
    return ((await res.json()) as { data: OrderDTO }).data;
  },

  /**
   * Avisa al pedido que ya se pagó en línea. Es idempotente del lado del Order Service.
   * 409 = el pedido se canceló antes de que llegara el pago (hay que reembolsar).
   */
  async confirmPayment(orderId: string, body: { paymentId: string; paidAt?: Date }, requestId: string): Promise<void> {
    const res = await call(`/orders/${orderId}/payment-confirmed`, requestId, {
      method: "POST",
      body: JSON.stringify({ paymentId: body.paymentId, paidAt: body.paidAt?.toISOString() }),
    });
    if (res.status === 409) throw AppError.conflict("El pedido está cancelado; el pago requiere reembolso");
    if (!res.ok) throw AppError.serviceUnavailable("Order Service");
  },
};
