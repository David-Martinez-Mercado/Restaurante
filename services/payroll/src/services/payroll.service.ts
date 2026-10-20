import { AppError, type Role } from "@resto/core";
import type {
  CompensationDTO,
  CompensationInput,
  PayrollEngineStatusDTO,
  PayrollLineDTO,
  PayrollRunDTO,
  PayslipDTO,
} from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";
import { attendanceClient } from "../clients/attendance.client.js";
import { nominaClient } from "../clients/nomina.client.js";
import {
  centsToPesos,
  computeAdjustments,
  currentPeriod,
  isRealDate,
  lastDayOf,
  pesosToCents,
  type PayConfig,
} from "../domain/payroll.js";
import {
  payrollRepository,
  type Compensation,
  type NewLine,
  type PayrollLine,
  type RunWithLines,
} from "../repositories/payroll.repository.js";

export interface Actor {
  userId: string;
  username: string;
  role: Role;
  requestId: string;
}

const defaultPay: PayConfig = { overtimeMultiplier: config.PAYROLL_OVERTIME_MULTIPLIER, dailyHours: config.PAYROLL_DAILY_HOURS };

function lineDTO(l: PayrollLine): PayrollLineDTO {
  return {
    userId: l.userId,
    fullName: l.fullName,
    position: l.position,
    baseSalaryCents: l.baseSalaryCents,
    hoursWorked: l.hoursWorked,
    overtimeHours: l.overtimeHours,
    overtimePayCents: l.overtimePayCents,
    absenceDays: l.absenceDays,
    absenceDeductionCents: l.absenceDeductionCents,
    taxableCents: l.taxableCents,
    isrCents: l.isrCents,
    imssCents: l.imssCents,
    infonavitCents: l.infonavitCents,
    subsidioCents: l.subsidioCents,
    netPayCents: l.netPayCents,
  };
}

function runDTO(run: RunWithLines, withLines: boolean): PayrollRunDTO {
  const sum = (f: (l: PayrollLine) => number) => run.lines.reduce((s, l) => s + f(l), 0);
  return {
    id: run.id,
    period: run.period,
    status: run.status,
    generatedBy: run.generatedBy,
    approvedBy: run.approvedBy,
    approvedAt: run.approvedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    totals: {
      taxableCents: sum((l) => l.taxableCents),
      deductionsCents: sum((l) => l.isrCents + l.imssCents + l.infonavitCents),
      netCents: sum((l) => l.netPayCents),
    },
    lines: withLines ? run.lines.map(lineDTO) : [],
  };
}

function compensationDTO(c: Compensation): CompensationDTO {
  return {
    userId: c.userId,
    fullName: c.fullName,
    position: c.position,
    monthlySalaryCents: c.monthlySalaryCents,
    hireDate: c.hireDate,
    active: c.active,
    synced: c.externalEmployeeId !== null && c.externalSalaryCents === c.monthlySalaryCents,
    updatedAt: c.updatedAt.toISOString(),
  };
}

/**
 * Los cálculos se hacen de uno en uno: el motor externo borra y recrea la nómina del periodo completo,
 * y dos corridas simultáneas se pisarían entre sí.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Da de alta (o de alta otra vez, si cambió el sueldo) al trabajador en el motor externo. */
async function ensureExternalEmployee(c: Compensation): Promise<number> {
  if (c.externalEmployeeId !== null && c.externalSalaryCents === c.monthlySalaryCents) return c.externalEmployeeId;
  // El motor original no permite editar a un empleado: con otro sueldo se da de alta uno nuevo y se usa ese.
  const id = await nominaClient.createEmployee({ name: c.fullName, position: c.position, baseSalaryPesos: centsToPesos(c.monthlySalaryCents) });
  await payrollRepository.setExternal(c.userId, id, c.monthlySalaryCents);
  return id;
}

