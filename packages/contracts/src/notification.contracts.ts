import { z } from "zod";
import { ORDER_CHANNELS, PAYMENT_METHODS } from "./order.contracts.js";

export const NOTIFICATION_CHANNELS = ["in_app", "telegram"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Resultado de la entrega:
 *  sent      = entregado (Telegram aceptó el mensaje / aviso guardado en la app)
 *  simulated = Telegram no está configurado: el mensaje se registra pero no sale
 *  failed    = Telegram rechazó el mensaje o no hubo conexión
 *  skipped   = no había a dónde enviarlo (el cliente no vinculó Telegram)
 */
export const DELIVERY_STATUSES = ["sent", "simulated", "failed", "skipped"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Fecha inválida");

const orderRef = {
  orderId: z.string().uuid(),
  orderCode: z.string().min(1).max(20),
  customerUserId: z.string().uuid(),
};

const reservationRef = {
  reservationId: z.string().uuid(),
  code: z.string().min(1).max(20),
  customerName: z.string().min(1).max(120),
  reservedFor: isoDate,
  partySize: z.number().int().positive(),
  customerUserId: z.string().uuid().optional(),
  /** Reservaciones hechas por Telegram sin cuenta: se avisa directo al chat. */
  telegramChatId: z.string().max(30).optional(),
};

/** Eventos de dominio que los servicios mandan al Notification Service. */
export const notificationEventSchema = z.discriminatedUnion("type", [
  /** El pedido del cliente ya está listo para recoger. */
  z.object({ type: z.literal("order.ready"), ...orderRef }),
  /**
   * El cliente terminó de consumir y pagó: se le manda el resumen del consumo
   * (descripción, importes y método de pago) y se le pregunta si va a facturar.
   */
  z.object({
    type: z.literal("order.paid"),
    ...orderRef,
    items: z
      .array(z.object({ name: z.string(), quantity: z.number().int().positive(), lineTotalCents: z.number().int() }))
      .min(1),
    subtotalCents: z.number().int(),
    taxCents: z.number().int(),
    totalCents: z.number().int(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    channel: z.enum(ORDER_CHANNELS),
  }),
  /** La pasarela confirmó el pago en línea. */
  z.object({ type: z.literal("payment.confirmed"), ...orderRef, amountCents: z.number().int() }),
  z.object({ type: z.literal("reservation.confirmed"), ...reservationRef }),
  /** Ya casi es la hora de llegada de la reservación. */
  z.object({ type: z.literal("reservation.reminder"), ...reservationRef }),
  z.object({ type: z.literal("reservation.cancelled"), ...reservationRef }),
]);
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type NotificationEventType = NotificationEvent["type"];

export interface NotificationDTO {
  id: string;
  type: NotificationEventType;
  channel: NotificationChannel;
  delivery: DeliveryStatus;
  title: string;
  body: string;
  readAt: string | null;
  /** Solo lo ve el personal en la bitácora de envíos. */
  recipientUserId: string | null;
  error: string | null;
  createdAt: string;
}

export interface TelegramInfoDTO {
  /** true = hay token y el bot está activo; false = modo simulado. */
  configured: boolean;
  botUsername: string | null;
}
