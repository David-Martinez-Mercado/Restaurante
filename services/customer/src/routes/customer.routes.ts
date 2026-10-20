import { Router } from "express";
import { asyncHandler, auditAction, requirePermission, validate } from "@resto/http";
import { customerProfileSchema } from "@resto/contracts";
import { customerController } from "../controllers/customer.controller.js";

/**
 * CAPA 1 — ROUTES: clientes. Las rutas /me (el propio cliente) van ANTES de /:id
 * para que "me" no se interprete como un id.
 */
export const customerRouter = Router();

customerRouter.get("/me", requirePermission("customers:self"), asyncHandler(customerController.getMine));

customerRouter.put(
  "/me",
  auditAction("customer-service", "customers.self-update", "customer"),
  requirePermission("customers:self"),
  validate(customerProfileSchema),
  asyncHandler(customerController.putMine)
);

customerRouter.post(
  "/me/telegram-link",
  auditAction("customer-service", "customers.telegram-link-code", "customer"),
  requirePermission("customers:self"),
  asyncHandler(customerController.createLinkCode)
);

customerRouter.delete(
  "/me/telegram",
  auditAction("customer-service", "customers.telegram-unlink", "customer"),
  requirePermission("customers:self"),
  asyncHandler(customerController.unlinkTelegram)
);

// ---- Personal: buscar un cliente para ligarlo a un pedido o reservación ----

customerRouter.get(
  "/",
  auditAction("customer-service", "customers.list", "customer"),
  requirePermission("customers:read"),
  asyncHandler(customerController.list)
);

customerRouter.get("/:id", requirePermission("customers:read"), asyncHandler(customerController.get));
