import { createApp } from "@resto/http";
import { config } from "./config.js";
import { customerRouter } from "./routes/customer.routes.js";
import { internalRouter } from "./routes/internal.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [
    { path: "/api/v1/customers", router: customerRouter },
    // Solo para otros servicios (llave interna). El gateway no lo publica.
    { path: "/api/v1/internal", router: internalRouter },
  ],
});
