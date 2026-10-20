import type { NextFunction, Request, Response } from "express";
import { AppError } from "@resto/core";
import { logger } from "@resto/http";
import { config } from "../config.js";
import { verifySignature } from "../domain/payment.js";

/**
 * Autentica al EMISOR del webhook: solo quien conoce PAYMENT_WEBHOOK_SECRET puede firmar
 * el cuerpo. La firma se calcula sobre los bytes originales (req.rawBody), no sobre el JSON
 * ya interpretado. Debe ir antes de validar el cuerpo.
 */
export function webhookSignature() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!verifySignature(config.PAYMENT_WEBHOOK_SECRET, req.rawBody, req.header("x-signature"))) {
      logger.warn({ requestId: req.requestId, ip: req.ip }, "Webhook de pago con firma inválida");
      return next(AppError.unauthorized("Firma del webhook inválida"));
    }
    next();
  };
}
