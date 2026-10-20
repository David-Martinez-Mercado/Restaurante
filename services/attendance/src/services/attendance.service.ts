import { AppError, type Role } from "@resto/core";
import type {
  AttendanceRecordDTO,
  AttendanceStatusDTO,
  AttendanceSummaryDTO,
  AttendanceSummaryRowDTO,
  EditAttendanceInput,
  ManualAttendanceInput,
} from "@resto/contracts";
import { defaultRules } from "../config.js";
import {
  isStale,
  localDay,
  minutesBetween,
  periodBounds,
  summarizeUser,
  type AttendanceRules,
} from "../domain/attendance.js";
import { attendanceRepository, type AttendanceRecord } from "../repositories/attendance.repository.js";

export interface Actor {
  userId: string;
  username: string;
  role: Role;
}

/** Margen para relojes desfasados al capturar a mano; más allá de esto, la fecha es "del futuro". */
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_SHIFT_HOURS = 24;
const LIST_LIMIT = 500;

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function toDTO(r: AttendanceRecord): AttendanceRecordDTO {
  return {
    id: r.id,
    userId: r.userId,
    username: r.username,
    clockIn: r.clockIn.toISOString(),
    clockOut: r.clockOut?.toISOString() ?? null,
    minutes: r.clockOut ? minutesBetween(r.clockIn, r.clockOut) : null,
    source: r.source,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
const nextDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);

/** Valida una jornada capturada o corregida a mano. */
async function assertValidShift(
  userId: string,
  clockIn: Date,
  clockOut: Date | null,
  now: Date,
  excludeId?: string
): Promise<void> {
  const limit = now.getTime() + FUTURE_TOLERANCE_MS;
  if (clockIn.getTime() > limit || (clockOut && clockOut.getTime() > limit)) {
    throw AppError.validation("Fecha inválida", [{ field: "clockIn", issue: "No se puede registrar una hora en el futuro" }]);
  }
  if (clockOut) {
    if (clockOut <= clockIn) {
      throw AppError.validation("Fecha inválida", [{ field: "clockOut", issue: "La salida debe ser posterior a la entrada" }]);
    }
    if (clockOut.getTime() - clockIn.getTime() > MAX_SHIFT_HOURS * 3_600_000) {
      throw AppError.validation("Jornada inválida", [{ field: "clockOut", issue: `Una jornada no puede durar más de ${MAX_SHIFT_HOURS} horas` }]);
    }
  }
  const clash = await attendanceRepository.findOverlapping(userId, clockIn, clockOut, excludeId);
  if (clash.length > 0) {
    const c = clash[0]!;
    throw AppError.conflict(
      `Se traslapa con otra jornada de esa persona (${localDay(c.clockIn)} ${hhmm(c.clockIn)}${c.clockOut ? `–${hhmm(c.clockOut)}` : ", sin salida"})`
    );
  }
}

/** CAPA 3 — SERVICE: checador (entradas, salidas, correcciones y resúmenes de asistencia). */
export const attendanceService = {
  // ------------------------------------------------------------ checar

  async clockIn(actor: Actor, now = new Date(), rules: AttendanceRules = defaultRules): Promise<AttendanceRecordDTO> {
    const result = await attendanceRepository.openIfNone({
      userId: actor.userId,
      username: actor.username,
      clockIn: now,
      source: "self",
      createdBy: actor.userId,
    });
    if (!result.ok) {
      const since = result.open.clockIn;
      throw AppError.conflict(
        isStale(since, now, rules)
          ? `Tu entrada del ${localDay(since)} (${hhmm(since)}) sigue abierta: pide a tu gerente que la corrija.`
          : `Ya tienes una entrada abierta desde las ${hhmm(since)}. Checa tu salida primero.`
      );
    }
    return toDTO(result.record);
  },

  async clockOut(actor: Actor, now = new Date(), rules: AttendanceRules = defaultRules): Promise<AttendanceRecordDTO> {
    const open = await attendanceRepository.findOpen(actor.userId);
    if (!open) throw AppError.conflict("No tienes una entrada abierta. Checa tu entrada primero.");
    if (isStale(open.clockIn, now, rules)) {
      throw AppError.conflict(
        `Tu entrada del ${localDay(open.clockIn)} (${hhmm(open.clockIn)}) lleva más de ${rules.staleShiftHours} horas abierta: pide a tu gerente que la corrija.`
      );
    }
    if (minutesBetween(open.clockIn, now) < rules.minShiftMinutes) {
      throw AppError.conflict("Acabas de checar tu entrada; espera un momento para checar la salida.");
    }
    return toDTO(await attendanceRepository.update(open.id, { clockOut: now }));
  },

  async status(actor: Actor, now = new Date(), rules: AttendanceRules = defaultRules): Promise<AttendanceStatusDTO> {
    const [open, today] = await Promise.all([
      attendanceRepository.findOpen(actor.userId),
      attendanceRepository.findBetween({ userId: actor.userId, from: startOfDay(now), toExclusive: nextDay(now), limit: 50 }),
    ]);
    const stale = open ? isStale(open.clockIn, now, rules) : false;

    let todayMinutes = 0;
    for (const r of today) {
      if (r.clockOut) todayMinutes += minutesBetween(r.clockIn, r.clockOut);
    }
    // La jornada abierta suma mientras sea razonable; una olvidada no infla las horas de hoy.
    if (open && !stale && localDay(open.clockIn) === localDay(now)) todayMinutes += minutesBetween(open.clockIn, now);

    return { open: open ? toDTO(open) : null, todayMinutes, stale };
  },

  // ------------------------------------------------------------ consultas

  async listMine(actor: Actor, from: Date, toExclusive: Date): Promise<AttendanceRecordDTO[]> {
    return (await attendanceRepository.findBetween({ userId: actor.userId, from, toExclusive, limit: LIST_LIMIT })).map(toDTO);
  },

  async list(filter: { userId?: string; from: Date; toExclusive: Date }): Promise<AttendanceRecordDTO[]> {
    return (await attendanceRepository.findBetween({ ...filter, limit: LIST_LIMIT })).map(toDTO);
  },

  // ------------------------------------------------------------ correcciones del gerente

  async manualCreate(input: ManualAttendanceInput, actor: Actor, now = new Date()): Promise<AttendanceRecordDTO> {
    await assertValidShift(input.userId, input.clockIn, input.clockOut ?? null, now);
    const record = await attendanceRepository.create({
      userId: input.userId,
      username: input.username,
      clockIn: input.clockIn,
      clockOut: input.clockOut ?? null,
      source: "manual",
      note: input.note,
      createdBy: actor.userId,
    });
    return toDTO(record);
  },

  async edit(id: string, input: EditAttendanceInput, actor: Actor, now = new Date()): Promise<AttendanceRecordDTO> {
    const record = await attendanceRepository.findById(id);
    if (!record) throw AppError.notFound("Registro de asistencia");

    const clockIn = input.clockIn ?? record.clockIn;
    const clockOut = input.clockOut === undefined ? record.clockOut : input.clockOut;
    await assertValidShift(record.userId, clockIn, clockOut, now, record.id);

    const updated = await attendanceRepository.update(id, { clockIn, clockOut, source: "manual", note: input.note, updatedBy: actor.userId });
    return toDTO(updated);
  },

  // ------------------------------------------------------------ resúmenes

  /** Resumen de todo el personal que tiene registros en el periodo. */
  async summary(period: string, now = new Date(), rules: AttendanceRules = defaultRules): Promise<AttendanceSummaryDTO> {
    const { start, endExclusive } = periodBounds(period);
    const records = await attendanceRepository.findBetween({ from: start, toExclusive: endExclusive, limit: 5000 });

    const byUser = new Map<string, AttendanceRecord[]>();
    for (const r of records) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);

    // Las faltas se cuentan desde la primera vez que la persona checó (no hay fecha de ingreso aquí).
    const firsts = await attendanceRepository.firstClockIns([...byUser.keys()]);

    const rows: AttendanceSummaryRowDTO[] = [...byUser.entries()]
      .map(([userId, list]) => ({
        userId,
        username: list[0]!.username,
        ...summarizeUser(list, period, rules, { now, since: localDay(firsts.get(userId) ?? start) }),
      }))
      .sort((a, b) => a.username.localeCompare(b.username));

    return { period, rules: publicRules(rules), rows };
  },

  /**
   * Resumen de UNA persona. `since` (fecha de ingreso) la manda el servicio de nómina; sin ella se usa
   * la primera vez que la persona checó, y si nunca ha checado no hay faltas que contar.
   */
  async summaryOf(
    userId: string,
    username: string,
    period: string,
    since: string | undefined,
    now = new Date(),
    rules: AttendanceRules = defaultRules
  ): Promise<AttendanceSummaryRowDTO> {
    const { start, endExclusive } = periodBounds(period);
    const records = await attendanceRepository.findBetween({ userId, from: start, toExclusive: endExclusive, limit: 1000 });
    let effectiveSince = since;
    if (!effectiveSince) {
      const first = (await attendanceRepository.firstClockIns([userId])).get(userId);
      effectiveSince = first ? localDay(first) : localDay(now);
    }
    return { userId, username: records[0]?.username ?? username, ...summarizeUser(records, period, rules, { now, since: effectiveSince }) };
  },
};

function publicRules(rules: AttendanceRules): AttendanceSummaryDTO["rules"] {
  return { workdays: rules.workdays, dailyHours: rules.dailyHours, staleShiftHours: rules.staleShiftHours };
}
