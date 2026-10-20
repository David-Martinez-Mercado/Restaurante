import { z } from "zod";

const url = (fallback: string) => z.string().url().default(fallback).transform((v) => v.replace(/\/$/, ""));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es requerida"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET debe tener al menos 16 caracteres"),
  INTERNAL_API_KEY: z.string().min(16, "INTERNAL_API_KEY debe tener al menos 16 caracteres"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) => val.split(",").map((s) => s.trim())),
  ATTENDANCE_SERVICE_URL: url("http://localhost:3009"),
  NOMINA_EMPLOYEES_URL: url("http://127.0.0.1:3102"),
  NOMINA_PAYROLL_URL: url("http://127.0.0.1:3103"),
  NOMINA_INCIDENTS_URL: url("http://127.0.0.1:3104"),
  PAYROLL_OVERTIME_MULTIPLIER: z.coerce.number().min(1).max(3).default(2),
  PAYROLL_DAILY_HOURS: z.coerce.number().positive().max(24).default(8),
});

/** Falla rápido al arrancar si falta alguna variable crítica. */
function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Configuración de entorno inválida en Payroll Service:");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
