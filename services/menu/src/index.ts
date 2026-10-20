import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { startService } from "@resto/http";

startService({
  name: "Menu Service",
  app,
  port: config.PORT,
  readyCheck: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  onShutdown: () => prisma.$disconnect(),
});
