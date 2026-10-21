import { z } from "zod";
import { periodSchema } from "./attendance.contracts.js";

/** Sueldo y datos laborales de un trabajador del restaurante (el sueldo es MENSUAL bruto). */
export const compensationSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  position: z.string().trim().min(2).max(80),
  monthlySalaryCents: z.number().int().min(100_00).max(10_000_000_00),
  /** Desde cuándo cuentan las faltas (AAAA-MM-DD). */
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD"),
  active: z.boolean().default(true),
});
export type CompensationInput = z.infer<typeof compensationSchema>;

export interface CompensationDTO {
  userId: string;
  fullName: string;
  position: string;
  monthlySalaryCents: number;
  hireDate: string;
  active: boolean;
  /** true = ya está dado de alta (con este sueldo) en el motor de nómina externo. */
  synced: boolean;
  updatedAt: string;
}

export const generatePayrollSchema = z.object({ period: periodSchema });
export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;

export const PAYROLL_STATUSES = ["calculated", "approved"] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export interface PayrollLineDTO {
  userId: string;
  fullName: string;
  position: string;
  baseSalaryCents: number;
  hoursWorked: number;
  overtimeHours: number;
  overtimePayCents: number;
  absenceDays: number;
  absenceDeductionCents: number;
  /** Sueldo base + horas extra − faltas: la base sobre la que el motor calcula impuestos. */
  taxableCents: number;
  isrCents: number;
  imssCents: number;
  infonavitCents: number;
  subsidioCents: number;
  netPayCents: number;
}

export interface PayrollRunDTO {
  id: string;
  period: string;
  status: PayrollStatus;
  generatedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  totals: { taxableCents: number; deductionsCents: number; netCents: number };
  lines: PayrollLineDTO[];
}

/** Recibo propio: una línea de una nómina ya aprobada. */
export interface PayslipDTO extends PayrollLineDTO {
  period: string;
  approvedAt: string | null;
}

export interface PayrollEngineStatusDTO {
  /** false = el motor de nómina externo (repo SistemaNomina) no responde. */
  available: boolean;
  employeesUrl: string;
  payrollUrl: string;
  incidentsUrl: string;
}

/** Una llamada del restaurante al motor de nómina externo (SistemaNomina), tal como se hizo. */
export interface EngineTransactionDTO {
  id: string;
  at: string;
  /** Servicio del motor al que se llamó. */
  target: "employees" | "incidents" | "payroll";
  method: string;
  path: string;
  /** Frase legible de lo que se pidió. */
  summary: string;
  /** null = el motor no respondió. */
  status: number | null;
  ok: boolean;
  durationMs: number;
  requestBody: unknown;
  responseBody: unknown;
  error: string | null;
}

/** Lo que el motor tiene guardado ahora mismo (solo lectura). */
export interface EngineSnapshotDTO {
  employees: { id: number; name: string; position: string; baseSalary: number }[];
  incidents: { id: number; employeeId: number; period: string; type: string; hoursOrDays: number; amount: number }[];
}
