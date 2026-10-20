import { Router } from "express";
import { asyncHandler, internalKey } from "@resto/http";
import { attendanceController } from "../controllers/attendance.controller.js";

/**
 * Rutas de uso exclusivo de otros servicios (llave interna, sin JWT de usuario).
 * El Payroll Service pide aquí el resumen de asistencia de cada trabajador. El gateway no las publica.
 */
export const internalRouter = Router();

internalRouter.use(internalKey());

internalRouter.get("/summary", asyncHandler(attendanceController.summaryInternal));
