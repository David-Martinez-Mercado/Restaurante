import { createApp } from "@resto/http";
import { config } from "./config.js";
import { attendanceRouter } from "./routes/attendance.routes.js";
import { internalRouter } from "./routes/internal.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [
    { path: "/api/v1/attendance", router: attendanceRouter },
    // Solo para otros servicios (llave interna). El gateway no lo publica.
    { path: "/api/v1/internal", router: internalRouter },
  ],
});
