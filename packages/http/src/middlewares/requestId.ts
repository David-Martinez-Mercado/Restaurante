import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

/**
 * Genera (o propaga) un X-Request-Id por petición.
 * Se reenvía a otros servicios y a los eventos de RabbitMQ para
 * poder rastrear una orden completa a través de todo el sistema.
 */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header("x-request-id");
    req.requestId = incoming && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  };
}
