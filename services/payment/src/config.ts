import { z } from "zod";

const optionalUrl = z
  .string()
  .default("")
  .transform((v) => v.trim().replace(/\/$/, ""))
  .refine((v) => v === "" || /^https?:\/\//.test(v), "Debe ser una URL http(s) o estar vacía");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3006),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es requerida"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET debe tener al menos 16 caracteres"),
  INTERNAL_API_KEY: z.string().min(16, "INTERNAL_API_KEY debe tener al menos 16 caracteres"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) => val.split(",").map((s) => s.trim())),
  ORDER_SERVICE_URL: z.string().url().default("http://localhost:3003"),
  /** Vacío = pasarela sin conectar. */
  PAYMENT_GATEWAY_URL: optionalUrl,
  PAYMENT_GATEWAY_API_KEY: z.string().default(""),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, "PAYMENT_WEBHOOK_SECRET debe tener al menos 16 caracteres"),
  PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
  WEB_URL: z.string().url().default("http://localhost:5173"),
});

/** Falla rápido al arrancar si falta alguna variable crítica. */
function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Configuración de entorno inválida en Payment Service:");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
