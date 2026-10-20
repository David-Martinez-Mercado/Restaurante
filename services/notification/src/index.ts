import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { startTelegramPolling } from "./telegram/poller.js";
import { startService } from "@resto/http";

startService({
  name: "Notification Service",
  app,
  port: config.PORT,
  readyCheck: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  onShutdown: async () => {
    stopPolling();
    await prisma.$disconnect();
  },
});

const stopPolling = startTelegramPolling();
