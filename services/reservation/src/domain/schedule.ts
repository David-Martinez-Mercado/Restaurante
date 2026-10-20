import type { Permission } from "@resto/core";
import type { ReservationStatus } from "@resto/contracts";

/**
 * Reglas de agenda de las reservaciones. Son funciones puras (sin base de datos
 * ni HTTP), por eso se prueban con fechas fijas. Todas las horas son la hora
 * LOCAL del servidor: el restaurante está en un solo huso horario.
 */
export interface ScheduleParams {
  /** Primera hora de llegada reservable, en minutos desde la medianoche. */
  openMinutes: number;
  /** Última hora de llegada reservable. */
  lastMinutes: number;
  /** Las llegadas se reservan cada N minutos. */
  slotMinutes: number;
  /** Cuánto tiempo ocupa una reservación (para calcular el aforo). */
  stayMinutes: number;
  /** Comensales máximos al mismo tiempo. */
  capacity: number;
  /** Minutos antes de la llegada en que se avisa "ya casi es la hora". */
  reminderMinutes: number;
}

const MIN = 60_000;
export const HOUR_MS = 60 * MIN;
export const MIN_LEAD_MINUTES = 30;
export const MAX_ADVANCE_DAYS = 60;

export const addMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);

/** ¿Es una hora de llegada reservable? (alineada a los bloques y dentro del horario) */
export function isValidArrival(d: Date, p: ScheduleParams): boolean {
  if (Number.isNaN(d.getTime()) || d.getSeconds() !== 0 || d.getMilliseconds() !== 0) return false;
  const minutes = d.getHours() * 60 + d.getMinutes();
  return minutes >= p.openMinutes && minutes <= p.lastMinutes && (minutes - p.openMinutes) % p.slotMinutes === 0;
}

/** Todas las horas de llegada de un día "AAAA-MM-DD". */
export function slotsOfDay(date: string, p: ScheduleParams): Date[] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const slots: Date[] = [];
  for (let min = p.openMinutes; min <= p.lastMinutes; min += p.slotMinutes) {
    slots.push(new Date(y, m - 1, d, Math.floor(min / 60), min % 60, 0, 0));
  }
  return slots;
}

export type Lead = "ok" | "too_soon" | "too_far";

/** Se reserva con al menos 30 min de anticipación y hasta 60 días adelante. */
export function checkLead(start: Date, now: Date): Lead {
  const ms = start.getTime() - now.getTime();
  if (ms < MIN_LEAD_MINUTES * MIN) return "too_soon";
  if (ms > MAX_ADVANCE_DAYS * 24 * HOUR_MS) return "too_far";
  return "ok";
}

/** Una reservación ocupa lugar desde su llegada hasta `stayMinutes` después. */
export const occupiesWindow = (start: Date, p: ScheduleParams) => ({
  from: start,
  to: addMinutes(start, p.stayMinutes),
});

export function overlapsStay(a: Date, b: Date, p: ScheduleParams): boolean {
  return a.getTime() < b.getTime() + p.stayMinutes * MIN && b.getTime() < a.getTime() + p.stayMinutes * MIN;
}

/** Un cliente cancela hasta 1 hora antes de la llegada; el personal puede hacerlo después. */
export const customerMayCancel = (start: Date, now: Date) => start.getTime() - now.getTime() >= HOUR_MS;

/** Se puede registrar la llegada desde 1 hora antes de la hora prevista. */
export const arrivalMayBeRecorded = (start: Date, now: Date) => now.getTime() >= start.getTime() - HOUR_MS;

/** "No se presentó" solo se marca 15 minutos después de la hora de llegada. */
export const isNoShowAllowed = (start: Date, now: Date) => now.getTime() >= start.getTime() + 15 * MIN;

/**
 * ¿Toca avisar "ya casi es la hora"? Sí cuando falta `reminderMinutes` o menos
 * para la llegada y la hora aún no pasó.
 */
export function reminderDue(reservedFor: Date, now: Date, p: ScheduleParams): boolean {
  const left = reservedFor.getTime() - now.getTime();
  return left > 0 && left <= p.reminderMinutes * MIN;
}

/** Estados que ocupan lugar en el aforo. */
export const ACTIVE_STATUSES: ReservationStatus[] = ["confirmed", "arrived"];

/**
 * Máquina de estados de la reservación. Cada transición exige un permiso:
 *
 *   confirmed -> arrived -> completed
 *       \-> cancelled   (el dueño o el personal)
 *       \-> no_show     (solo el personal, pasados 15 min)
 */
const TRANSITIONS: Record<ReservationStatus, Partial<Record<ReservationStatus, Permission>>> = {
  confirmed: {
    arrived: "reservations:manage",
    no_show: "reservations:manage",
    cancelled: "reservations:create",
  },
  arrived: { completed: "reservations:manage" },
  completed: {},
  cancelled: {},
  no_show: {},
};

/** Permiso requerido para pasar de `from` a `to`, o null si la transición no existe. */
export function requiredPermission(from: ReservationStatus, to: ReservationStatus): Permission | null {
  return TRANSITIONS[from][to] ?? null;
}

/** Sin 0/O/1/I para que el localizador no se confunda al dictarlo. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCode(random: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}
