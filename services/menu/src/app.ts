import { createApp } from "@resto/http";
import { config } from "./config.js";
import { dishRouter } from "./routes/dish.routes.js";
import { internalRouter } from "./routes/internal.routes.js";
import { tableRouter } from "./routes/table.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [
    { path: "/api/v1/dishes", router: dishRouter },
    { path: "/api/v1/tables", router: tableRouter },
    // Solo para otros servicios (llave interna). El gateway no lo publica.
    { path: "/api/v1/internal", router: internalRouter },
  ],
});
