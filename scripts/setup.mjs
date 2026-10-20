// Prepara los archivos .env de todos los servicios a partir de sus .env.example.
// - Crea los .env que falten.
// - En los que ya existen NO toca lo que ya tienen, pero agrega las variables nuevas
//   que falten (así una versión anterior sigue funcionando al actualizar).
// - Genera secretos aleatorios y los comparte entre servicios (deben coincidir).
// - Respeta POSTGRES_PORT del .env de la raíz (por si el 5432 está ocupado).
// Uso: npm run setup
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "",
  "services/user",
  "services/menu",
  "services/order",
  "services/audit",
  "services/customer",
  "services/reservation",
  "services/notification",
  "services/payment",
  "services/attendance",
  "services/payroll",
  "gateway",
];

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) {
  console.error(`Se requiere Node.js 22 o superior (tienes ${process.versions.node}).`);
  process.exit(1);
}

const PLACEHOLDERS = {
  JWT_ACCESS_SECRET: "cambia-este-secreto-de-acceso-en-produccion-min-16",
  JWT_REFRESH_SECRET: "cambia-este-secreto-de-refresh-en-produccion-min-16",
  INTERNAL_API_KEY: "cambia-esta-llave-interna-min-16",
  PAYMENT_WEBHOOK_SECRET: "cambia-este-secreto-del-webhook-min-16",
};

/** Lee un archivo .env como { CLAVE: valor }, tolerando BOM, CRLF y comentarios. */
function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// Si ya hay algún .env, se reutilizan sus secretos para que todos coincidan.
const secrets = {};
for (const dir of targets) {
  const file = join(root, dir, ".env");
  if (!existsSync(file)) continue;
  const values = parseEnv(file);
  for (const key of Object.keys(PLACEHOLDERS)) if (values[key] && !secrets[key]) secrets[key] = values[key];
}
for (const key of Object.keys(PLACEHOLDERS)) secrets[key] ??= randomBytes(24).toString("hex");

const rootEnv = existsSync(join(root, ".env")) ? parseEnv(join(root, ".env")) : {};
const pgPort = rootEnv.POSTGRES_PORT && rootEnv.POSTGRES_PORT !== "5432" ? rootEnv.POSTGRES_PORT : null;

/** Aplica secretos compartidos y el puerto de Postgres a un texto de .env. */
function fill(text) {
  for (const [key, placeholder] of Object.entries(PLACEHOLDERS)) text = text.split(placeholder).join(secrets[key]);
  if (pgPort) text = text.split("localhost:5432/").join(`localhost:${pgPort}/`);
  return text;
}

let created = 0;
let topped = 0;
for (const dir of targets) {
  const example = join(root, dir, ".env.example");
  const target = join(root, dir, ".env");
  if (!existsSync(example)) continue;

  if (!existsSync(target)) {
    copyFileSync(example, target);
    writeFileSync(target, fill(readFileSync(target, "utf8")));
    console.log(`  + ${join(dir, ".env")} creado`);
    created++;
    continue;
  }

  // Ya existe: solo se agregan las variables que le faltan.
  const have = parseEnv(target);
  const missing = [];
  for (const line of fill(readFileSync(example, "utf8")).replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in have)) missing.push(line);
  }
  if (missing.length === 0) {
    console.log(`  = ${join(dir, ".env")} al día`);
    continue;
  }
  const current = readFileSync(target, "utf8");
  appendFileSync(target, `${current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
  console.log(`  ~ ${join(dir, ".env")}: se agregaron ${missing.length} variable(s) nueva(s): ${missing.map((l) => l.split("=")[0]).join(", ")}`);
  topped++;
}

if (created + topped === 0) {
  console.log("\nNada que cambiar.");
} else {
  console.log("\nListo. Siguiente paso: npm run db:up && npm run prisma:generate && npm run db:push");
}
console.log(
  "Telegram (opcional): crea un bot con @BotFather y pon TELEGRAM_BOT_TOKEN y TELEGRAM_BOT_USERNAME en services/notification/.env.\n" +
    "Sin token el canal funciona en modo simulado."
);
