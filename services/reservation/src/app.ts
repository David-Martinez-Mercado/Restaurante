import { createApp } from "@resto/http";
import { config } from "./config.js";
import { internalRouter } from "./routes/internal.routes.js";
import { reservationRouter } from "./routes/reservation.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [
    { path: "/api/v1/reservations", router: reservationRouter },
    // Solo para el bot de Telegram y operación (llave interna). El gateway no lo publica.
    { path: "/api/v1/internal", router: internalRouter },
  ],
});
