import { Router } from "express";
import { asyncHandler, requirePermission, validate } from "@resto/http";
import { auditEventSchema } from "@resto/contracts";
import { internalKey } from "../middlewares/internalKey.js";
import { auditController } from "../controllers/audit.controller.js";

/**
 * CAPA 1 — ROUTES
 * Ingesta (solo servicios internos) y consulta (solo permiso audit:read).
 * Este servicio no se audita a sí mismo para evitar bucles.
 */
export const auditRouter = Router();

auditRouter.post(
  "/",
  internalKey(),
  validate(auditEventSchema),
  asyncHandler(auditController.record)
);

auditRouter.get(
  "/",
  requirePermission("audit:read"),
  asyncHandler(auditController.list)
);

auditRouter.get(
  "/summary",
  requirePermission("audit:read"),
  asyncHandler(auditController.summary)
);
