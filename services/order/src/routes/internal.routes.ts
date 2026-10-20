import { Router } from "express";
import { asyncHandler, internalKey, validate } from "@resto/http";
import { paymentConfirmedSchema } from "@resto/contracts";
import { orderController } from "../controllers/order.controller.js";

/**
 * Rutas de uso exclusivo del Payment Service (llave interna, sin JWT de usuario).
 * El gateway no las publica: un cliente jamás debe poder marcar su pedido como pagado.
 */
export const internalRouter = Router();

internalRouter.use(internalKey());

internalRouter.get("/orders/:id", asyncHandler(orderController.getInternal));

internalRouter.post(
  "/orders/:id/payment-confirmed",
  validate(paymentConfirmedSchema),
  asyncHandler(orderController.confirmPayment)
);
