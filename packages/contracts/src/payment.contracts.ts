import { z } from "zod";

/**
 * CONTRATO CON LA PASARELA DE PAGO
 * --------------------------------
 * Este archivo define, y nada más define, la API entre el Payment Service del
 * restaurante y la pasarela de pago externa. La pasarela NO está implementada
 * aquí: quien la construya solo debe cumplir estos dos sentidos.
 *
 *  1) SALIDA  (restaurante → pasarela)  POST {PAYMENT_GATEWAY_URL}/v1/charges
 *     Cuerpo: GatewayChargeRequest.   Respuesta 201: GatewayChargeResponse.
 *
 *  2) ENTRADA (pasarela → restaurante)  POST /api/v1/payments/webhook
 *     Cuerpo: gatewayWebhookSchema.   Encabezado: x-signature: sha256=<HMAC>.
 *
 * Los importes viajan siempre en CENTAVOS (entero), moneda MXN.
 * Documentación completa con ejemplos: docs/CONTRATO-PASARELA-DE-PAGO.md
 */

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "expired"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const GATEWAY_METHODS = ["card", "spei", "oxxo", "wallet"] as const;
export type GatewayMethod = (typeof GATEWAY_METHODS)[number];

// ------------------------------------------------------------------ cliente → restaurante

export const createPaymentSchema = z.object({
  orderId: z.string().uuid(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

// ------------------------------------------------------------------ restaurante → pasarela

export interface GatewayChargeRequest {
  /** Id del pago en el restaurante. La pasarela debe devolverlo tal cual en el webhook. */
  reference: string;
  amountCents: number;
  currency: "MXN";
  description: string;
  customer: { id: string; name: string };
  items: { name: string; quantity: number; unitPriceCents: number }[];
  /** A dónde regresar al cliente después de pagar o cancelar. */
  returnUrl: string;
  /** A dónde debe avisar la pasarela el resultado del pago. */
  webhookUrl: string;
}

export interface GatewayChargeResponse {
  /** Identificador del cargo en la pasarela. */
  gatewayReference: string;
  /** Página de pago a la que se envía al cliente. */
  checkoutUrl: string;
  /** Vencimiento del cobro (ISO), opcional. */
  expiresAt?: string;
}

// ------------------------------------------------------------------ pasarela → restaurante

export const WEBHOOK_EVENT_TYPES = ["payment.succeeded", "payment.failed", "payment.expired"] as const;

export const gatewayWebhookSchema = z.object({
  /** Id único del evento; sirve para no procesar dos veces el mismo aviso. */
  eventId: z.string().min(1).max(100),
  type: z.enum(WEBHOOK_EVENT_TYPES),
  /** El `reference` que se envió en el cargo (id del pago en el restaurante). */
  reference: z.string().uuid(),
  gatewayReference: z.string().min(1).max(100),
  amountCents: z.number().int().positive(),
  currency: z.literal("MXN"),
  method: z.enum(GATEWAY_METHODS).optional(),
  paidAt: z.coerce.date().optional(),
  failureReason: z.string().max(200).optional(),
});
export type GatewayWebhookInput = z.infer<typeof gatewayWebhookSchema>;

// ------------------------------------------------------------------ salida de la API

export interface PaymentDTO {
  id: string;
  orderId: string;
  orderCode: string;
  amountCents: number;
  currency: "MXN";
  status: PaymentStatus;
  method: GatewayMethod | null;
  gatewayReference: string | null;
  /** Página de pago de la pasarela; null mientras no haya pasarela configurada. */
  checkoutUrl: string | null;
  expiresAt: string | null;
  failureReason: string | null;
  paidAt: string | null;
  /** false = aún no se conectó la pasarela (PAYMENT_GATEWAY_URL vacío). */
  gatewayConfigured: boolean;
  /** Solo si la pasarela no está configurada: el cuerpo que se enviaría (para integrarla). */
  gatewayRequest: GatewayChargeRequest | null;
  createdAt: string;
}
