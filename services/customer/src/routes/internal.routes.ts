import { Router } from "express";
import { asyncHandler, internalKey, validate } from "@resto/http";
import { telegramLinkSchema } from "@resto/contracts";
import { customerController } from "../controllers/customer.controller.js";

/**
 * Rutas de uso exclusivo de otros servicios (llave interna, sin JWT de usuario).
 * Devuelven datos fiscales y el chat de Telegram, por eso el gateway no las publica.
 */
export const internalRouter = Router();

internalRouter.use(internalKey());

internalRouter.get("/customers/by-user/:userId", asyncHandler(customerController.getByUserInternal));
internalRouter.get("/customers/by-chat/:chatId", asyncHandler(customerController.getByChatInternal));

internalRouter.post(
  "/telegram/link",
  validate(telegramLinkSchema),
  asyncHandler(customerController.linkTelegram)
);
