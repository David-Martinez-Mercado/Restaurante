import { Router } from "express";
import { asyncHandler, auditAction, requirePermission, validate } from "@resto/http";
import { compensationSchema, generatePayrollSchema } from "@resto/contracts";
import { payrollController } from "../controllers/payroll.controller.js";

/**
 * CAPA 1 — ROUTES: nómina.
 * Segregación de funciones: el gerente captura sueldos y CALCULA; solo el administrador APRUEBA.
 * Cada trabajador ve únicamente sus propios recibos (de nóminas ya aprobadas).
 */
export const payrollRouter = Router();

// ---- recibos propios ----

payrollRouter.get("/me", requirePermission("payroll:read-own"), asyncHandler(payrollController.payslips));

// ---- sueldos ----

payrollRouter.get("/compensations", requirePermission("payroll:read-all"), asyncHandler(payrollController.listCompensations));

payrollRouter.put(
  "/compensations/:userId",
  auditAction("payroll-service", "payroll.compensation-save", "compensation"),
  requirePermission("payroll:manage"),
  validate(compensationSchema),
  asyncHandler(payrollController.saveCompensation)
);

// ---- nóminas ----

payrollRouter.get("/engine", requirePermission("payroll:read-all"), asyncHandler(payrollController.engineStatus));

payrollRouter.get("/runs", requirePermission("payroll:read-all"), asyncHandler(payrollController.listRuns));

payrollRouter.post(
  "/runs",
  auditAction("payroll-service", "payroll.calculate", "payroll"),
  requirePermission("payroll:calculate"),
  validate(generatePayrollSchema),
  asyncHandler(payrollController.calculate)
);

payrollRouter.get("/runs/:period", requirePermission("payroll:read-all"), asyncHandler(payrollController.getRun));

payrollRouter.post(
  "/runs/:period/approve",
  auditAction("payroll-service", "payroll.approve", "payroll"),
  requirePermission("payroll:approve"),
  asyncHandler(payrollController.approve)
);
