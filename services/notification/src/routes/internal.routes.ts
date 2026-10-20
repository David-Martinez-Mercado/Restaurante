import { Router } from "express";
import { asyncHandler, internalKey, validate } from "@resto/http";
import { notificationEventSchema } from "@resto/contracts";
import { notificationController } from "../controllers/notification.controller.js";

/**
 * Entrada de eventos de dominio desde los demás servicios (llave interna, sin JWT).
 * El gateway no la publica.
 */
export const internalRouter = Router();

internalRouter.use(internalKey());

internalRouter.post("/events", validate(notificationEventSchema), asyncHandler(notificationController.receiveEvent));
