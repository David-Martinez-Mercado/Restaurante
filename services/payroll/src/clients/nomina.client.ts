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

const unavailable = () => AppError.serviceUnavailable("de nómina externo (SistemaNomina)");

async function call(method: string, base: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw unavailable();
  }
}

async function json<T>(res: Response, schema: z.ZodType<T, z.ZodTypeDef, unknown>, what: string): Promise<T> {
  // 502/503/504 = el motor (o algo en medio) no está disponible. Un 500 es un error del propio motor.
  if (res.status > 500) throw unavailable();
  if (!res.ok) {
    logger.error({ status: res.status, what }, "El motor de nómina externo rechazó la petición");
    throw new AppError("INTERNAL_ERROR", `El motor de nómina externo rechazó la operación (${what})`, 502);
  }
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    logger.error({ issues: parsed.error.issues, what }, "El motor de nómina externo respondió algo inesperado");
    throw new AppError("INTERNAL_ERROR", `El motor de nómina externo respondió algo inesperado (${what})`, 502);
  }
  return parsed.data;
}

export const nominaClient = {
  /** ¿Responden los tres servicios del motor? */
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

  async createEmployee(input: { name: string; position: string; baseSalaryPesos: number }): Promise<number> {
    const res = await call("POST", config.NOMINA_EMPLOYEES_URL, "/employees", {
      name: input.name,
      position: input.position,
      baseSalary: input.baseSalaryPesos,
    });
    return (await json(res, createdSchema, "alta de trabajador")).id;
  },

  async createIncident(input: {
    employeeId: number;
    period: string;
    type: "OVERTIME" | "ABSENCE";
    hoursOrDays: number;
    amountPesos: number;
  }): Promise<number> {
    const res = await call("POST", config.NOMINA_INCIDENTS_URL, "/incidents", {
      employeeId: input.employeeId,
      period: input.period,
      type: input.type,
      hoursOrDays: input.hoursOrDays,
      amount: input.amountPesos,
    });
    return (await json(res, createdSchema, "alta de incidencia")).id;
  },

  /** El original responde 500 si la incidencia ya no existe; eso para nosotros es "ya está borrada". */
  async deleteIncident(externalId: number): Promise<void> {
    const res = await call("DELETE", config.NOMINA_INCIDENTS_URL, `/incidents/${externalId}`);
    if (res.status === 404 || res.status === 500) return;
    if (!res.ok) throw unavailable();
  },

  async generate(period: string): Promise<ExternalPayrollLine[]> {
    const res = await call("POST", config.NOMINA_PAYROLL_URL, "/periods/generate", { period });
    return json(res, z.array(generatedLineSchema), "cálculo de nómina");
  },
};
