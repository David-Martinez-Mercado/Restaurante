import { createApp } from "@resto/http";
import { config } from "./config.js";
import { paymentRouter } from "./routes/payment.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [{ path: "/api/v1/payments", router: paymentRouter }],
});
