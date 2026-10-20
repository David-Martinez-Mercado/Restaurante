import { Router } from "express";
import { asyncHandler, internalKey, validate } from "@resto/http";
import { tableStatusSchema } from "@resto/contracts";
import { tableController } from "../controllers/table.controller.js";

/**
 * Rutas de uso exclusivo de otros servicios (llave interna, sin JWT de usuario).
 * Sirven para cambios hechos por el sistema, p. ej. liberar una mesa cuando la
 * pasarela confirma el pago en línea. El gateway no las publica.
 */
export const internalRouter = Router();

internalRouter.use(internalKey());

internalRouter.patch(
  "/tables/:id/status",
  validate(tableStatusSchema),
  asyncHandler(tableController.setStatus)
);
