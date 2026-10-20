import { createApp } from "@resto/http";
import { config } from "./config.js";
import { auditRouter } from "./routes/audit.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [{ path: "/api/v1/audit", router: auditRouter }],
});
