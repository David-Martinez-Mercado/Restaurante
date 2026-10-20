import type { Compensation, ExternalIncident, Prisma, PayrollLine, PayrollRun } from "../generated/client/index.js";
import { prisma } from "../db.js";

export type { Compensation, ExternalIncident, PayrollLine, PayrollRun };
export type RunWithLines = PayrollRun & { lines: PayrollLine[] };
export type LineWithRun = PayrollLine & { run: PayrollRun };

export interface CompensationData {
  fullName: string;
  position: string;
  monthlySalaryCents: number;
  hireDate: string;
  active: boolean;
}

export type NewLine = Omit<Prisma.PayrollLineUncheckedCreateInput, "id" | "runId">;

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para nómina. */
export const payrollRepository = {
  // ---- sueldos ----

  async listCompensations(): Promise<Compensation[]> {
    return prisma.compensation.findMany({ orderBy: { fullName: "asc" } });
  },

  async findCompensation(userId: string): Promise<Compensation | null> {
    return prisma.compensation.findUnique({ where: { userId } });
  },

  async upsertCompensation(userId: string, data: CompensationData): Promise<Compensation> {
    return prisma.compensation.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  },

  async setExternal(userId: string, externalEmployeeId: number, externalSalaryCents: number): Promise<Compensation> {
    return prisma.compensation.update({ where: { userId }, data: { externalEmployeeId, externalSalaryCents } });
  },

  // ---- nóminas ----

  async listRuns(): Promise<RunWithLines[]> {
    return prisma.payrollRun.findMany({ orderBy: { period: "desc" }, take: 60, include: { lines: true } });
  },

  async findRun(period: string): Promise<RunWithLines | null> {
    return prisma.payrollRun.findUnique({ where: { period }, include: { lines: { orderBy: { fullName: "asc" } } } });
  },

  /**
   * Guarda la nómina del periodo reemplazando la anterior (si seguía sin aprobar).
   * Todo en una transacción: nunca queda una nómina a medias.
   */
  async saveRun(period: string, generatedBy: string, lines: NewLine[]): Promise<RunWithLines> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"payroll-run:" + period}))`;
      const existing = await tx.payrollRun.findUnique({ where: { period } });
      if (existing?.status === "approved") throw new Error("PAYROLL_ALREADY_APPROVED");

      if (existing) await tx.payrollLine.deleteMany({ where: { runId: existing.id } });
      const run = existing
        ? await tx.payrollRun.update({ where: { id: existing.id }, data: { generatedBy, status: "calculated", approvedBy: null, approvedAt: null } })
        : await tx.payrollRun.create({ data: { period, generatedBy } });

      await tx.payrollLine.createMany({ data: lines.map((l) => ({ ...l, runId: run.id })) });
      return tx.payrollRun.findUniqueOrThrow({ where: { id: run.id }, include: { lines: { orderBy: { fullName: "asc" } } } });
    });
  },

  /** Aprueba solo si sigue "calculated": dos aprobaciones simultáneas no se pisan. */
  async approve(period: string, approvedBy: string, at: Date): Promise<boolean> {
    const r = await prisma.payrollRun.updateMany({
      where: { period, status: "calculated" },
      data: { status: "approved", approvedBy, approvedAt: at },
    });
    return r.count === 1;
  },

  /** Recibos de una persona en nóminas ya aprobadas, el más reciente primero. */
  async approvedLinesOf(userId: string): Promise<LineWithRun[]> {
    return prisma.payrollLine.findMany({
      where: { userId, run: { status: "approved" } },
      include: { run: true },
      orderBy: { run: { period: "desc" } },
      take: 36,
    });
  },

  // ---- incidencias enviadas al motor externo ----

  async incidentsOf(period: string, userIds: string[]): Promise<ExternalIncident[]> {
    return prisma.externalIncident.findMany({ where: { period, userId: { in: userIds } } });
  },

  async forgetIncidents(ids: string[]): Promise<void> {
    await prisma.externalIncident.deleteMany({ where: { id: { in: ids } } });
  },

  async rememberIncident(data: { period: string; userId: string; kind: "OVERTIME" | "ABSENCE"; externalId: number }): Promise<void> {
    await prisma.externalIncident.create({ data });
  },
};
