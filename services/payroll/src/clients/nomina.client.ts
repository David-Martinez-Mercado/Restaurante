import { z } from "zod";
import { AppError } from "@resto/core";
import { logger } from "@resto/http";
import { config } from "../config.js";

/**
 * ADAPTADOR del motor de nómina externo (repo SistemaNomina, de otro autor; NO se modifica).
 * Es el único lugar que conoce su forma de hablar. Si el autor cambia algo, se arregla solo aquí.
 *
 * Endpoints del original que se usan:
 *   POST   {employees}/employees          alta de un trabajador        -> { id, name, position, baseSalary }
 *   POST   {incidents}/incidents          horas extra / faltas         -> { id, ... }
 *   DELETE {incidents}/incidents/:id      borra una incidencia
 *   POST   {payroll}/periods/generate     calcula la nómina del periodo de TODOS sus empleados
 * Sus importes van en PESOS con decimales (los nuestros, en centavos).
 *
 * Cada llamada se reporta a un "observador" (ver observe): así se puede mostrar la bitácora de
 * transacciones entre el restaurante y el motor sin que el adaptador toque la base de datos.
 */

const createdSchema = z.object({ id: z.number().int() });

const generatedLineSchema = z.object({
  employeeId: z.number().int(),
  baseSalary: z.number(),
  isr: z.number(),
  imss: z.number(),
  infonavit: z.number(),
  subsidio: z.number(),
  netPay: z.number(),
  overtimePay: z.number().default(0),
  absenceDeduction: z.number().default(0),
});
export type ExternalPayrollLine = z.infer<typeof generatedLineSchema>;

/** Lo que el motor tiene guardado, tal cual (solo lectura, para mostrarlo). */
export interface EngineEmployee {
  id: number;
  name: string;
  position: string;
  baseSalary: number;
}
export interface EngineIncident {
  id: number;
  employeeId: number;
  period: string;
  type: string;
  hoursOrDays: number;
  amount: number;
}

/** Una llamada HTTP al motor, lista para registrarse. */
export interface EngineTransaction {
  at: Date;
  /** Servicio del motor al que se llamó: employees | incidents | payroll. */
  target: "employees" | "incidents" | "payroll";
  method: string;
  /** Ruta llamada, p. ej. /employees o /incidents/12. */
  path: string;
  /** Frase legible: "Alta de «Ana López» con sueldo de $12,000.00". */
  summary: string;
  /** null = no hubo respuesta (el motor no estaba disponible). */
  status: number | null;
  ok: boolean;
  durationMs: number;
  requestBody: unknown;
  responseBody: unknown;
  error: string | null;
}

type Observer = (tx: EngineTransaction) => void;
let observer: Observer | null = null;

const unavailable = () => AppError.serviceUnavailable("de nómina externo (SistemaNomina)");

const money = (pesos: number) => pesos.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** Las respuestas largas (el cálculo de toda la nómina) se recortan para no inflar la bitácora. */
function trimForLog(value: unknown, max = 20_000): unknown {
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value);
  return text.length <= max ? value : { recortado: true, bytes: text.length, vistaPrevia: text.slice(0, 600) };
}

interface Meta {
  target: EngineTransaction["target"];
  base: string;
  method: string;
  path: string;
  summary: string;
  body?: unknown;
}

