import type { AttendanceRecord, AttendanceSource, Prisma } from "../generated/client/index.js";
import { prisma } from "../db.js";

export type { AttendanceRecord };

export interface NewRecord {
  userId: string;
  username: string;
  clockIn: Date;
  clockOut?: Date | null;
  source: AttendanceSource;
  note?: string | null;
  createdBy: string;
}

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para el checador. */
export const attendanceRepository = {
  /**
   * Crea la entrada solo si la persona no tiene ya una jornada abierta.
   * El candado consultivo por usuario evita que dos toques simultáneos abran dos jornadas.
   */
  async openIfNone(data: NewRecord): Promise<{ ok: true; record: AttendanceRecord } | { ok: false; open: AttendanceRecord }> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"attendance:" + data.userId}))`;
      const open = await tx.attendanceRecord.findFirst({ where: { userId: data.userId, clockOut: null }, orderBy: { clockIn: "desc" } });
      if (open) return { ok: false as const, open };
      return { ok: true as const, record: await tx.attendanceRecord.create({ data }) };
    });
  },

  async findOpen(userId: string): Promise<AttendanceRecord | null> {
    return prisma.attendanceRecord.findFirst({ where: { userId, clockOut: null }, orderBy: { clockIn: "desc" } });
  },

  async findById(id: string): Promise<AttendanceRecord | null> {
    return prisma.attendanceRecord.findUnique({ where: { id } });
  },

  async create(data: NewRecord): Promise<AttendanceRecord> {
    return prisma.attendanceRecord.create({ data });
  },

  async update(id: string, data: Prisma.AttendanceRecordUncheckedUpdateInput): Promise<AttendanceRecord> {
    return prisma.attendanceRecord.update({ where: { id }, data });
  },

  /** Jornadas de la persona que se traslapan con [from, to). `to = null` = abierta. */
  async findOverlapping(userId: string, from: Date, to: Date | null, excludeId?: string): Promise<AttendanceRecord[]> {
    return prisma.attendanceRecord.findMany({
      where: {
        userId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        ...(to ? { clockIn: { lt: to } } : {}),
        OR: [{ clockOut: null }, { clockOut: { gt: from } }],
      },
    });
  },

  /** Jornadas con ENTRADA dentro de [from, toExclusive). */
  async findBetween(filter: { userId?: string; from: Date; toExclusive: Date; limit: number }): Promise<AttendanceRecord[]> {
    return prisma.attendanceRecord.findMany({
      where: { userId: filter.userId, clockIn: { gte: filter.from, lt: filter.toExclusive } },
      orderBy: { clockIn: "desc" },
      take: filter.limit,
    });
  },

  /** Primera entrada que existe de cada persona (para saber desde cuándo contar faltas). */
  async firstClockIns(userIds?: string[]): Promise<Map<string, Date>> {
    const rows = await prisma.attendanceRecord.groupBy({
      by: ["userId"],
      where: userIds ? { userId: { in: userIds } } : undefined,
      _min: { clockIn: true },
    });
    return new Map(rows.flatMap((r) => (r._min.clockIn ? [[r.userId, r._min.clockIn] as const] : [])));
  },
};
