import { z } from "zod";

// Node >= 20.12 carga .env sin dependencias extra. Si no existe, se
// usan las variables ya presentes en el entorno (p. ej. en Docker).
try {
  process.loadEnvFile();
} catch {
  /* sin .env */
}

const url = (fallback: string) => z.string().url().default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET debe tener al menos 16 caracteres"),
  INTERNAL_API_KEY: z.string().min(16, "INTERNAL_API_KEY debe tener al menos 16 caracteres"),
  USER_SERVICE_URL: url("http://localhost:3001"),
  MENU_SERVICE_URL: url("http://localhost:3002"),
  ORDER_SERVICE_URL: url("http://localhost:3003"),
  AUDIT_SERVICE_URL: url("http://localhost:3004"),
  NOTIFICATION_SERVICE_URL: url("http://localhost:3005"),
  PAYMENT_SERVICE_URL: url("http://localhost:3006"),
  RESERVATION_SERVICE_URL: url("http://localhost:3007"),
  CUSTOMER_SERVICE_URL: url("http://localhost:3008"),
  ATTENDANCE_SERVICE_URL: url("http://localhost:3009"),
  PAYROLL_SERVICE_URL: url("http://localhost:3010"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) => val.split(",").map((s) => s.trim())),
});

export type GatewayConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `   - ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(`Configuración de entorno inválida en Gateway:\n${lines.join("\n")}`);
  }
  return result.data;
}
