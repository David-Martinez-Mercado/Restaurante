import { Router } from "express";
import {
  asyncHandler,
  auditAction,
  requirePermission,
  validate,
} from "@resto/http";
import {
  createTableSchema,
  tableStatusSchema,
  updateTableSchema,
} from "@resto/contracts";
import { tableController } from "../controllers/table.controller.js";

/** CAPA 1 — ROUTES: mesas del salón. Cada ruta exige un permiso. */
export const tableRouter = Router();

tableRouter.get(
  "/",
  requirePermission("tables:read"),
  asyncHandler(tableController.list)
);

tableRouter.get(
  "/:id",
  requirePermission("tables:read"),
  asyncHandler(tableController.get)
);

tableRouter.post(
  "/",
  auditAction("menu-service", "tables.create", "table"),
  requirePermission("tables:write"),
  validate(createTableSchema),
  asyncHandler(tableController.create)
);

tableRouter.put(
  "/:id",
  auditAction("menu-service", "tables.update", "table"),
  requirePermission("tables:write"),
  validate(updateTableSchema),
  asyncHandler(tableController.update)
);

tableRouter.patch(
  "/:id/status",
  auditAction("menu-service", "tables.status", "table"),
  requirePermission("tables:update-status", "tables:write"),
  validate(tableStatusSchema),
  asyncHandler(tableController.setStatus)
);

tableRouter.delete(
  "/:id",
  auditAction("menu-service", "tables.delete", "table"),
  requirePermission("tables:write"),
  asyncHandler(tableController.remove)
);
