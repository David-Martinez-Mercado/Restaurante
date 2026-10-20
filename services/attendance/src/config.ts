import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3009),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es requerida"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET debe tener al menos 16 caracteres"),
  INTERNAL_API_KEY: z.string().min(16, "INTERNAL_API_KEY debe tener al menos 16 caracteres"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) => val.split(",").map((s) => s.trim())),
  ATTENDANCE_WORKDAYS: z
    .string()
    .default("1,2,3,4,5,6")
    .transform((v) => v.split(",").map((s) => Number(s.trim())))
    .refine((d) => d.length > 0 && d.every((n) => Number.isInteger(n) && n >= 0 && n <= 6), "Usa números 0 (domingo) a 6 (sábado) separados por coma"),
  ATTENDANCE_DAILY_HOURS: z.coerce.number().positive().max(24).default(8),
  ATTENDANCE_STALE_HOURS: z.coerce.number().positive().max(72).default(16),
  ATTENDANCE_MIN_SHIFT_MINUTES: z.coerce.number().int().min(0).max(60).default(1),
});

/** Falla rápido al arrancar si falta alguna variable crítica. */
function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Configuración de entorno inválida en Attendance Service:");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();

export interface AttendanceRules {
  workdays: number[];
  dailyHours: number;
  staleShiftHours: number;
  minShiftMinutes: number;
}

/** Reglas del checador tal como están en el entorno. */
export const defaultRules: AttendanceRules = {
  workdays: config.ATTENDANCE_WORKDAYS,
  dailyHours: config.ATTENDANCE_DAILY_HOURS,
  staleShiftHours: config.ATTENDANCE_STALE_HOURS,
  minShiftMinutes: config.ATTENDANCE_MIN_SHIFT_MINUTES,
};
