// Arranca todo el sistema (10 procesos) UNO POR UNO, esperando a que cada servicio responda
// antes de lanzar el siguiente. Evita el pico de memoria de arrancar todo a la vez, que en
// equipos con poca RAM tumbaba los procesos.
// Usa `node` directo (sin npm ni shell): menos procesos intermedios, menos memoria.
// Uso: npm start                 (todo)
//      npm start -- --no-web     (solo el backend)
//      npm start -- --no-nomina  (sin el motor de nómina externo SistemaNomina)
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const withWeb = !process.argv.includes("--no-web");
// El motor de nómina externo solo se levanta si ya se preparó (npm run setup:nomina).
const nominaReady = existsSync(join(root, "integraciones", "SistemaNomina", "payroll-service", "node_modules"));
const withNomina = !process.argv.includes("--no-nomina") && nominaReady;

function envValue(dir, key, fallback) {
  const file = join(root, dir, ".env");
  if (!existsSync(file)) return fallback;
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim() || fallback;
}

const tsxService = (name, dir, color, fallbackPort) => ({
  name,
  color,
  cwd: join(root, dir),
  args: ["--env-file=.env", "--import", "tsx", "src/index.ts"],
  port: Number(envValue(dir, "PORT", fallbackPort)),
  health: true,
});

// El orden importa: primero lo que otros consultan al arrancar o al atender.
const SERVICES = [
  tsxService("audit", "services/audit", 34, 3004),
  tsxService("user", "services/user", 32, 3001),
  tsxService("menu", "services/menu", 33, 3002),
  tsxService("customer", "services/customer", 96, 3008),
  tsxService("order", "services/order", 35, 3003),
  tsxService("reservation", "services/reservation", 95, 3007),
  tsxService("notification", "services/notification", 94, 3005),
  tsxService("payment", "services/payment", 93, 3006),
  tsxService("attendance", "services/attendance", 92, 3009),
  // Repo SistemaNomina (otro autor) sin modificar: sus 3 servicios en un solo proceso, solo en 127.0.0.1.
  ...(withNomina
    ? [
        {
          name: "nomina",
          color: 91,
          cwd: root,
          args: [join("integraciones", "nomina-externo.cjs")],
          port: 3102,
          health: true,
          healthUrl: "http://127.0.0.1:3102/employees",
          noEnvFile: true,
        },
      ]
    : []),
  tsxService("payroll", "services/payroll", 90, 3010),
  {
    name: "gateway",
    color: 36,
    cwd: join(root, "gateway"),
    args: ["dist/main.js"],
    port: Number(envValue("gateway", "PORT", 3000)),
    health: true,
    needsBuild: true,
  },
  ...(withWeb
    ? [
        {
          name: "web",
          color: 31,
          cwd: join(root, "web"),
          args: [join(root, "node_modules", "vite", "bin", "vite.js")],
          port: 5173,
          health: false,
        },
      ]
    : []),
];

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log("\nDeteniendo servicios…");
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const pipe = (stream, svc) => {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) console.log(`\x1b[${svc.color}m[${svc.name}]\x1b[0m ${line}`);
  });
};

async function waitUntilUp(svc, timeoutMs = 90_000) {
  const url = svc.healthUrl ?? `http://localhost:${svc.port}/healthz`;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (stopping) return false;
    if (svc.exited) return false;
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return true;
    } catch {
      /* todavía no escucha */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/** El gateway corre compilado: se recompila solo si el código es más nuevo que dist/. */
async function ensureGatewayBuilt(svc) {
  const dist = join(svc.cwd, "dist", "main.js");
  if (existsSync(dist) && statSync(dist).mtimeMs >= newestMtime(join(svc.cwd, "src"))) return true;
  console.log(`\x1b[${svc.color}m[gateway]\x1b[0m compilando…`);
  const nest = join(root, "node_modules", "@nestjs", "cli", "bin", "nest.js");
  const build = spawn(process.execPath, [nest, "build"], { cwd: svc.cwd, stdio: "inherit" });
  const code = await new Promise((resolve) => build.on("exit", resolve));
  return code === 0;
}

for (const svc of SERVICES) {
  if (stopping) break;
  if (!svc.noEnvFile && !existsSync(join(svc.cwd, ".env")) && svc.health) {
    console.error(`Falta ${join(svc.cwd, ".env")}. Ejecuta primero: npm run setup`);
    stopAll(1);
    break;
  }
  if (svc.needsBuild && !(await ensureGatewayBuilt(svc))) {
    console.error("No se pudo compilar el gateway.");
    stopAll(1);
    break;
  }

  const child = spawn(process.execPath, svc.args, { cwd: svc.cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  children.push(child);
  pipe(child.stdout, svc);
  pipe(child.stderr, svc);
  child.on("exit", (code) => {
    svc.exited = true;
    if (!stopping) {
      console.error(`\x1b[${svc.color}m[${svc.name}]\x1b[0m terminó con código ${code}. Se detiene todo.`);
      stopAll(1);
    }
  });

  if (svc.health) {
    const up = await waitUntilUp(svc);
    if (!up && !stopping) {
      console.error(`${svc.name} no respondió a tiempo en el puerto ${svc.port}.`);
      stopAll(1);
      break;
    }
  } else {
    await new Promise((r) => setTimeout(r, 1500));
  }
}

if (!stopping && !withNomina && !process.argv.includes("--no-nomina")) {
  console.log("\n(!) Motor de nómina externo sin preparar: la Nómina no podrá calcular. Ejecuta: npm run setup:nomina y vuelve a iniciar.");
}

if (!stopping) {
  console.log(`
\x1b[32m✔ Todo arriba.\x1b[0m
  Gateway:  http://localhost:${SERVICES.find((s) => s.name === "gateway").port}
  ${withWeb ? "Front:    http://localhost:5173\n  " : ""}Datos de demostración: npm run seed (en otra terminal)
  Detener:  Ctrl+C
`);
}
