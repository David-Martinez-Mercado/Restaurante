import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { logger, startService } from "@resto/http";
import { nominaClient } from "./clients/nomina.client.js";
import { payrollRepository } from "./repositories/payroll.repository.js";

startService({
  name: "Payroll Service",
  app,
  port: config.PORT,
  readyCheck: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  onShutdown: () => prisma.$disconnect(),
});

// Cada llamada al motor externo queda en la bitácora (sin bloquear ni romper el cálculo si falla el guardado).
nominaClient.observe((tx) => {
  payrollRepository
    .saveTransaction({
      at: tx.at,
      target: tx.target,
      method: tx.method,
      path: tx.path,
      summary: tx.summary,
      status: tx.status,
      ok: tx.ok,
      durationMs: tx.durationMs,
      requestBody: (tx.requestBody ?? undefined) as never,
      responseBody: (tx.responseBody ?? undefined) as never,
      error: tx.error,
    })
    .catch((err: unknown) => logger.warn({ err }, "No se pudo guardar la transacción con el motor de nómina"));
});

void nominaClient.ping().then((up) => {
  if (!up) logger.warn("El motor de nómina externo (SistemaNomina) no responde: levántalo con integraciones/nomina-externo.cjs (iniciar.bat lo hace solo).");
});
