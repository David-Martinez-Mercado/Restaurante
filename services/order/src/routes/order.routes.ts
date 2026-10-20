import { Router } from "express";
import {
  asyncHandler,
  auditAction,
  requirePermission,
  validate,
} from "@resto/http";
import {
  createOnlineOrderSchema,
  createOrderSchema,
  updateOrderStatusSchema,
} from "@resto/contracts";
import { orderController } from "../controllers/order.controller.js";

/**
 * CAPA 1 — ROUTES: pedidos. Cada ruta exige un permiso.
 * Las rutas del cliente en línea (/online, /mine) van ANTES de /:id para que
 * "mine" no se interprete como un id.
 */
export const orderRouter = Router();

// ---- Cliente en línea ----

orderRouter.post(
  "/online",
  auditAction("order-service", "orders.create-online", "order"),
  requirePermission("orders:create-online"),
  validate(createOnlineOrderSchema),
  asyncHandler(orderController.createOnline)
);

orderRouter.get("/mine", requirePermission("orders:read-own"), asyncHandler(orderController.listMine));

orderRouter.get("/mine/:id", requirePermission("orders:read-own"), asyncHandler(orderController.getMine));

// ---- Personal ----

orderRouter.get(
  "/",
  requirePermission("orders:read"),
  asyncHandler(orderController.list)
);

orderRouter.get(
  "/:id",
  requirePermission("orders:read"),
  asyncHandler(orderController.get)
);

orderRouter.post(
  "/",
  auditAction("order-service", "orders.create", "order"),
  requirePermission("orders:create"),
  validate(createOrderSchema),
  asyncHandler(orderController.create)
);

// El permiso exacto depende de la transición (preparar, servir, cobrar,
// cancelar) y se verifica en el service; aquí se exige al menos uno.
orderRouter.patch(
  "/:id/status",
  auditAction("order-service", "orders.status", "order"),
  requirePermission(
    "orders:prepare",
    "orders:serve",
    "orders:pay",
    "orders:cancel"
  ),
  validate(updateOrderStatusSchema),
  asyncHandler(orderController.changeStatus)
);
