import { createApp } from "@resto/http";
import { config } from "./config.js";
import { payrollRouter } from "./routes/payroll.routes.js";

export const app = createApp({
  corsOrigins: config.CORS_ORIGINS,
  routers: [{ path: "/api/v1/payroll", router: payrollRouter }],
});
