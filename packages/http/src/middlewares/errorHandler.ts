import type { NextFunction, Request, Response } from "express";
import { AppError } from "@resto/core";
import { logger } from "../logger.js";

/**
 * Único lugar que construye respuestas de error en todo el sistema.
 * Formato uniforme en los 14 servicios:
 * { success: false, error: { code, message, details? }, requestId }
 */
export function errorHandler() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        logger.error({ err, requestId: req.requestId }, err.message);
      } else {
        logger.warn(
          { code: err.code, requestId: req.requestId },
          err.message
        );
      }

      return res.status(err.statusCode).json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
        requestId: req.requestId,
      });
    }

    // Error no controlado: nunca exponer detalles internos al cliente.
    logger.error({ err, requestId: req.requestId }, "Error no controlado");
    return res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Error interno del servidor",
      },
      requestId: req.requestId,
    });
  };
}

export function notFoundHandler() {
  return (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
      },
      requestId: req.requestId,
    });
  };
}
