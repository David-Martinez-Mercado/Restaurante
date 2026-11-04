// Registra el CSD (certificado de sello digital) del restaurante en Profact, UNA sola vez.
// Profact autosella los CFDI con ese CSD; por eso el sistema nunca guarda la llave privada.
// El .cer, el .key y la contraseña solo se leen aquí, se mandan a Profact y se descartan.
//
// Uso: npm run profact:registra-emisor -- <archivo.cer> <archivo.key> <contraseña> [RFC]
//   (el RFC por omisión es BILLING_EMISOR_RFC de services/billing/.env)
// Las mismas cosas pueden venir por variables de entorno: CSD_CER, CSD_KEY, CSD_PASSWORD.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "services", "billing", ".env");

function envValue(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envFile)) return "";
  const text = readFileSync(envFile, "utf8").replace(/^﻿/, "");
  return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim() ?? "";
}

const [cerPath = process.env.CSD_CER, keyPath = process.env.CSD_KEY, password = process.env.CSD_PASSWORD, rfcArg] =
  process.argv.slice(2);

if (!cerPath || !keyPath || !password) {
  console.error("Uso: npm run profact:registra-emisor -- <archivo.cer> <archivo.key> <contraseña> [RFC]");
  process.exit(1);
}
for (const file of [cerPath, keyPath]) {
  if (!existsSync(file)) {
    console.error(`No existe el archivo: ${file}`);
    process.exit(1);
  }
}

const url = (envValue("PROFACT_URL") || "https://pruebas.timbracfdi33.mx:1444/api/v2").replace(/\/$/, "");
const token = envValue("PROFACT_TOKEN");
const rfc = (rfcArg || envValue("BILLING_EMISOR_RFC") || "").toUpperCase();
if (!token) {
  console.error("Falta PROFACT_TOKEN en services/billing/.env");
  process.exit(1);
}
if (!rfc) {
  console.error("Falta el RFC del emisor (BILLING_EMISOR_RFC o cuarto argumento).");
  process.exit(1);
}

console.log(`Registrando el CSD de ${rfc} en ${url} …`);
const res = await fetch(`${url}/Timbrado/RegistraEmisor`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({
    RfcEmisor: rfc,
    Base64Cer: readFileSync(cerPath).toString("base64"),
    Base64Key: readFileSync(keyPath).toString("base64"),
    Contrasena: password,
  }),
  signal: AbortSignal.timeout(30_000),
}).catch((err) => {
  console.error(`No se pudo contactar a Profact: ${err.message}`);
  process.exit(1);
});

const body = await res.json().catch(() => ({}));
if (res.ok && body.Codigo === 0) {
  console.log(`✔ Emisor ${rfc} registrado. Ya puedes timbrar con su RFC.`);
} else {
  console.error(`✖ Profact respondió ${res.status}: ${body.Mensaje ?? body.MensajeSat ?? "sin detalle"}`);
  process.exit(1);
}
