import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use el formato HH:MM");
const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3007),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es requerida"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET debe tener al menos 16 caracteres"),
  INTERNAL_API_KEY: z.string().min(16, "INTERNAL_API_KEY debe tener al menos 16 caracteres"),
  MENU_SERVICE_URL: z.string().url().default("http://localhost:3002"),
  CUSTOMER_SERVICE_URL: z.string().url().default("http://localhost:3008"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) => val.split(",").map((s) => s.trim())),

  RESERVATION_OPEN: hhmm.default("13:00"),
  RESERVATION_LAST_ARRIVAL: hhmm.default("22:00"),
  RESERVATION_SLOT_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  RESERVATION_STAY_MINUTES: z.coerce.number().int().min(30).max(480).default(120),
  RESERVATION_CAPACITY: z.coerce.number().int().min(1).max(1000).default(40),
  RESERVATION_REMINDER_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
});

/** Falla rápido al arrancar si falta alguna variable crítica. */
function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Configuración de entorno inválida en Reservation Service:");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const c = result.data;
  if (toMinutes(c.RESERVATION_LAST_ARRIVAL) < toMinutes(c.RESERVATION_OPEN)) {
    console.error("❌ RESERVATION_LAST_ARRIVAL no puede ser anterior a RESERVATION_OPEN");
    process.exit(1);
  }
  return c;
}

export const config = loadConfig();

/** Reglas de agenda en el formato que usan las funciones puras del dominio. */
export const scheduleParams = {
  openMinutes: toMinutes(config.RESERVATION_OPEN),
  lastMinutes: toMinutes(config.RESERVATION_LAST_ARRIVAL),
  slotMinutes: config.RESERVATION_SLOT_MINUTES,
  stayMinutes: config.RESERVATION_STAY_MINUTES,
  capacity: config.RESERVATION_CAPACITY,
  reminderMinutes: config.RESERVATION_REMINDER_MINUTES,
};
