import { z } from "zod";

export const ORDER_STATUSES = [
  "pending",
  "preparing",
  "ready",
  "served",
  "paid",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** dine_in = pedido en mesa (lo toma el personal); pickup = pedido en línea para recoger. */
export const ORDER_CHANNELS = ["dine_in", "pickup"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const PAYMENT_METHODS = ["cash", "card", "online"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Métodos que registra el cajero en el mostrador (el pago en línea llega por la pasarela). */
export const COUNTER_PAYMENT_METHODS = ["cash", "card"] as const;
export type CounterPaymentMethod = (typeof COUNTER_PAYMENT_METHODS)[number];

const orderItems = z
  .array(
    z.object({
      dishId: z.string().uuid(),
      quantity: z.number().int().min(1).max(50),
    })
  )
  .min(1, "El pedido debe incluir al menos un platillo")
  .max(50);

export const createOrderSchema = z.object({
  tableId: z.string().uuid(),
  notes: z.string().trim().max(300).optional(),
  items: orderItems,
  /** Cliente registrado al que pertenece el consumo (recibirá el resumen y la pregunta de factura). */
  customerUserId: z.string().uuid().optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Pedido hecho por el propio cliente desde el portal en línea (para recoger). */
export const createOnlineOrderSchema = z.object({
  notes: z.string().trim().max(300).optional(),
  items: orderItems,
});
export type CreateOnlineOrderInput = z.infer<typeof createOnlineOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  /** Obligatorio al cobrar en mostrador un pedido que aún no se pagó en línea. */
  paymentMethod: z.enum(COUNTER_PAYMENT_METHODS).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

/** Lo que el Payment Service informa al Order Service cuando la pasarela confirma un pago. */
export const paymentConfirmedSchema = z.object({
  paymentId: z.string().uuid(),
  paidAt: z.coerce.date().optional(),
});
export type PaymentConfirmedInput = z.infer<typeof paymentConfirmedSchema>;

export interface OrderItemDTO {
  id: string;
  dishId: string;
  dishName: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderDTO {
  id: string;
  /** Código corto para mostrar (p. ej. A1B2C3). */
  code: string;
  /** null en pedidos en línea para recoger. */
  tableId: string | null;
  waiterId: string | null;
  channel: OrderChannel;
  customerUserId: string | null;
  customerName: string | null;
  status: OrderStatus;
  notes: string | null;
  items: OrderItemDTO[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  /** Fecha en que se confirmó el pago (puede ser antes de servir en pedidos en línea). */
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}
