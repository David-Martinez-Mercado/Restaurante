import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Logger JSON a stdout (para agregadores como CloudWatch/Datadog).
 * En desarrollo usa pino-pretty para legibilidad.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
    : undefined,
});
