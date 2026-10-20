import { Router } from "express";
import { asyncHandler, auditAction, requirePermission } from "@resto/http";
import { notificationController } from "../controllers/notification.controller.js";

/**
 * CAPA 1 — ROUTES: avisos. Las rutas /mine y /telegram van ANTES de /:id
 * para que no se interpreten como un id.
 */
export const notificationRouter = Router();

// ---- el propio cliente (campana) ----

notificationRouter.get("/mine", requirePermission("notifications:read-own"), asyncHandler(notificationController.listMine));
notificationRouter.get("/mine/unread-count", requirePermission("notifications:read-own"), asyncHandler(notificationController.unreadCount));
notificationRouter.post("/mine/read-all", requirePermission("notifications:read-own"), asyncHandler(notificationController.markAllRead));
notificationRouter.get("/telegram", requirePermission("notifications:read-own"), asyncHandler(notificationController.telegramInfo));

// ---- personal: bitácora de envíos ----

notificationRouter.get(
  "/",
  auditAction("notification-service", "notifications.outbox", "notification"),
  requirePermission("notifications:read-all"),
  asyncHandler(notificationController.outbox)
);

notificationRouter.patch("/:id/read", requirePermission("notifications:read-own"), asyncHandler(notificationController.markRead));
