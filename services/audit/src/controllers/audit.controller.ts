import type { Request, Response } from "express";
import { AppError } from "@resto/core";
import { auditQuerySchema, type AuditEventInput } from "@resto/contracts";
import { auditService } from "../services/audit.service.js";

/** En Express 5 `req.query` es de solo lectura: se valida aquí, no en middleware. */
function parseQuery(req: Request) {
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw AppError.validation(
      "Parámetros de consulta inválidos",
      parsed.error.issues.map((i) => ({
        field: i.path.join(".") || "(root)",
        issue: i.message,
      }))
    );
  }
  return parsed.data;
}

/** CAPA 2 — CONTROLLER */
export const auditController = {
  async record(req: Request, res: Response): Promise<void> {
    await auditService.record(req.body as AuditEventInput);
    res.status(202).json({ success: true });
  },

  async list(req: Request, res: Response): Promise<void> {
    const result = await auditService.list(parseQuery(req));
    res.status(200).json({ success: true, ...result });
  },

  async summary(req: Request, res: Response): Promise<void> {
    const data = await auditService.summary(parseQuery(req));
    res.status(200).json({ success: true, data });
  },
};
