import { Router } from "express";
import { asyncHandler, auditAction, requirePermission, validate } from "@resto/http";
import { taxCalculateSchema } from "@resto/contracts";
import { taxController } from "../controllers/tax.controller.js";

/** CAPA 1 — ROUTES: calculadora de IVA (sin estado) y reporte de IVA trasladado. */
export const taxRouter = Router();

taxRouter.post(
  "/calculate",
  requirePermission("tax:calculate"),
  validate(taxCalculateSchema),
  taxController.calculate
);

taxRouter.get(
  "/report",
  auditAction("order-service", "tax.report", "tax"),
  requirePermission("tax:report"),
  asyncHandler(taxController.report)
);
