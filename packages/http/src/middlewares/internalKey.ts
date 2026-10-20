import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "@resto/core";

/**
 * Protege endpoints de uso exclusivo entre servicios (/internal/...):
 * solo quien conoce la llave compartida (INTERNAL_API_KEY) puede llamarlos.
 * El gateway no publica estas rutas ni reenvía este encabezado, así que
 * un usuario final nunca puede alcanzarlas.
 */
export function internalKey() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const expected = Buffer.from(process.env.INTERNAL_API_KEY ?? "");
    const received = Buffer.from(req.header("x-internal-key") ?? "");
    const valid =
      expected.length > 0 &&
      received.length === expected.length &&
      timingSafeEqual(received, expected);
    if (!valid) return next(AppError.unauthorized("Llave interna inválida"));
    next();
  };
}
