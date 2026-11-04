import { Router } from "express";
import { z } from "zod";
import { asyncHandler, internalKey, validate } from "@resto/http";
import { invoiceController } from "../controllers/invoice.controller.js";

const telegramInvoiceSchema = z.object({
  chatId: z.string().min(1).max(30),
  orderId: z.string().uuid(),
});

/**
 * Rutas de uso exclusivo del bot de Telegram (llave interna, sin JWT de usuario).
 * El gateway no las publica.
 */
export const internalRouter = Router();

internalRouter.use(internalKey());

internalRouter.post("/invoices/telegram", validate(telegramInvoiceSchema), asyncHandler(invoiceController.issueFromTelegram));
