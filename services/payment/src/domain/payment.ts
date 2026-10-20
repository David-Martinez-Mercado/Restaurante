import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayChargeRequest, OrderDTO, PaymentStatus } from "@resto/contracts";

// ------------------------------------------------------------------ firma del webhook

const PREFIX = "sha256=";

/** Firma que la pasarela debe mandar en `x-signature`: HMAC-SHA256 (hex) del cuerpo EXACTO recibido. */
export function signBody(secret: string, rawBody: Buffer | string): string {
  return PREFIX + createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(secret: string, rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!rawBody || !header) return false;
  const expected = Buffer.from(signBody(secret, rawBody));
  const received = Buffer.from(header.trim());
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// ------------------------------------------------------------------ transiciones

export type WebhookType = "payment.succeeded" | "payment.failed" | "payment.expired";

/**
 * Qué hace un aviso de la pasarela sobre el estado actual del pago.
 *  - Un pago confirmado ("paid") es final: ningún aviso posterior lo cambia.
 *  - "succeeded" sí se acepta sobre failed/expired: el cliente pudo pagar en el último
 *    momento y el dinero ya se cobró, no se puede ignorar.
 *  - "failed"/"expired" solo aplican a un pago pendiente.
 * `null` = ignorar el aviso (se responde 200 para que la pasarela no reintente).
 */
export function nextStatus(current: PaymentStatus, type: WebhookType): PaymentStatus | null {
  if (current === "paid") return null;
  switch (type) {
    case "payment.succeeded":
      return "paid";
    case "payment.failed":
      return current === "pending" ? "failed" : null;
    case "payment.expired":
      return current === "pending" ? "expired" : null;
  }
}

// ------------------------------------------------------------------ cargo hacia la pasarela

export interface ChargeUrls {
  publicApiUrl: string;
  webUrl: string;
}

/**
 * Arma el cuerpo del cargo. Las líneas suman EXACTAMENTE `amountCents`: el IVA va como una
 * línea más para que la pasarela pueda mostrar un desglose que cuadre con el total.
 */
export function buildChargeRequest(
  paymentId: string,
  order: Pick<OrderDTO, "code" | "items" | "taxCents" | "totalCents" | "customerName">,
  customerUserId: string,
  urls: ChargeUrls
): GatewayChargeRequest {
  const items = order.items.map((i) => ({ name: i.dishName, quantity: i.quantity, unitPriceCents: i.unitPriceCents }));
  if (order.taxCents > 0) items.push({ name: "IVA", quantity: 1, unitPriceCents: order.taxCents });

  return {
    reference: paymentId,
    amountCents: order.totalCents,
    currency: "MXN",
    description: `Pedido ${order.code} · Asador La Brasa`,
    customer: { id: customerUserId, name: order.customerName ?? "Cliente" },
    items,
    returnUrl: `${urls.webUrl.replace(/\/$/, "")}/portal?payment=${paymentId}`,
    webhookUrl: `${urls.publicApiUrl.replace(/\/$/, "")}/api/v1/payments/webhook`,
  };
}
