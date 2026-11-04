import { z } from "zod";

const url = (fallback: string) => z.string().url().default(fallback).transform((v) => v.replace(/\/$/, ""));
const nonEmpty = (fallback: string) => z.string().default(fallback).transform((v) => v.trim()).refine((v) => v.length > 0, "No puede quedar vacío");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3011),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es requerida"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET debe tener al menos 16 caracteres"),
  INTERNAL_API_KEY: z.string().min(16, "INTERNAL_API_KEY debe tener al menos 16 caracteres"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) => val.split(",").map((s) => s.trim())),
  ORDER_SERVICE_URL: url("http://localhost:3003"),
  CUSTOMER_SERVICE_URL: url("http://localhost:3008"),

  /** Ambiente de PRUEBAS de Profact por defecto; producción es https://timbracfdi33.mx:1444/api/v2 */
  PROFACT_URL: url("https://pruebas.timbracfdi33.mx:1444/api/v2"),
  /** Token de integrador. Vacío = el PAC no está configurado y facturar responde 503. */
  PROFACT_TOKEN: z.string().default("").transform((v) => v.trim()),

  BILLING_EMISOR_RFC: nonEmpty("EKU9003173C9").transform((v) => v.toUpperCase()),
  BILLING_EMISOR_NAME: nonEmpty("ESCUELA KEMPER URGATE"),
  BILLING_EMISOR_REGIME: z.string().regex(/^\d{3}$/, "Clave de régimen de 3 dígitos (p. ej. 601)").default("601"),
  BILLING_EMISOR_POSTAL_CODE: z.string().regex(/^\d{5}$/, "Código postal de 5 dígitos").default("42501"),
  BILLING_SERIE: z.string().regex(/^[A-Z0-9]{1,25}$/, "Serie en mayúsculas, hasta 25 caracteres").default("A"),
  BILLING_TIMEZONE: z.string().default("America/Mexico_City"),
});

/** Falla rápido al arrancar si falta alguna variable crítica. */
function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Configuración de entorno inválida en Billing Service:");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();

export const emisor = {
  rfc: config.BILLING_EMISOR_RFC,
  name: config.BILLING_EMISOR_NAME,
  taxRegime: config.BILLING_EMISOR_REGIME,
  postalCode: config.BILLING_EMISOR_POSTAL_CODE,
};
