import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import type { NextFunction, Response } from "express";
import { AppModule } from "./app.module";
import type { GatewayRequest } from "./auth/jwt-auth.guard";
import { loadConfig } from "./config";

async function bootstrap() {
  const config = loadConfig();
  // rawBody: conserva los bytes originales del JSON (req.rawBody) para reenviarlos sin tocar:
  // la firma del webhook de la pasarela de pago se calcula sobre ellos.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use(helmet());
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });

  // X-Request-Id: se propaga a los servicios para rastrear una petición completa.
  app.use((req: GatewayRequest, res: Response, next: NextFunction) => {
    const incoming = req.header("x-request-id");
    req.requestId = incoming && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });

  app.enableShutdownHooks();
  await app.listen(config.PORT);
  new Logger("Gateway").log(`🚀 API Gateway escuchando en el puerto ${config.PORT}`);
}

void bootstrap();
