import { Router } from "express";
import {
  asyncHandler,
  auditAction,
  requirePermission,
  validate,
} from "@resto/http";
import {
  createDishSchema,
  dishAvailabilitySchema,
  updateDishSchema,
} from "@resto/contracts";
import { dishController } from "../controllers/dish.controller.js";

/** CAPA 1 — ROUTES: catálogo de platillos. Cada ruta exige un permiso. */
export const dishRouter = Router();

dishRouter.get(
  "/",
  requirePermission("dishes:read"),
  asyncHandler(dishController.list)
);

dishRouter.get(
  "/:id",
  requirePermission("dishes:read"),
  asyncHandler(dishController.get)
);

dishRouter.post(
  "/",
  auditAction("menu-service", "dishes.create", "dish"),
  requirePermission("dishes:write"),
  validate(createDishSchema),
  asyncHandler(dishController.create)
);

dishRouter.put(
  "/:id",
  auditAction("menu-service", "dishes.update", "dish"),
  requirePermission("dishes:write"),
  validate(updateDishSchema),
  asyncHandler(dishController.update)
);

dishRouter.patch(
  "/:id/availability",
  auditAction("menu-service", "dishes.availability", "dish"),
  requirePermission("dishes:availability", "dishes:write"),
  validate(dishAvailabilitySchema),
  asyncHandler(dishController.setAvailability)
);

dishRouter.delete(
  "/:id",
  auditAction("menu-service", "dishes.delete", "dish"),
  requirePermission("dishes:write"),
  asyncHandler(dishController.remove)
);
