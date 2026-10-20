import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger, startService } from "@resto/http";

startService({
  name: "Payment Service",
  app,
  port: config.PORT,
  readyCheck: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  onShutdown: () => prisma.$disconnect(),
});

if (!config.PAYMENT_GATEWAY_URL) {
  logger.warn("PAYMENT_GATEWAY_URL vacío: pasarela NO conectada. Los cobros se crean pero no se contacta a nadie.");
}
