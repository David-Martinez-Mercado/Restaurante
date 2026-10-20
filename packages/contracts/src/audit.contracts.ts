import { z } from "zod";

/**
 * ACCOUNTING (tercera "A"): evento de auditoría que todos los servicios
 * (y el gateway) envían al Audit Service. Responde a: ¿quién hizo qué,
 * sobre qué, cuándo y con qué resultado?
 */
export const AUDIT_OUTCOMES = ["success", "failure", "denied"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const auditEventSchema = z.object({
  service: z.string().min(1).max(50),
  action: z.string().min(1).max(100),
  resource: z.string().min(1).max(100),
  resourceId: z.string().max(100).optional(),
  outcome: z.enum(AUDIT_OUTCOMES),
  statusCode: z.number().int().optional(),
  userId: z.string().max(100).optional(),
  username: z.string().max(100).optional(),
  role: z.string().max(50).optional(),
  method: z.string().max(10).optional(),
  path: z.string().max(300).optional(),
  ip: z.string().max(64).optional(),
  requestId: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type AuditEventInput = z.infer<typeof auditEventSchema>;

export const auditQuerySchema = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  service: z.string().optional(),
  action: z.string().optional(),
  outcome: z.enum(AUDIT_OUTCOMES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditLogDTO extends Omit<AuditEventInput, "metadata"> {
  id: string;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

export interface AuditSummaryDTO {
  total: number;
  byOutcome: Record<string, number>;
  byAction: { action: string; count: number }[];
  byUser: { username: string; count: number }[];
}
