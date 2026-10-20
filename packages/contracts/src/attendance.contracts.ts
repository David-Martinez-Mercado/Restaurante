import { z } from "zod";

/** Periodo de nómina/asistencia: AAAA-MM. */
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use el formato AAAA-MM");

export const ATTENDANCE_SOURCES = ["self", "manual"] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

/** Corrección o captura manual del gerente (el motivo es obligatorio para dejar rastro). */
export const manualAttendanceSchema = z
  .object({
    userId: z.string().uuid(),
    username: z.string().trim().min(1).max(60),
    clockIn: z.coerce.date(),
    clockOut: z.coerce.date().optional(),
    note: z.string().trim().min(3, "Indica el motivo").max(200),
  })
  .refine((v) => !v.clockOut || v.clockOut > v.clockIn, { message: "La salida debe ser posterior a la entrada", path: ["clockOut"] });
export type ManualAttendanceInput = z.infer<typeof manualAttendanceSchema>;

export const editAttendanceSchema = z.object({
  clockIn: z.coerce.date().optional(),
  /** null deja la jornada abierta de nuevo. */
  clockOut: z.coerce.date().nullable().optional(),
  note: z.string().trim().min(3, "Indica el motivo").max(200),
});
export type EditAttendanceInput = z.infer<typeof editAttendanceSchema>;

export interface AttendanceRecordDTO {
  id: string;
  userId: string;
  username: string;
  clockIn: string;
  clockOut: string | null;
  /** Minutos trabajados; null mientras la jornada sigue abierta. */
  minutes: number | null;
  source: AttendanceSource;
  note: string | null;
  createdAt: string;
}

/** Estado actual de quien checa: si tiene jornada abierta y cuánto lleva hoy. */
export interface AttendanceStatusDTO {
  open: AttendanceRecordDTO | null;
  /** Minutos acumulados hoy (incluye la jornada abierta). */
  todayMinutes: number;
  /** true = la jornada abierta lleva demasiado tiempo: seguramente olvidó checar la salida. */
  stale: boolean;
}

export interface AttendanceSummaryRowDTO {
  userId: string;
  username: string;
  daysWorked: number;
  hoursWorked: number;
  overtimeHours: number;
  /** Días laborables sin ningún registro (solo hasta ayer). */
  absences: number;
  absenceDates: string[];
  /** Jornadas sin salida registrada: no suman horas hasta que se corrijan. */
  openShifts: number;
}

export interface AttendanceSummaryDTO {
  period: string;
  /** Reglas con las que se calculó (para que el reporte sea explicable). */
  rules: { workdays: number[]; dailyHours: number; staleShiftHours: number };
  rows: AttendanceSummaryRowDTO[];
}