/** Hace la llamada, la reporta al observador y devuelve la respuesta ya leída (el cuerpo se lee una sola vez). */
async function exchange(meta: Meta): Promise<{ res: Response; data: unknown }> {
  const started = Date.now();
  const at = new Date(started);
  let res: Response;
  try {
    res = await fetch(`${meta.base}${meta.path}`, {
      method: meta.method,
      headers: meta.body === undefined ? undefined : { "content-type": "application/json" },
      body: meta.body === undefined ? undefined : JSON.stringify(meta.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    report(meta, { at, status: null, ok: false, durationMs: Date.now() - started, responseBody: null, error: "El motor no respondió" });
    throw unavailable();
  }
  const data = await res.json().catch(() => null);
  report(meta, { at, status: res.status, ok: res.ok, durationMs: Date.now() - started, responseBody: data, error: res.ok ? null : `HTTP ${res.status}` });
  return { res, data };
}

function report(
  meta: Meta,
  r: { at: Date; status: number | null; ok: boolean; durationMs: number; responseBody: unknown; error: string | null }
): void {
  if (!observer) return;
  try {
    observer({
      at: r.at,
      target: meta.target,
      method: meta.method,
      path: meta.path,
      summary: meta.summary,
      status: r.status,
      ok: r.ok,
      durationMs: r.durationMs,
      requestBody: trimForLog(meta.body),
      responseBody: trimForLog(r.responseBody),
      error: r.error,
    });
  } catch (err) {
    // Que falle la bitácora nunca debe romper el cálculo de la nómina.
    logger.warn({ err }, "No se pudo registrar la transacción con el motor de nómina");
  }
}

function parse<T>(res: Response, data: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>, what: string): T {
  // 502/503/504 = el motor (o algo en medio) no está disponible. Un 500 es un error del propio motor.
  if (res.status > 500) throw unavailable();
  if (!res.ok) {
    logger.error({ status: res.status, what }, "El motor de nómina externo rechazó la petición");
    throw new AppError("INTERNAL_ERROR", `El motor de nómina externo rechazó la operación (${what})`, 502);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues, what }, "El motor de nómina externo respondió algo inesperado");
    throw new AppError("INTERNAL_ERROR", `El motor de nómina externo respondió algo inesperado (${what})`, 502);
  }
  return parsed.data;
}

export const nominaClient = {
  /** Registra cada llamada al motor (una sola función; la última que se registre es la que vale). */
  observe(fn: Observer | null): void {
    observer = fn;
  },

  /** ¿Responden los servicios del motor? (No se registra en la bitácora: se consulta cada pocos segundos.) */
  async ping(): Promise<boolean> {
    try {
      const checks = await Promise.all([
        fetch(`${config.NOMINA_EMPLOYEES_URL}/employees`, { signal: AbortSignal.timeout(2500) }),
        fetch(`${config.NOMINA_INCIDENTS_URL}/incidents`, { signal: AbortSignal.timeout(2500) }),
      ]);
      return checks.every((r) => r.ok);
    } catch {
      return false;
    }
  },

  /** Lo que el motor tiene guardado ahora mismo (solo lectura; no se registra en la bitácora). */
  async snapshot(): Promise<{ employees: EngineEmployee[]; incidents: EngineIncident[] }> {
    try {
      const [e, i] = await Promise.all([
        fetch(`${config.NOMINA_EMPLOYEES_URL}/employees`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${config.NOMINA_INCIDENTS_URL}/incidents`, { signal: AbortSignal.timeout(5000) }),
      ]);
      if (!e.ok || !i.ok) throw new Error("respuesta no válida");
      return { employees: (await e.json()) as EngineEmployee[], incidents: (await i.json()) as EngineIncident[] };
    } catch {
      throw unavailable();
    }
  },

  async createEmployee(input: { name: string; position: string; baseSalaryPesos: number }): Promise<number> {
    const { res, data } = await exchange({
      target: "employees",
      base: config.NOMINA_EMPLOYEES_URL,
      method: "POST",
      path: "/employees",
      summary: `Alta de «${input.name}» (${input.position}) con sueldo de ${money(input.baseSalaryPesos)}`,
      body: { name: input.name, position: input.position, baseSalary: input.baseSalaryPesos },
    });
    return parse(res, data, createdSchema, "alta de trabajador").id;
  },

  async createIncident(input: {
    employeeId: number;
    period: string;
    type: "OVERTIME" | "ABSENCE";
    hoursOrDays: number;
    amountPesos: number;
  }): Promise<number> {
    const what = input.type === "OVERTIME" ? `${input.hoursOrDays} h extra` : `${input.hoursOrDays} falta(s)`;
    const { res, data } = await exchange({
      target: "incidents",
      base: config.NOMINA_INCIDENTS_URL,
      method: "POST",
      path: "/incidents",
      summary: `Incidencia del empleado #${input.employeeId} en ${input.period}: ${what} por ${money(input.amountPesos)}`,
      body: {
        employeeId: input.employeeId,
        period: input.period,
        type: input.type,
        hoursOrDays: input.hoursOrDays,
        amount: input.amountPesos,
      },
    });
    return parse(res, data, createdSchema, "alta de incidencia").id;
  },

  /** El original responde 500 si la incidencia ya no existe; eso para nosotros es "ya está borrada". */
  async deleteIncident(externalId: number): Promise<void> {
    const { res } = await exchange({
      target: "incidents",
      base: config.NOMINA_INCIDENTS_URL,
      method: "DELETE",
      path: `/incidents/${externalId}`,
      summary: `Borrar la incidencia #${externalId} de un cálculo anterior`,
    });
    if (res.status === 404 || res.status === 500) return;
    if (!res.ok) throw unavailable();
  },

  async generate(period: string): Promise<ExternalPayrollLine[]> {
    const { res, data } = await exchange({
      target: "payroll",
      base: config.NOMINA_PAYROLL_URL,
      method: "POST",
      path: "/periods/generate",
      summary: `Calcular la nómina del periodo ${period} (ISR, IMSS, Infonavit y neto de todos sus empleados)`,
      body: { period },
    });
    return parse(res, data, z.array(generatedLineSchema), "cálculo de nómina");
  },
};
