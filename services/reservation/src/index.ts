import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { reservationService } from "./services/reservation.service.js";
import { logger, startService } from "@resto/http";

startService({
  name: "Reservation Service",
  app,
  port: config.PORT,
  readyCheck: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  onShutdown: async () => {
    clearInterval(reminderTimer);
    await prisma.$disconnect();
  },
});

/**
 * Cada minuto busca las reservaciones que ya están por llegar y avisa al cliente
 * ("ya casi es la hora"). El aviso se reclama de forma atómica, así que nunca
 * se envía dos veces aunque un escaneo se retrase o se traslape con otro.
 */
const reminderTimer = setInterval(() => {
  reservationService
    .runReminders()
    .then((sent) => sent > 0 && logger.info(`Recordatorios de reservación enviados: ${sent}`))
    .catch((err: unknown) => logger.warn({ err }, "Falló el escaneo de recordatorios"));
}, 60_000);
reminderTimer.unref();
