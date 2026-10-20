import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3005),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es requerida"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET debe tener al menos 16 caracteres"),
  INTERNAL_API_KEY: z.string().min(16, "INTERNAL_API_KEY debe tener al menos 16 caracteres"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) => val.split(",").map((s) => s.trim())),
  CUSTOMER_SERVICE_URL: z.string().url().default("http://localhost:3008"),
  RESERVATION_SERVICE_URL: z.string().url().default("http://localhost:3007"),
  /** Vacío = modo simulado (no se contacta a Telegram). */
  TELEGRAM_BOT_TOKEN: z
    .string()
    .default("")
    .transform((v) => v.trim()),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .default("")
    .transform((v) => v.trim().replace(/^@/, "")),
  /** Vacío = la zona horaria del servidor (la misma con la que el Reservation Service arma los horarios). */
  TIMEZONE: z
    .string()
    .default("")
    .transform((v) => v.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone),
});

/** Falla rápido al arrancar si falta alguna variable crítica. */
function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Configuración de entorno inválida en Notification Service:");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
