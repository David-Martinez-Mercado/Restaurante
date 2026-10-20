import cors from "cors";
import express, { type Express, type Router } from "express";
import helmet from "helmet";
// pino-http es CJS sin "exports" map; bajo NodeNext el default import
// resuelve al namespace, no a la función invocable. Se usa createRequire
// para obtener el export real en tiempo de ejecución.
import { createRequire } from "node:module";
import type { HttpLogger, Options } from "pino-http";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";

const require = createRequire(import.meta.url);
const pinoHttp = require("pino-http") as (
  opts?: Options
) => HttpLogger;
import { requestId } from "./middlewares/requestId.js";
import { logger } from "./logger.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export interface CreateAppOptions {
  /** Orígenes permitidos por CORS. Lista blanca explícita, nunca "*". */
  corsOrigins: string[];
  /** Routers de negocio a montar, ya prefijados (p.ej. /api/v1/auth). */
  routers: { path: string; router: Router }[];
}

/**
 * Ensambla una app Express con los middlewares transversales comunes
 * a los 14 servicios: seguridad (helmet), CORS restrictivo, requestId,
 * logging estructurado, healthz/readyz y manejo de errores uniforme.
 */
export function createApp(options: CreateAppOptions): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: options.corsOrigins,
      credentials: true,
    })
  );
  app.use(
    express.json({
      limit: "1mb",
      // Se conserva el cuerpo exacto: las firmas de webhooks (HMAC) se calculan
      // sobre los bytes originales, no sobre el JSON ya interpretado.
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    })
  );
  app.use(requestId());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    })
  );

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Debe registrarse antes del notFoundHandler. El servicio asigna
  // app.locals.readyCheck al arrancar (ver startService).
  app.get("/readyz", async (_req, res) => {
    try {
      const check = app.locals.readyCheck as (() => Promise<void>) | undefined;
      await check?.();
      res.status(200).json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "not-ready" });
    }
  });

  for (const { path, router } of options.routers) {
    app.use(path, router);
  }

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}
