// Lanzador del motor de nómina EXTERNO (repo SistemaNomina, de otro autor).
//
// El repo original NO se modifica: este archivo vive en NUESTRO proyecto y solo hace tres cosas:
//   1. Elige puertos que no choquen con los nuestros (el original usa 3001-3006, igual que nosotros).
//   2. Apunta las URLs entre sus servicios a esos puertos (el original las lee de variables de entorno).
//   3. Carga sus servicios (employees, incidents, payroll) en UN SOLO proceso de Node para ahorrar memoria.
//
// No usamos su AAA, su gateway ni su front: la autenticación, los permisos y la interfaz son los nuestros.
// Sus servicios no traen autenticación propia, por eso solo se exponen en 127.0.0.1 (ver LISTEN_HOST abajo).
//
// Uso: node integraciones/nomina-externo.cjs     (antes: node scripts/nomina-externo-setup.mjs)
const path = require("node:path");
const net = require("node:net");

const base = path.join(__dirname, "SistemaNomina");

const PORTS = {
  employees: Number(process.env.NOMINA_EMPLOYEES_PORT ?? 3102),
  payroll: Number(process.env.NOMINA_PAYROLL_PORT ?? 3103),
  incidents: Number(process.env.NOMINA_INCIDENTS_PORT ?? 3104),
};

// Servicios del original que NO levantamos (tienen equivalente propio o no se necesitan):
// prestaciones (3106) y notificaciones (3105). Su motor de nómina tolera que no estén (los ignora).
// Se apuntan a puertos vacíos para que no choquen con nuestro Notification Service (3005).
process.env.EMPLOYEES_URL = `http://127.0.0.1:${PORTS.employees}`;
process.env.INCIDENTS_URL = `http://127.0.0.1:${PORTS.incidents}`;
process.env.BENEFITS_URL = "http://127.0.0.1:3106";
process.env.NOTIFICATIONS_URL = "http://127.0.0.1:3105";

// Los servicios originales hacen app.listen(puerto) sin indicar host (escuchan en todas las interfaces).
// Como no tienen autenticación, se fuerza 127.0.0.1 para que solo nuestro equipo pueda llamarlos.
const LISTEN_HOST = "127.0.0.1";
const realListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === "number" && typeof args[1] !== "string") args.splice(1, 0, LISTEN_HOST);
  return realListen.apply(this, args);
};

for (const [name, dir] of [
  ["employees", "employees-service"],
  ["incidents", "incidents-service"],
  ["payroll", "payroll-service"],
]) {
  // Cada servicio lee su puerto de process.env.PORT justo al arrancar.
  process.env.PORT = String(PORTS[name]);
  require(path.join(base, dir, "index.js"));
}

console.log(`Motor de nómina externo (SistemaNomina): empleados :${PORTS.employees} · nómina :${PORTS.payroll} · incidencias :${PORTS.incidents} (solo 127.0.0.1)`);
