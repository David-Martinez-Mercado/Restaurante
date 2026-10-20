import { Router } from "express";
import { z } from "zod";
import { asyncHandler, internalKey, validate } from "@resto/http";
import { telegramReservationSchema } from "@resto/contracts";
import { reservationController } from "../controllers/reservation.controller.js";

const cancelFromTelegramSchema = z.object({
  chatId: z.string().min(1).max(30),
  code: z.string().trim().min(4).max(10),
});

/**
 * Rutas de uso exclusivo del bot de Telegram y de operación (llave interna, sin
 * JWT de usuario). El gateway no las publica.
 */
export const internalRouter = Router();

internalRouter.use(internalKey());

internalRouter.get("/availability", asyncHandler(reservationController.availabilityInternal));

internalRouter.post(
  "/reservations/telegram",
  validate(telegramReservationSchema),
  asyncHandler(reservationController.createFromTelegram)
);

internalRouter.post(
  "/reservations/telegram/cancel",
  validate(cancelFromTelegramSchema),
  asyncHandler(reservationController.cancelFromTelegram)
);

internalRouter.get("/reservations/by-chat/:chatId", asyncHandler(reservationController.upcomingForChat));

internalRouter.post("/reminders/run", asyncHandler(reservationController.runReminders));
