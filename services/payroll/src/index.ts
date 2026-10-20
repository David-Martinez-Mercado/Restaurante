import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger, startService } from "@resto/http";
import { nominaClient } from "./clients/nomina.client.js";

startService({
  name: "Payroll Service",
  app,
  port: config.PORT,
  readyCheck: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  onShutdown: () => prisma.$disconnect(),
});

void nominaClient.ping().then((up) => {
  if (!up) logger.warn("El motor de nómina externo (SistemaNomina) no responde: levántalo con integraciones/nomina-externo.cjs (iniciar.bat lo hace solo).");
});