/** CAPA 3 — SERVICE: sueldos, cálculo de nómina (con el motor externo) y recibos. */
export const payrollService = {
  // ---------------------------------------------------------------- sueldos

  async listCompensations(): Promise<CompensationDTO[]> {
    return (await payrollRepository.listCompensations()).map(compensationDTO);
  },

  async saveCompensation(userId: string, input: CompensationInput): Promise<CompensationDTO> {
    if (!isRealDate(input.hireDate)) {
      throw AppError.validation("Fecha inválida", [{ field: "hireDate", issue: "Use una fecha real AAAA-MM-DD" }]);
    }
    return compensationDTO(await payrollRepository.upsertCompensation(userId, input));
  },

  // ---------------------------------------------------------------- cálculo

  /**
   * Calcula la nómina de un periodo:
   *  1. da de alta en el motor externo a quien aún no esté;
   *  2. toma del checador las horas extra y faltas de cada quien (calculadas con NUESTRAS reglas);
   *  3. las manda al motor como incidencias (reemplazando las de un cálculo anterior);
   *  4. el motor calcula ISR/IMSS/Infonavit/subsidio y el neto;
   *  5. se guarda el resultado, porque el motor original no permite consultarlo después.
   */
  calculate(period: string, actor: Actor, now = new Date(), pay: PayConfig = defaultPay): Promise<PayrollRunDTO> {
    return serialized(async () => {
      if (period > currentPeriod(now)) {
        throw AppError.validation("Periodo inválido", [{ field: "period", issue: "No se puede calcular la nómina de un mes que aún no empieza" }]);
      }
      const existing = await payrollRepository.findRun(period);
      if (existing?.status === "approved") throw AppError.conflict("La nómina de ese periodo ya está aprobada y no se puede recalcular");

      const staff = (await payrollRepository.listCompensations()).filter((c) => c.active && c.hireDate <= lastDayOf(period));
      if (staff.length === 0) throw AppError.conflict("No hay trabajadores activos con sueldo registrado para ese periodo");

      if (!(await nominaClient.ping())) throw AppError.serviceUnavailable("de nómina externo (SistemaNomina)");

      // 1 y 2. alta en el motor + asistencia de cada quien
      const prepared: { comp: Compensation; externalId: number; hoursWorked: number; overtimeHours: number; absences: number; overtimePayCents: number; absenceDeductionCents: number }[] = [];
      for (const comp of staff) {
        const externalId = await ensureExternalEmployee(comp);
        const att = await attendanceClient.summary(
          { userId: comp.userId, username: comp.fullName, period, since: comp.hireDate },
          actor.requestId
        );
        const adj = computeAdjustments({ monthlySalaryCents: comp.monthlySalaryCents, overtimeHours: att.overtimeHours, absences: att.absences }, pay);
        prepared.push({ comp, externalId, hoursWorked: att.hoursWorked, overtimeHours: att.overtimeHours, absences: att.absences, ...adj });
      }

      // 3. incidencias: se borran las de un cálculo anterior y se mandan las nuevas
      const old = await payrollRepository.incidentsOf(period, staff.map((c) => c.userId));
      for (const o of old) await nominaClient.deleteIncident(o.externalId);
      if (old.length > 0) await payrollRepository.forgetIncidents(old.map((o) => o.id));

      for (const p of prepared) {
        if (p.overtimeHours > 0 && p.overtimePayCents > 0) {
          const externalId = await nominaClient.createIncident({
            employeeId: p.externalId, period, type: "OVERTIME", hoursOrDays: p.overtimeHours, amountPesos: centsToPesos(p.overtimePayCents),
          });
          await payrollRepository.rememberIncident({ period, userId: p.comp.userId, kind: "OVERTIME", externalId });
        }
        if (p.absences > 0 && p.absenceDeductionCents > 0) {
          const externalId = await nominaClient.createIncident({
            employeeId: p.externalId, period, type: "ABSENCE", hoursOrDays: p.absences, amountPesos: centsToPesos(p.absenceDeductionCents),
          });
          await payrollRepository.rememberIncident({ period, userId: p.comp.userId, kind: "ABSENCE", externalId });
        }
      }

      // 4. el motor calcula impuestos y neto de TODOS sus empleados; nos quedamos con los nuestros
      const results = new Map((await nominaClient.generate(period)).map((r) => [r.employeeId, r]));

      const lines: NewLine[] = prepared.map((p) => {
        const r = results.get(p.externalId);
        if (!r) throw new AppError("INTERNAL_ERROR", `El motor de nómina no devolvió el cálculo de ${p.comp.fullName}`, 502);

        const overtimePayCents = pesosToCents(r.overtimePay);
        const absenceDeductionCents = pesosToCents(r.absenceDeduction);
        if (Math.abs(overtimePayCents - p.overtimePayCents) > 1 || Math.abs(absenceDeductionCents - p.absenceDeductionCents) > 1) {
          logger.warn({ userId: p.comp.userId, sent: [p.overtimePayCents, p.absenceDeductionCents], used: [overtimePayCents, absenceDeductionCents] }, "El motor usó incidencias distintas a las enviadas");
        }
        const baseSalaryCents = pesosToCents(r.baseSalary);
        return {
          userId: p.comp.userId,
          fullName: p.comp.fullName,
          position: p.comp.position,
          baseSalaryCents,
          hoursWorked: p.hoursWorked,
          overtimeHours: p.overtimeHours,
          overtimePayCents,
          absenceDays: p.absences,
          absenceDeductionCents,
          taxableCents: Math.max(0, baseSalaryCents + overtimePayCents - absenceDeductionCents),
          isrCents: pesosToCents(r.isr),
          imssCents: pesosToCents(r.imss),
          infonavitCents: pesosToCents(r.infonavit),
          subsidioCents: pesosToCents(r.subsidio),
          netPayCents: pesosToCents(r.netPay),
        };
      });

      // 5. se conserva el resultado
      try {
        return runDTO(await payrollRepository.saveRun(period, actor.userId, lines), true);
      } catch (err) {
        if (err instanceof Error && err.message === "PAYROLL_ALREADY_APPROVED") {
          throw AppError.conflict("La nómina de ese periodo ya fue aprobada mientras se calculaba");
        }
        throw err;
      }
    });
  },

  async listRuns(): Promise<PayrollRunDTO[]> {
    return (await payrollRepository.listRuns()).map((r) => runDTO(r, false));
  },

  async getRun(period: string): Promise<PayrollRunDTO> {
    const run = await payrollRepository.findRun(period);
    if (!run) throw AppError.notFound("Nómina de ese periodo");
    return runDTO(run, true);
  },

  /** Solo el administrador aprueba, y nunca quien la calculó (separación de funciones). */
  async approve(period: string, actor: Actor, now = new Date()): Promise<PayrollRunDTO> {
    const run = await payrollRepository.findRun(period);
    if (!run) throw AppError.notFound("Nómina de ese periodo");
    if (run.status === "approved") throw AppError.conflict("Esa nómina ya está aprobada");
    if (run.generatedBy === actor.userId) {
      throw AppError.conflict("Quien calculó la nómina no puede aprobarla: pide a otra persona (p. ej. el administrador) que lo haga");
    }
    if (!(await payrollRepository.approve(period, actor.userId, now))) throw AppError.conflict("Esa nómina ya fue aprobada");
    return payrollService.getRun(period);
  },

  // ---------------------------------------------------------------- recibos propios

  /** Recibos de nómina YA APROBADA de quien consulta. Nunca los de otra persona. */
  async payslips(userId: string): Promise<PayslipDTO[]> {
    return (await payrollRepository.approvedLinesOf(userId)).map((l) => ({
      ...lineDTO(l),
      period: l.run.period,
      approvedAt: l.run.approvedAt?.toISOString() ?? null,
    }));
  },

  // ---------------------------------------------------------------- estado del motor externo

  async engineStatus(): Promise<PayrollEngineStatusDTO> {
    return {
      available: await nominaClient.ping(),
      employeesUrl: config.NOMINA_EMPLOYEES_URL,
      payrollUrl: config.NOMINA_PAYROLL_URL,
      incidentsUrl: config.NOMINA_INCIDENTS_URL,
    };
  },
};
