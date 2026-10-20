// Prepara el motor de nómina EXTERNO (repo SistemaNomina, de otro autor) para poder correrlo.
// NO modifica ningún archivo versionado de ese repo: solo instala sus dependencias y crea sus bases
// SQLite (node_modules y *.db están en su propio .gitignore, así que su repo queda "limpio").
//
// Uso: npm run setup:nomina      (iniciar.bat lo ejecuta solo)
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "integraciones", "SistemaNomina");
const REPO = "https://github.com/EmilianoNajeraCervantes/SistemaNomina.git";
// Solo estos 3 de sus 6 servicios: empleados, incidencias y el motor de nómina.
const SERVICES = ["employees-service", "incidents-service", "payroll-service"];

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

// 1. El repo viene como submódulo de git; si no está descargado, se descarga.
if (!existsSync(join(base, "payroll-service", "package.json"))) {
  console.log("Descargando el repo SistemaNomina…");
  try {
    run("git submodule update --init integraciones/SistemaNomina", root);
  } catch {
    // Sin .git (por ejemplo, el proyecto llegó en un zip): se clona directo.
    try {
      run(`git clone ${REPO} integraciones/SistemaNomina`, root);
    } catch {
      console.error(`\nNo se pudo descargar el repo. Clónalo a mano:\n  git clone ${REPO} integraciones/SistemaNomina`);
      process.exit(1);
    }
  }
}

// 2. Dependencias y bases de datos de cada servicio (sin lockfile, para no ensuciar su repo).
for (const name of SERVICES) {
  const dir = join(base, name);
  console.log(`\n== ${name}`);
  if (!existsSync(join(dir, "node_modules"))) run("npm install --no-package-lock --no-audit --no-fund", dir);
  if (!existsSync(join(dir, "node_modules", ".prisma", "client", "index.js"))) run("npx prisma generate", dir);
  if (!existsSync(join(dir, "prisma", "dev.db"))) run("npx prisma db push --skip-generate", dir);
}

console.log("\nMotor de nómina externo listo. Se levanta con: node integraciones/nomina-externo.cjs (npm start lo hace solo).");
