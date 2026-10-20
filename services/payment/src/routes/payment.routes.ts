import { Router } from "express";
import { asyncHandler, auditAction, requirePermission, validate } from "@resto/http";
import { createPaymentSchema, gatewayWebhookSchema } from "@resto/contracts";
import { paymentController } from "../controllers/payment.controller.js";
import { webhookSignature } from "../middlewares/webhookSignature.js";

/**
 * CAPA 1 — ROUTES: pagos en línea. /webhook, /mine van ANTES de /:id.
 * El webhook es público (la pasarela no tiene JWT): se protege con la firma HMAC.
 */
export const paymentRouter = Router();

paymentRouter.post("/webhook", webhookSignature(), validate(gatewayWebhookSchema), asyncHandler(paymentController.webhook));

// ---- cliente ----

paymentRouter.post(
  "/",
  auditAction("payment-service", "payments.create", "payment"),
  requirePermission("payments:create"),
  validate(createPaymentSchema),
  asyncHandler(paymentController.create)
);

paymentRouter.get("/mine", requirePermission("payments:read-own"), asyncHandler(paymentController.listMine));

// ---- personal (caja y gerencia) ----

paymentRouter.get(
  "/",
  auditAction("payment-service", "payments.list", "payment"),
  requirePermission("payments:read-all"),
  asyncHandler(paymentController.listAll)
);

paymentRouter.get("/:id", requirePermission("payments:read-own", "payments:read-all"), asyncHandler(paymentController.get));
