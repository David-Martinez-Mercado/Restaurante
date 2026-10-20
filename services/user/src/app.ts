import { createApp } from "@resto/http";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [{ path: "/api/v1/auth", router: authRouter }],
});
