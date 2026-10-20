import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "@resto/core";
import { config } from "../config.js";

/**
 * Protege el endpoint de ingesta: solo servicios internos (que conocen la
 * llave compartida) pueden registrar eventos. Un usuario final nunca debe
 * poder escribir en su propia bitácora.
 */
export function internalKey() {
  const expected = Buffer.from(config.INTERNAL_API_KEY);
  return (req: Request, _res: Response, next: NextFunction) => {
    const received = Buffer.from(req.header("x-internal-key") ?? "");
    const valid =
      received.length === expected.length && timingSafeEqual(received, expected);
    if (!valid) return next(AppError.unauthorized("Llave interna inválida"));
    next();
  };
}
