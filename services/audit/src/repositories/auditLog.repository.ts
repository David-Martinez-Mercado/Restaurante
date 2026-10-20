import type { AuditLog, Prisma } from "../generated/client/index.js";
import { prisma } from "../db.js";

/** CAPA 4 — REPOSITORY: bitácora append-only (solo crea y consulta). */
export const auditLogRepository = {
  async create(data: Prisma.AuditLogCreateInput): Promise<AuditLog> {
    return prisma.auditLog.create({ data });
  },

  async findMany(
    where: Prisma.AuditLogWhereInput,
    limit: number,
    offset: number
  ): Promise<{ rows: AuditLog[]; total: number }> {
    const [rows, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return { rows, total };
  },

  async summarize(where: Prisma.AuditLogWhereInput) {
    const [total, byOutcome, byAction, byUser] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.groupBy({
        by: ["outcome"],
        where,
        _count: { _all: true },
      }),
      prisma.auditLog.groupBy({
        by: ["action"],
        where,
        _count: { _all: true },
        orderBy: { _count: { action: "desc" } },
        take: 10,
      }),
      prisma.auditLog.groupBy({
        by: ["username"],
        where: { ...where, username: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { username: "desc" } },
        take: 10,
      }),
    ]);
    return { total, byOutcome, byAction, byUser };
  },
};
