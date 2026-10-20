import type { AuditLog, Prisma } from "../generated/client/index.js";
import type {
  AuditEventInput,
  AuditLogDTO,
  AuditQuery,
  AuditSummaryDTO,
} from "@resto/contracts";
import { auditLogRepository } from "../repositories/auditLog.repository.js";

function toDTO(log: AuditLog): AuditLogDTO {
  return {
    id: log.id,
    occurredAt: log.occurredAt.toISOString(),
    service: log.service,
    action: log.action,
    resource: log.resource,
    resourceId: log.resourceId ?? undefined,
    outcome: log.outcome,
    statusCode: log.statusCode ?? undefined,
    userId: log.userId ?? undefined,
    username: log.username ?? undefined,
    role: log.role ?? undefined,
    method: log.method ?? undefined,
    path: log.path ?? undefined,
    ip: log.ip ?? undefined,
    requestId: log.requestId ?? undefined,
    metadata: (log.metadata as Record<string, unknown> | null) ?? null,
  };
}

function buildWhere(query: AuditQuery): Prisma.AuditLogWhereInput {
  return {
    userId: query.userId,
    username: query.username,
    service: query.service,
    action: query.action,
    outcome: query.outcome,
    occurredAt:
      query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
  };
}

/** CAPA 3 — SERVICE: registro y consulta de eventos de auditoría. */
export const auditService = {
  async record(event: AuditEventInput): Promise<void> {
    const { metadata, ...rest } = event;
    await auditLogRepository.create({
      ...rest,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    });
  },

  async list(query: AuditQuery) {
    const { rows, total } = await auditLogRepository.findMany(
      buildWhere(query),
      query.limit,
      query.offset
    );
    return { data: rows.map(toDTO), total, limit: query.limit, offset: query.offset };
  },

  /** "Contabilizar": cuántas acciones, de quién y con qué resultado. */
  async summary(query: AuditQuery): Promise<AuditSummaryDTO> {
    const result = await auditLogRepository.summarize(buildWhere(query));
    return {
      total: result.total,
      byOutcome: Object.fromEntries(
        result.byOutcome.map((r) => [r.outcome, r._count._all])
      ),
      byAction: result.byAction.map((r) => ({
        action: r.action,
        count: r._count._all,
      })),
      byUser: result.byUser.flatMap((r) =>
        r.username ? [{ username: r.username, count: r._count._all }] : []
      ),
    };
  },
};
