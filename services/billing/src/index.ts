import { app } from "./app.js";
import { config, emisor } from "./config.js";
import { prisma } from "./db.js";
import { logger, startService } from "@resto/http";

startService({
  name: "Billing Service",
  app,
  port: config.PORT,
  readyCheck: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  onShutdown: () => prisma.$disconnect(),
});

if (!config.PROFACT_TOKEN) {
  logger.warn("PROFACT_TOKEN vacío: la facturación no está configurada (facturar responderá 503).");
} else {
  const prod = !config.PROFACT_URL.includes("pruebas.");
  logger.info(`Facturación con Profact en ambiente de ${prod ? "PRODUCCIÓN" : "PRUEBAS"} · emisor ${emisor.rfc}`);
}
