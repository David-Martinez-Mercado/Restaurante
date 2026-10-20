// Carga datos de demostración a través del gateway: cuentas del personal y un cliente en línea,
// el menú, las mesas, un pedido en mesa, un pedido en línea y una reservación.
// Es seguro repetirlo (no duplica lo que ya existe).
// Requisito: el sistema debe estar corriendo (npm start).
// Uso: npm run seed
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DISHES, RESTAURANT_NAME, SAMPLE_ORDER, TABLES } from "./menu-data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envValue(file, key, fallback) {
  const path = join(root, file);
  if (!existsSync(path)) return fallback;
  return readFileSync(path, "utf8").replace(/^﻿/, "").match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim() || fallback;
}

const GW = process.env.GATEWAY_URL ?? `http://localhost:${envValue("gateway/.env", "PORT", "3000")}`;
const PASSWORD = "Demo1234";
// El administrador inicial lo crea el User Service al arrancar (BOOTSTRAP_ADMIN_* en su .env).
const ADMIN_USER = envValue("services/user/.env", "BOOTSTRAP_ADMIN_USERNAME", "admin");
const ADMIN_PASSWORD = envValue("services/user/.env", "BOOTSTRAP_ADMIN_PASSWORD", "Admin1234");

async function call(method, path, { token, body } = {}) {
  let res;
  try {
    res = await fetch(GW + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    console.error(`No se pudo conectar con ${GW}. ¿Están corriendo los servicios? (npm start)`);
    process.exit(1);
  }
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function login(username, password) {
  const r = await call("POST", "/api/v1/auth/login", { body: { username, password } });
  if (!r.json?.accessToken) {
    console.error(`No se pudo entrar como "${username}" (${r.status}). ¿Ya existe con otra contraseña?`);
    process.exit(1);
  }
  return r.json;
}

console.log(`Cuentas de ${RESTAURANT_NAME}:`);
const adminSession = await login(ADMIN_USER, ADMIN_PASSWORD);
const admin = adminSession.accessToken;
console.log(`  = ${ADMIN_USER} (admin)`);

/** El personal lo da de alta el administrador; si ya existe, solo se inicia sesión. */
async function staff(username, role) {
  const r = await call("POST", "/api/v1/auth/users", {
    token: admin,
    body: { username, email: `${username}@example.com`, password: PASSWORD, role },
  });
  const created = r.status === 201;
  if (!created && r.status !== 409) {
    console.error(`No se pudo crear a "${username}" (${r.status}): ${JSON.stringify(r.json)}`);
    process.exit(1);
  }
  console.log(`  ${created ? "+" : "="} ${username} (${role})`);
  const session = await login(username, PASSWORD);
  return { token: session.accessToken, id: session.user.id };
}

const managerAccount = await staff("gerente", "manager");
const waiterAccount = await staff("mesero", "waiter");
const cookAccount = await staff("cocinero", "cook");
const cashierAccount = await staff("cajero", "cashier");
const manager = managerAccount.token;
const waiter = waiterAccount.token;

// El registro público siempre crea clientes.
const reg = await call("POST", "/api/v1/auth/register", {
  body: { username: "cliente", email: "cliente@example.com", password: PASSWORD },
});
const customerSession = reg.status === 201 ? reg.json : await login("cliente", PASSWORD);
const customer = customerSession.accessToken;
console.log(`  ${reg.status === 201 ? "+" : "="} cliente (customer)`);

console.log("\nPerfil del cliente de demostración:");
const profile = await call("PUT", "/api/v1/customers/me", {
  token: customer,
  body: {
    fullName: "Cliente Demo",
    phone: "5512345678",
    billing: { rfc: "XAXX010101000", businessName: "Cliente Demo", postalCode: "34000", taxRegime: "612", cfdiUse: "G03" },
  },
});
console.log(`  ${profile.status === 200 ? "=" : "!"} nombre, teléfono y datos fiscales (${profile.status})`);

console.log("\nMenú:");
const dishes = (await call("GET", "/api/v1/dishes", { token: admin })).json.data;
if (dishes.length > 0) {
  console.log(`  = ya hay ${dishes.length} platillo(s), no se crean más`);
} else {
  let ok = 0;
  for (const d of DISHES) {
    const r = await call("POST", "/api/v1/dishes", { token: manager, body: d });
    if (r.status === 201) ok++;
    else console.log(`  ! ${d.name} (${r.status})`);
  }
  console.log(`  + ${ok} platillos creados`);
}

console.log("\nMesas:");
const tables = (await call("GET", "/api/v1/tables", { token: admin })).json.data;
if (tables.length > 0) {
  console.log(`  = ya hay ${tables.length} mesa(s), no se crean más`);
} else {
  let ok = 0;
  for (const t of TABLES) {
    if ((await call("POST", "/api/v1/tables", { token: manager, body: t })).status === 201) ok++;
  }
  console.log(`  + ${ok} mesas creadas`);
}

const allDishes = (await call("GET", "/api/v1/dishes", { token: admin })).json.data;
const itemsFor = (names) =>
  names
    .map((name) => allDishes.find((d) => d.name === name))
    .filter(Boolean)
    .map((d, i) => ({ dishId: d.id, quantity: i === 2 ? 2 : 1 }));

console.log("\nPedido de ejemplo (en mesa):");
const orders = (await call("GET", "/api/v1/orders", { token: admin })).json.data;
if (orders.length > 0) {
  console.log(`  = ya hay ${orders.length} pedido(s)`);
} else {
  const freeTables = (await call("GET", "/api/v1/tables?status=free", { token: admin })).json.data;
  const items = itemsFor(SAMPLE_ORDER);
  if (freeTables[2] && items.length > 0) {
    const r = await call("POST", "/api/v1/orders", {
      token: waiter,
      body: { tableId: freeTables[2].id, items, notes: "Término medio en los cortes" },
    });
    console.log(`  ${r.status === 201 ? "+" : "!"} pedido en la mesa ${freeTables[2].number} (${r.status})`);
  }
}

console.log("\nPedido en línea del cliente:");
const mine = (await call("GET", "/api/v1/orders/mine", { token: customer })).json?.data ?? [];
if (mine.length > 0) {
  console.log(`  = ya tiene ${mine.length} pedido(s)`);
} else {
  const items = itemsFor(SAMPLE_ORDER).slice(0, 2);
  const r = await call("POST", "/api/v1/orders/online", { token: customer, body: { items, notes: "Para recoger" } });
  console.log(`  ${r.status === 201 ? "+" : "!"} pedido para recoger (${r.status})`);
}

console.log("\nReservación del cliente:");
const reservations = (await call("GET", "/api/v1/reservations", { token: customer })).json?.data ?? [];
if (reservations.some((r) => r.status === "confirmed")) {
  console.log("  = ya tiene una reservación confirmada");
} else {
  // Mañana a las 20:00 (hora local del servidor, que es la que usan las reglas de horario).
  const when = new Date();
  when.setDate(when.getDate() + 1);
  when.setHours(20, 0, 0, 0);
  const r = await call("POST", "/api/v1/reservations", {
    token: customer,
    body: { reservedFor: when.toISOString(), partySize: 4, notes: "Aniversario" },
  });
  console.log(`  ${r.status === 201 ? "+" : "!"} mesa para 4 mañana a las 20:00 (${r.status})`);
}

// ---------------------------------------------------------------- checador y nómina

console.log("\nSueldos del personal (nómina):");
const prev = new Date();
prev.setDate(1);
prev.setMonth(prev.getMonth() - 1);
const pad = (n) => String(n).padStart(2, "0");
const prevPeriod = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
const prevStart = `${prevPeriod}-01`;

const STAFF = [
  { account: managerAccount, username: "gerente", fullName: "Gerente de Sucursal", position: "Gerente", salary: 18000_00 },
  { account: waiterAccount, username: "mesero", fullName: "Marco Meseros Ruiz", position: "Mesero", salary: 9000_00 },
  { account: cookAccount, username: "cocinero", fullName: "Carlos Cocinas Soto", position: "Cocinero", salary: 11000_00 },
  { account: cashierAccount, username: "cajero", fullName: "Clara Cajas Vega", position: "Cajero", salary: 9500_00 },
];
for (const s of STAFF) {
  const r = await call("PUT", `/api/v1/payroll/compensations/${s.account.id}`, {
    token: manager,
    body: { fullName: s.fullName, position: s.position, monthlySalaryCents: s.salary, hireDate: prevStart, active: true },
  });
  console.log(`  ${r.status === 200 ? "=" : "!"} ${s.username}: ${(s.salary / 100).toLocaleString("es-MX")} al mes (${r.status})`);
}

console.log(`
Asistencia de ${prevPeriod} (lunes a sábado, 9:00 a 17:00):`);
const lastDay = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
const prevEnd = `${prevPeriod}-${pad(lastDay)}`;
for (const s of STAFF) {
  const existing = (await call("GET", `/api/v1/attendance?from=${prevStart}&to=${prevEnd}&userId=${s.account.id}`, { token: manager })).json?.data ?? [];
  if (existing.length > 0) {
    console.log(`  = ${s.username}: ya tiene ${existing.length} jornadas`);
    continue;
  }
  let created = 0;
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(prev.getFullYear(), prev.getMonth(), day);
    if (d.getDay() === 0) continue; // domingo: descanso
    if (s.username === "mesero" && day === 12) continue; // una falta de demostración
    const overtime = s.username === "cocinero" && [5, 6, 19].includes(day) ? 3 : 0; // 3 h extra en 3 días
    const at = (h) => new Date(prev.getFullYear(), prev.getMonth(), day, h, 0, 0).toISOString();
    const r = await call("POST", "/api/v1/attendance/manual", {
      token: manager,
      body: { userId: s.account.id, username: s.username, clockIn: at(9), clockOut: at(17 + overtime), note: "Datos de demostración" },
    });
    if (r.status === 201) created++;
  }
  console.log(`  + ${s.username}: ${created} jornadas`);
}
console.log(`  (el mesero tiene 1 falta y el cocinero 9 h extra: calcula la nómina de ${prevPeriod} en la pestaña Nómina)`);

console.log(`
Listo. Cuentas de demostración:
  ${ADMIN_USER.padEnd(9)} / ${ADMIN_PASSWORD}   administrador
  gerente   / ${PASSWORD}   gerente
  mesero    / ${PASSWORD}   mesero
  cocinero  / ${PASSWORD}   cocinero
  cajero    / ${PASSWORD}   cajero
  cliente   / ${PASSWORD}   cliente en línea (portal de pedidos, pagos y reservaciones)
`);
