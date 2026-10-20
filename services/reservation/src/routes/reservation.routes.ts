import { Router } from "express";
import { asyncHandler, auditAction, requirePermission, validate } from "@resto/http";
import { createReservationSchema, updateReservationStatusSchema } from "@resto/contracts";
import { reservationController } from "../controllers/reservation.controller.js";

/**
 * CAPA 1 — ROUTES: reservaciones. Cada ruta exige un permiso; además el service
 * decide cuáles puede ver cada quien (propias vs todas).
 * /availability va ANTES de /:id para que "availability" no se tome como un id.
 */
export const reservationRouter = Router();

reservationRouter.get(
  "/availability",
  requirePermission("reservations:create"),
  asyncHandler(reservationController.availability)
);

reservationRouter.get(
  "/",
  requirePermission("reservations:read-own", "reservations:read-all"),
  asyncHandler(reservationController.list)
);

reservationRouter.get(
  "/:id",
  requirePermission("reservations:read-own", "reservations:read-all"),
  asyncHandler(reservationController.get)
);

reservationRouter.post(
  "/",
  auditAction("reservation-service", "reservations.create", "reservation"),
  requirePermission("reservations:create"),
  validate(createReservationSchema),
  asyncHandler(reservationController.create)
);

// El permiso exacto depende de la transición (cancelar, registrar llegada,
// no se presentó…) y se verifica en el service; aquí se exige al menos uno.
reservationRouter.patch(
  "/:id/status",
  auditAction("reservation-service", "reservations.status", "reservation"),
  requirePermission("reservations:create", "reservations:manage"),
  validate(updateReservationStatusSchema),
  asyncHandler(reservationController.changeStatus)
);
