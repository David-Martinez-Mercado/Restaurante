import { createApp } from "@resto/http";
import { config } from "./config.js";
import { internalRouter } from "./routes/internal.routes.js";
import { orderRouter } from "./routes/order.routes.js";
import { taxRouter } from "./routes/tax.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [
    { path: "/api/v1/orders", router: orderRouter },
    { path: "/api/v1/tax", router: taxRouter },
    // Solo para el Payment Service (llave interna). El gateway no lo publica.
    { path: "/api/v1/internal", router: internalRouter },
  ],
});
