import { z } from "zod";

export const RESERVATION_STATUSES = ["confirmed", "arrived", "completed", "cancelled", "no_show"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_SOURCES = ["web", "telegram", "staff"] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

export const MAX_PARTY_SIZE = 12;

const phone = z.string().trim().regex(/^\d{10}$/, "El teléfono debe tener 10 dígitos");

/**
 * Crear una reservación. `reservedFor` es la HORA DE LLEGADA prevista.
 * Un cliente en línea reserva para sí mismo (nombre y teléfono salen de su perfil);
 * el personal debe indicar `customerName` y `phone` (o un `customerUserId`).
 */
export const createReservationSchema = z.object({
  reservedFor: z.coerce.date(),
  partySize: z.number().int().min(1).max(MAX_PARTY_SIZE),
  notes: z.string().trim().max(200).optional(),
  customerName: z.string().trim().min(3).max(120).optional(),
  phone: phone.optional(),
  customerUserId: z.string().uuid().optional(),
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

/** Reservación hecha desde el bot de Telegram (ruta interna, sin JWT). */
export const telegramReservationSchema = z.object({
  telegramChatId: z.string().min(1).max(30),
  reservedFor: z.coerce.date(),
  partySize: z.number().int().min(1).max(MAX_PARTY_SIZE),
  customerName: z.string().trim().min(3).max(120).optional(),
  notes: z.string().trim().max(200).optional(),
});
export type TelegramReservationInput = z.infer<typeof telegramReservationSchema>;

export const updateReservationStatusSchema = z.object({
  status: z.enum(RESERVATION_STATUSES),
  /** Mesa asignada al llegar el cliente (opcional). */
  tableId: z.string().uuid().optional(),
});
export type UpdateReservationStatusInput = z.infer<typeof updateReservationStatusSchema>;

export interface ReservationDTO {
  id: string;
  /** Localizador de 6 caracteres que el cliente da al llegar. */
  code: string;
  customerUserId: string | null;
  customerName: string;
  phone: string | null;
  partySize: number;
  /** Hora de llegada prevista (ISO). */
  reservedFor: string;
  status: ReservationStatus;
  source: ReservationSource;
  tableId: string | null;
  tableNumber: number | null;
  notes: string | null;
  /** Hora en que el cliente realmente llegó (la marca el personal). */
  arrivedAt: string | null;
  /** Cuándo se envió el aviso de "ya casi es la hora". */
  reminderSentAt: string | null;
  createdAt: string;
}

export interface SlotDTO {
  /** Hora de llegada (ISO). */
  startsAt: string;
  remainingSeats: number;
  available: boolean;
}
