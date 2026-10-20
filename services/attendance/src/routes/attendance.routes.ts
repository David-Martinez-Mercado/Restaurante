import { Router } from "express";
import { asyncHandler, auditAction, requirePermission, validate } from "@resto/http";
import { editAttendanceSchema, manualAttendanceSchema } from "@resto/contracts";
import { attendanceController } from "../controllers/attendance.controller.js";

/**
 * CAPA 1 — ROUTES: checador. Las rutas fijas (/me, /summary, /manual) van ANTES de /:id.
 * Cualquier trabajador checa lo suyo; solo el gerente ve todo y corrige.
 */
export const attendanceRouter = Router();

// ---- el propio trabajador ----

attendanceRouter.post(
  "/clock-in",
  auditAction("attendance-service", "attendance.clock-in", "attendance"),
  requirePermission("attendance:clock"),
  asyncHandler(attendanceController.clockIn)
);

attendanceRouter.post(
  "/clock-out",
  auditAction("attendance-service", "attendance.clock-out", "attendance"),
  requirePermission("attendance:clock"),
  asyncHandler(attendanceController.clockOut)
);

attendanceRouter.get("/me/status", requirePermission("attendance:clock"), asyncHandler(attendanceController.status));
attendanceRouter.get("/me/summary", requirePermission("attendance:clock"), asyncHandler(attendanceController.summaryMine));
attendanceRouter.get("/me", requirePermission("attendance:clock"), asyncHandler(attendanceController.listMine));

// ---- gerencia ----

attendanceRouter.get("/summary", requirePermission("attendance:read-all"), asyncHandler(attendanceController.summary));

attendanceRouter.post(
  "/manual",
  auditAction("attendance-service", "attendance.manual-create", "attendance"),
  requirePermission("attendance:manage"),
  validate(manualAttendanceSchema),
  asyncHandler(attendanceController.manualCreate)
);

attendanceRouter.get("/", requirePermission("attendance:read-all"), asyncHandler(attendanceController.list));

attendanceRouter.patch(
  "/:id",
  auditAction("attendance-service", "attendance.edit", "attendance"),
  requirePermission("attendance:manage"),
  validate(editAttendanceSchema),
  asyncHandler(attendanceController.edit)
);
