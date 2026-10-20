import type { AttendanceSummaryRowDTO } from "@resto/contracts";

/**
 * Reglas del checador, todas funciones puras (sin base de datos ni reloj propio):
 *  - Una jornada se atribuye al día en que se checó la ENTRADA (un turno que cruza la medianoche
 *    cuenta completo en el día en que empezó).
 *  - Las horas extra son lo que pase de la jornada diaria, día por día.
 *  - Una falta es un día laborable ANTERIOR A HOY sin ningún registro.
 *  - Las jornadas sin salida no suman horas (hasta que alguien las corrija), pero sí cuentan como presencia.
 */

export interface AttendanceRules {
  /** 0 = domingo ... 6 = sábado. */
  workdays: number[];
  dailyHours: number;
  /** Una entrada abierta por más de esto se considera olvidada. */
  staleShiftHours: number;
  minShiftMinutes: number;
}

export interface RecordLike {
  clockIn: Date;
  clockOut: Date | null;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Minutos completos entre dos instantes (nunca negativos). */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** AAAA-MM-DD en hora local del servidor. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface PeriodBounds {
  start: Date;
  endExclusive: Date;
  /** Todos los días del periodo, AAAA-MM-DD. */
  days: string[];
}

export function periodBounds(period: string): PeriodBounds {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const endExclusive = new Date(y, m, 1, 0, 0, 0, 0);
  const total = new Date(y, m, 0).getDate();
  const days = Array.from({ length: total }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`);
  return { start, endExclusive, days };
}

/** ¿La jornada abierta lleva tanto tiempo que seguramente se olvidó checar la salida? */
export function isStale(clockIn: Date, now: Date, rules: AttendanceRules): boolean {
  return minutesBetween(clockIn, now) > rules.staleShiftHours * 60;
}

/** Días laborables de un periodo que ya pasaron (hasta ayer) y desde `sinceYmd`. */
export function expectedWorkdays(period: string, rules: AttendanceRules, sinceYmd: string, todayYmd: string): string[] {
  return periodBounds(period).days.filter((ymd) => {
    if (ymd < sinceYmd || ymd >= todayYmd) return false;
    const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
    return rules.workdays.includes(new Date(y, m - 1, d).getDay());
  });
}

export interface SummaryContext {
  now: Date;
  /** Desde qué día (AAAA-MM-DD) cuentan las faltas, normalmente la fecha de ingreso. */
  since: string;
}

type SummaryNumbers = Omit<AttendanceSummaryRowDTO, "userId" | "username">;

/** Resumen de UNA persona en un periodo. `records` ya debe ser solo de esa persona y de ese periodo. */
export function summarizeUser(records: RecordLike[], period: string, rules: AttendanceRules, ctx: SummaryContext): SummaryNumbers {
  const presentDays = new Set<string>();
  const minutesByDay = new Map<string, number>();
  let openShifts = 0;

  for (const r of records) {
    const day = localDay(r.clockIn);
    presentDays.add(day);
    if (r.clockOut === null) {
      openShifts += 1;
      continue;
    }
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + minutesBetween(r.clockIn, r.clockOut));
  }

  const dailyLimit = rules.dailyHours * 60;
  let totalMinutes = 0;
  let overtimeMinutes = 0;
  for (const minutes of minutesByDay.values()) {
    totalMinutes += minutes;
    overtimeMinutes += Math.max(0, minutes - dailyLimit);
  }

  const absenceDates = expectedWorkdays(period, rules, ctx.since, localDay(ctx.now)).filter((d) => !presentDays.has(d));

  return {
    daysWorked: presentDays.size,
    hoursWorked: round2(totalMinutes / 60),
    overtimeHours: round2(overtimeMinutes / 60),
    absences: absenceDates.length,
    absenceDates,
    openShifts,
  };
}

/** ¿Dos jornadas se traslapan? `null` en la salida = abierta (dura "para siempre"). */
export function overlaps(a: RecordLike, b: RecordLike): boolean {
  const aEnd = a.clockOut?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.clockOut?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.clockIn.getTime() < bEnd && b.clockIn.getTime() < aEnd;
}
