import type { Express } from "express";
import { logger } from "./logger.js";

export interface StartServiceOptions {
  name: string;
  app: Express;
  port: number;
  /** Comprobación de dependencias para /readyz (p. ej. SELECT 1 a la BD). */
  readyCheck?: () => Promise<void>;
  /** Se ejecuta al cerrar (p. ej. prisma.$disconnect). */
  onShutdown?: () => Promise<void>;
}

/** Levanta el servidor HTTP con /readyz y cierre ordenado por SIGINT/SIGTERM. */
export function startService(options: StartServiceOptions) {
  const { name, app, port, readyCheck, onShutdown } = options;
  app.locals.readyCheck = readyCheck;

  const server = app.listen(port, () => {
    logger.info(`🚀 ${name} escuchando en el puerto ${port}`);
  });

  async function shutdown(signal: string) {
    logger.info(`Señal ${signal} recibida, cerrando ${name}...`);
    server.close(async () => {
      await onShutdown?.();
      logger.info(`${name} cerrado correctamente`);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return server;
}
