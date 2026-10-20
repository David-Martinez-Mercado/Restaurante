/**
 * Cálculos propios de la nómina del restaurante (horas extra y faltas), en centavos enteros.
 * Los IMPUESTOS (ISR, IMSS, Infonavit, subsidio) NO se calculan aquí: los calcula el motor
 * externo SistemaNomina a partir del sueldo ajustado que le entregamos.
 */

export const DAYS_PER_MONTH = 30;

export interface PayConfig {
  /** Múltiplo de pago de la hora extra (2 = doble). */
  overtimeMultiplier: number;
  /** Horas de una jornada normal. */
  dailyHours: number;
}

/** Salario de un día = sueldo mensual / 30 (criterio habitual en México). */
export function dailyWageCents(monthlySalaryCents: number): number {
  return Math.round(monthlySalaryCents / DAYS_PER_MONTH);
}

export interface Adjustments {
  overtimePayCents: number;
  absenceDeductionCents: number;
}

/**
 * Pago de horas extra y descuento por faltas.
 *  - hora normal = sueldo mensual / 30 / horas por jornada
 *  - horas extra = horas × hora normal × múltiplo
 *  - cada falta descuenta un día de salario; el descuento nunca pasa del sueldo mensual.
 */
export function computeAdjustments(
  input: { monthlySalaryCents: number; overtimeHours: number; absences: number },
  cfg: PayConfig
): Adjustments {
  const hourly = input.monthlySalaryCents / DAYS_PER_MONTH / cfg.dailyHours;
  const overtimePayCents = Math.max(0, Math.round(input.overtimeHours * hourly * cfg.overtimeMultiplier));
  const absenceDeductionCents = Math.min(
    input.monthlySalaryCents,
    Math.max(0, Math.round(input.absences * (input.monthlySalaryCents / DAYS_PER_MONTH)))
  );
  return { overtimePayCents, absenceDeductionCents };
}

/** El motor externo trabaja en pesos con decimales; nosotros, en centavos enteros. */
export const pesosToCents = (pesos: number): number => Math.round(pesos * 100);
export const centsToPesos = (cents: number): number => cents / 100;

/** ¿Es una fecha real AAAA-MM-DD? (JavaScript acepta "31 de febrero" y la corre a marzo: aquí se rechaza). */
export function isRealDate(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

/** AAAA-MM del instante dado (hora local). */
export function currentPeriod(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Último día del periodo, AAAA-MM-DD. */
export function lastDayOf(period: string): string {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}
