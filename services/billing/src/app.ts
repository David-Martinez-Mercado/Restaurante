import { createApp } from "@resto/http";
import { config } from "./config.js";
import { internalRouter } from "./routes/internal.routes.js";
import { invoiceRouter } from "./routes/invoice.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [
    { path: "/api/v1/invoices", router: invoiceRouter },
    // Solo para el bot de Telegram (llave interna). El gateway no lo publica.
    { path: "/api/v1/internal", router: internalRouter },
  ],
});
