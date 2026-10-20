import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { authService } from "./services/auth.service.js";
import { logger, startService } from "@resto/http";

/** Garantiza que exista al menos un admin para poder dar de alta al resto del personal. */
async function ensureBootstrapAdmin(): Promise<void> {
  if (!config.BOOTSTRAP_ADMIN_PASSWORD) return;
  try {
    const created = await authService.ensureBootstrapAdmin({
      username: config.BOOTSTRAP_ADMIN_USERNAME,
      email: config.BOOTSTRAP_ADMIN_EMAIL,
      password: config.BOOTSTRAP_ADMIN_PASSWORD,
    });
    if (created) {
      logger.info(`Administrador inicial creado: "${config.BOOTSTRAP_ADMIN_USERNAME}"`);
    }
  } catch (err) {
    logger.warn({ err }, "No se pudo crear el administrador inicial (¿tablas sin crear?)");
  }
}

await ensureBootstrapAdmin();

startService({
  name: "User Service",
  app,
  port: config.PORT,
  readyCheck: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  onShutdown: () => prisma.$disconnect(),
});
