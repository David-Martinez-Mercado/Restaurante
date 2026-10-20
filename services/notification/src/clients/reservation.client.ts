import type { ReservationDTO, SlotDTO, TelegramReservationInput } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

/** Error de negocio devuelto por el Reservation Service (se muestra tal cual al cliente en el bot). */
export class ReservationRejected extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ReservationRejected";
  }
}

export class ReservationUnavailable extends Error {
  constructor() {
    super("El servicio de reservaciones no está disponible");
    this.name = "ReservationUnavailable";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.RESERVATION_SERVICE_URL}/api/v1/internal${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-internal-key": config.INTERNAL_API_KEY, ...init.headers },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw new ReservationUnavailable();
  }

  if (res.status === 401) {
    logger.error("El Reservation Service rechazó la llave interna: revisa INTERNAL_API_KEY");
    throw new ReservationUnavailable();
  }
  if (res.status >= 500) throw new ReservationUnavailable();

  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!res.ok) throw new ReservationRejected(res.status, json.error?.message ?? "No se pudo completar la operación");
  return json.data as T;
}

/** Cliente HTTP interno del Reservation Service, usado por el bot de Telegram. */
export const reservationClient = {
  availability: (date: string, partySize: number) =>
    call<SlotDTO[]>(`/availability?date=${encodeURIComponent(date)}&partySize=${partySize}`),

  create: (input: Omit<TelegramReservationInput, "reservedFor"> & { reservedFor: string }) =>
    call<ReservationDTO>(`/reservations/telegram`, { method: "POST", body: JSON.stringify(input) }),

  upcoming: (chatId: string) => call<ReservationDTO[]>(`/reservations/by-chat/${encodeURIComponent(chatId)}`),

  cancel: (chatId: string, code: string) =>
    call<ReservationDTO>(`/reservations/telegram/cancel`, { method: "POST", body: JSON.stringify({ chatId, code }) }),
};
