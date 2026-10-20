// Prueba de humo de extremo a extremo contra el sistema en ejecución (vía gateway).
// Verifica autenticación, autorización, pedidos (mesa y en línea), pago con webhook firmado,
// avisos (campana y Telegram), reservaciones, calculadora de IVA, checador, nómina (con el motor
// externo SistemaNomina) y auditoría.
// Crea datos propios con sufijo único y los limpia al terminar; no depende del seed.
// Para simular al bot de Telegram y a la pasarela llama directo a las rutas internas con la
// llave del .env, igual que lo harían esos componentes.
// Uso: npm run smoke   (con los servicios corriendo)
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envValue(file, key, fallback) {
  const path = join(root, file);
  if (!existsSync(path)) return fallback;
  return readFileSync(path, "utf8").replace(/^﻿/, "").match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim() || fallback;
}

const port = (file, fallback) => envValue(file, "PORT", String(fallback));
const GW = process.env.GATEWAY_URL ?? `http://localhost:${port("gateway/.env", 3000)}`;
const AUDIT_DIRECT = `http://localhost:${port("services/audit/.env", 3004)}`;
const CUSTOMER_DIRECT = `http://localhost:${port("services/customer/.env", 3008)}`;
const RESERVATION_DIRECT = `http://localhost:${port("services/reservation/.env", 3007)}`;
const INTERNAL_KEY = envValue("services/audit/.env", "INTERNAL_API_KEY", "");
const WEBHOOK_SECRET = envValue("services/payment/.env", "PAYMENT_WEBHOOK_SECRET", "");
const ADMIN_USER = envValue("services/user/.env", "BOOTSTRAP_ADMIN_USERNAME", "admin");
const ADMIN_PASSWORD = envValue("services/user/.env", "BOOTSTRAP_ADMIN_PASSWORD", "Admin1234");

const sfx = Date.now().toString(36);
const chatId = String(Date.now()).slice(-9) + "7"; // chat de Telegram de mentira, único por corrida
let pass = 0;
let fail = 0;

async function call(method, path, { token, body, raw, headers, base = GW } = {}) {
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        ...(body || raw ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    console.error(`No se pudo conectar con ${base}. ¿Están corriendo los servicios? (npm start)`);
    process.exit(1);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
  return { status: res.status, json, text };
}

const internal = { "x-internal-key": INTERNAL_KEY };

function check(name, ok, extra = "") {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

/** Espera (hasta `ms`) a que `fn` devuelva algo verdadero; los avisos se entregan en segundo plano. */
async function eventually(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 300));
  }
}

const ymd8 = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sign = (raw) => "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

// ---------------------------------------------------------------- preparación

console.log("AUTENTICACIÓN");
const health = await call("GET", "/api/v1/gateway/health");
check("health agregado ok (los 10 servicios)", health.json?.status === "ok" && Object.keys(health.json.services ?? {}).length === 10, health.text);
check("sin token -> 401", (await call("GET", "/api/v1/dishes")).status === 401);
check("token falso -> 401 TOKEN_INVALID", (await call("GET", "/api/v1/dishes", { token: "basura" })).json?.error?.code === "TOKEN_INVALID");
const bad = await call("POST", "/api/v1/auth/login", { body: { username: "no_existe", password: "x" } });
check("login incorrecto -> 401 INVALID_CREDENTIALS", bad.status === 401 && bad.json?.error?.code === "INVALID_CREDENTIALS", bad.text);

const adminLogin = await call("POST", "/api/v1/auth/login", { body: { username: ADMIN_USER, password: ADMIN_PASSWORD } });
if (!adminLogin.json?.accessToken) {
  console.error(`No se pudo entrar como administrador "${ADMIN_USER}" (${adminLogin.status}). Revisa BOOTSTRAP_ADMIN_* en services/user/.env`);
  process.exit(1);
}
const admin = adminLogin.json.accessToken;
check("el administrador inicial puede entrar", true);

// El personal lo crea el administrador.
const tokens = {};
for (const role of ["manager", "cook", "waiter", "cashier"]) {
  const r = await call("POST", "/api/v1/auth/users", {
    token: admin,
    body: { username: `${role}_${sfx}`, email: `${role}_${sfx}@example.com`, password: "Secreta123", role },
  });
  if (r.status !== 201) throw new Error(`alta de ${role}: ${r.status} ${r.text}`);
  tokens[role] = (await call("POST", "/api/v1/auth/login", { body: { username: `${role}_${sfx}`, password: "Secreta123" } })).json.accessToken;
}
const ids = {};
for (const role of Object.keys(tokens)) ids[role] = (await call("GET", "/api/v1/auth/me", { token: tokens[role] })).json?.user?.id;
check("el administrador da de alta al personal", Object.keys(tokens).length === 4 && Object.values(ids).every(Boolean));
check("el gerente NO puede dar de alta usuarios -> 403", (await call("POST", "/api/v1/auth/users", { token: tokens.manager, body: { username: `x_${sfx}`, email: "x@example.com", password: "Secreta123", role: "waiter" } })).status === 403);

// Dos clientes: el segundo sirve para comprobar que nadie ve lo ajeno.
async function registerCustomer(tag, extra = {}) {
  const r = await call("POST", "/api/v1/auth/register", {
    body: { username: `${tag}_${sfx}`, email: `${tag}_${sfx}@example.com`, password: "Secreta123", ...extra },
  });
  if (r.status !== 201) throw new Error(`registro de ${tag}: ${r.status} ${r.text}`);
  return { token: r.json.accessToken, id: r.json.user.id };
}
const ana = await registerCustomer("ana", { role: "admin" }); // intenta colarse como admin
const beto = await registerCustomer("beto");
const meAna = await call("GET", "/api/v1/auth/me", { token: ana.token });
check("el registro público SIEMPRE crea un cliente (aunque mande role=admin)", meAna.json?.user?.role === "customer", meAna.text);
check("/me del cliente no trae permisos de personal", !meAna.json.permissions.includes("orders:create") && meAna.json.permissions.includes("orders:create-online"), meAna.text);

// ---------------------------------------------------------------- autorización y menú

console.log("AUTORIZACIÓN");
const dishBody = { name: `Platillo ${sfx}`, priceCents: 8500, category: "main" };
check("cocinero no crea platillos -> 403", (await call("POST", "/api/v1/dishes", { token: tokens.cook, body: dishBody })).status === 403);
check("cliente no crea platillos -> 403", (await call("POST", "/api/v1/dishes", { token: ana.token, body: dishBody })).status === 403);
const dish1 = await call("POST", "/api/v1/dishes", { token: tokens.manager, body: dishBody });
check("gerente crea platillo -> 201", dish1.status === 201, dish1.text);
const dish2 = await call("POST", "/api/v1/dishes", { token: tokens.manager, body: { name: `Bebida ${sfx}`, priceCents: 3000, category: "drink" } });
let table = await call("POST", "/api/v1/tables", { token: tokens.manager, body: { number: Math.floor(Math.random() * 900) + 100, capacity: 4 } });
if (table.status === 409) table = await call("POST", "/api/v1/tables", { token: tokens.manager, body: { number: Math.floor(Math.random() * 900) + 100, capacity: 4 } });
check("gerente crea mesa -> 201", table.status === 201, table.text);
check("platillo duplicado -> 409", (await call("POST", "/api/v1/dishes", { token: tokens.manager, body: dishBody })).status === 409);
check("mesero no lista usuarios -> 403", (await call("GET", "/api/v1/auth/users", { token: tokens.waiter })).status === 403);
check("el cliente ve el menú (dishes:read)", (await call("GET", "/api/v1/dishes?available=true", { token: ana.token })).status === 200);
check("el cliente no ve la lista de usuarios -> 403", (await call("GET", "/api/v1/auth/users", { token: ana.token })).status === 403);
check("el cliente no ve los pedidos del restaurante -> 403", (await call("GET", "/api/v1/orders", { token: ana.token })).status === 403);
check("el cliente no consulta la auditoría -> 403", (await call("GET", "/api/v1/audit", { token: ana.token })).status === 403);

const d1 = dish1.json.data.id, d2 = dish2.json.data.id, t = table.json.data.id;
check("el cliente no crea pedidos de mesa -> 403", (await call("POST", "/api/v1/orders", { token: ana.token, body: { tableId: t, items: [{ dishId: d1, quantity: 1 }] } })).status === 403);

// ---------------------------------------------------------------- perfil del cliente

console.log("CLIENTE EN LÍNEA");
const noProfile = await call("POST", "/api/v1/orders/online", { token: ana.token, body: { items: [{ dishId: d1, quantity: 1 }] } });
check("sin perfil no puede pedir en línea -> 409", noProfile.status === 409, noProfile.text);
check("sin perfil GET /customers/me -> 404", (await call("GET", "/api/v1/customers/me", { token: ana.token })).status === 404);
check("teléfono inválido -> 422", (await call("PUT", "/api/v1/customers/me", { token: ana.token, body: { fullName: "Ana López", phone: "123" } })).status === 422);
const saveAna = await call("PUT", "/api/v1/customers/me", {
  token: ana.token,
  body: {
    fullName: `Ana López ${sfx}`, phone: "5512345678",
    billing: { rfc: "XAXX010101000", businessName: "Ana López", postalCode: "34000", taxRegime: "612", cfdiUse: "G03" },
  },
});
check("el cliente guarda su perfil con datos fiscales", saveAna.status === 200 && saveAna.json?.data?.billing?.rfc === "XAXX010101000", saveAna.text);
await call("PUT", "/api/v1/customers/me", { token: beto.token, body: { fullName: `Beto Ruiz ${sfx}`, phone: "5598765432" } });
check("RFC inválido -> 422", (await call("PUT", "/api/v1/customers/me", { token: ana.token, body: { fullName: "Ana López", phone: "5512345678", billing: { rfc: "MAL", businessName: "x y", postalCode: "34000", taxRegime: "612", cfdiUse: "G03" } } })).status === 422);
check("el cliente no lista a otros clientes -> 403", (await call("GET", "/api/v1/customers", { token: ana.token })).status === 403);
const found = await call("GET", `/api/v1/customers?search=${encodeURIComponent(`Ana López ${sfx}`)}`, { token: tokens.waiter });
check("el mesero busca clientes", found.status === 200 && found.json?.data?.length === 1, found.text);
check("el mesero NO ve datos fiscales ni Telegram del cliente", found.json?.data?.[0] && !("billing" in found.json.data[0]) && !("telegramChatId" in found.json.data[0]), found.text);

// ---------------------------------------------------------------- pedido en línea + aviso "listo"

console.log("PEDIDO EN LÍNEA Y AVISO DE 'LISTO'");
const online = await call("POST", "/api/v1/orders/online", { token: ana.token, body: { items: [{ dishId: d1, quantity: 2 }, { dishId: d2, quantity: 1 }], notes: "Para recoger" } });
check("el cliente hace un pedido en línea -> 201", online.status === 201, online.text);
const ol = online.json?.data;
check("es para recoger, sin mesa, a su nombre", ol?.channel === "pickup" && ol?.tableId === null && ol?.customerUserId === ana.id, JSON.stringify(ol));
check("el precio sale del menú: 2x8500 + 3000 + IVA = 23200", ol?.subtotalCents === 20000 && ol?.totalCents === 23200, `${ol?.subtotalCents}/${ol?.totalCents}`);
check("lo ve en 'mis pedidos'", (await call("GET", "/api/v1/orders/mine", { token: ana.token })).json?.data?.some((o) => o.id === ol.id));
check("otro cliente no ve su pedido (404)", (await call("GET", `/api/v1/orders/mine/${ol.id}`, { token: beto.token })).status === 404);
check("el otro cliente no lo ve en su lista", !(await call("GET", "/api/v1/orders/mine", { token: beto.token })).json?.data?.some((o) => o.id === ol.id));
check("la cocina lo ve en la lista del restaurante", (await call("GET", "/api/v1/orders", { token: tokens.cook })).json?.data?.some((o) => o.id === ol.id));

const move = (id, token, status, extra = {}) => call("PATCH", `/api/v1/orders/${id}/status`, { token, body: { status, ...extra } });
check("cocinero: pending -> preparing", (await move(ol.id, tokens.cook, "preparing")).status === 200);
const noBellYet = await call("GET", "/api/v1/notifications/mine", { token: ana.token });
check("aún no está listo: no hay aviso", !noBellYet.json?.data?.some((n) => n.type === "order.ready"));
check("cocinero: preparing -> ready", (await move(ol.id, tokens.cook, "ready")).status === 200);
const readyNote = await eventually(async () => (await call("GET", "/api/v1/notifications/mine", { token: ana.token })).json?.data?.find((n) => n.type === "order.ready"));
check("EN LÍNEA: al quedar listo, el cliente recibe el aviso en su campana", !!readyNote && readyNote.body.includes(ol.code), JSON.stringify(readyNote));
check("el aviso trae título y no expone datos internos", readyNote?.title === "¡Tu pedido está listo!" && readyNote.recipientUserId === null);
check("el otro cliente NO recibe ese aviso", !(await call("GET", "/api/v1/notifications/mine", { token: beto.token })).json?.data?.some((n) => n.type === "order.ready"));
check("cuenta de no leídas = 1", (await call("GET", "/api/v1/notifications/mine/unread-count", { token: ana.token })).json?.data?.unread === 1);
check("marca el aviso como leído", (await call("PATCH", `/api/v1/notifications/${readyNote.id}/read`, { token: ana.token })).json?.data?.readAt != null);
check("no puede marcar un aviso ajeno (404)", (await call("PATCH", `/api/v1/notifications/${readyNote.id}/read`, { token: beto.token })).status === 404);

// ---------------------------------------------------------------- pago en línea (solo contrato con la pasarela)

console.log("PAGO EN LÍNEA (contrato con la pasarela)");
const pay = await call("POST", "/api/v1/payments", { token: ana.token, body: { orderId: ol.id, amountCents: 1 } });
check("el cliente inicia el pago de SU pedido -> 201", pay.status === 201, pay.text);
const p = pay.json?.data;
check("el importe lo fija el pedido, no el cliente (231.00, no 0.01)", p?.amountCents === 23200, String(p?.amountCents));
check("el cobro nace 'pendiente'", p?.status === "pending");
if (p && !p.gatewayConfigured) {
  const g = p.gatewayRequest;
  check("sin pasarela: la API muestra lo que le enviaría (POST /v1/charges)", g?.reference === p.id && g?.currency === "MXN" && g?.amountCents === 23200, JSON.stringify(g));
  check("las líneas del cargo suman exactamente el total (IVA incluido)", g?.items?.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0) === g?.amountCents);
  check("el cargo trae la URL del webhook y la de regreso", /\/api\/v1\/payments\/webhook$/.test(g?.webhookUrl ?? "") && /payment=/.test(g?.returnUrl ?? ""));
} else {
  check("con pasarela: devuelve la página de pago", !!p?.checkoutUrl);
}
const pay2 = await call("POST", "/api/v1/payments", { token: ana.token, body: { orderId: ol.id } });
check("pedir otra vez devuelve el MISMO cobro pendiente (no duplica)", pay2.json?.data?.id === p?.id);
check("otro cliente no puede pagar ese pedido (404)", (await call("POST", "/api/v1/payments", { token: beto.token, body: { orderId: ol.id } })).status === 404);
check("otro cliente no ve el cobro (404)", (await call("GET", `/api/v1/payments/${p.id}`, { token: beto.token })).status === 404);
check("el mesero no inicia pagos de clientes -> 403", (await call("POST", "/api/v1/payments", { token: tokens.waiter, body: { orderId: ol.id } })).status === 403);
check("el cajero ve los pagos en línea", (await call("GET", "/api/v1/payments", { token: tokens.cashier })).json?.data?.some((x) => x.id === p.id));
check("el cliente no ve el listado general -> 403", (await call("GET", "/api/v1/payments", { token: ana.token })).status === 403);

console.log("WEBHOOK DE LA PASARELA (lo que recibe)");
const hook = { eventId: `evt_${sfx}`, type: "payment.succeeded", reference: p.id, gatewayReference: `gw_${sfx}`, amountCents: 23200, currency: "MXN", method: "card" };
const raw = JSON.stringify(hook);
check("sin firma -> 401", (await call("POST", "/api/v1/payments/webhook", { raw })).status === 401);
check("firma de otro secreto -> 401", (await call("POST", "/api/v1/payments/webhook", { raw, headers: { "x-signature": "sha256=" + "0".repeat(64) } })).status === 401);
check("cuerpo alterado con la firma original -> 401", (await call("POST", "/api/v1/payments/webhook", { raw: raw.replace("23200", "100"), headers: { "x-signature": sign(raw) } })).status === 401);
check("un JWT de usuario no sustituye a la firma -> 401", (await call("POST", "/api/v1/payments/webhook", { raw, token: admin })).status === 401);
check("aún no cambió nada: sigue pendiente", (await call("GET", `/api/v1/payments/${p.id}`, { token: ana.token })).json?.data?.status === "pending");

const wrongAmount = JSON.stringify({ ...hook, eventId: `evt_x_${sfx}`, amountCents: 100 });
check("importe distinto con firma válida -> 422 (y no se paga)", (await call("POST", "/api/v1/payments/webhook", { raw: wrongAmount, headers: { "x-signature": sign(wrongAmount) } })).status === 422);
check("sigue pendiente tras el importe incorrecto", (await call("GET", `/api/v1/payments/${p.id}`, { token: ana.token })).json?.data?.status === "pending");

const ok = await call("POST", "/api/v1/payments/webhook", { raw, headers: { "x-signature": sign(raw) } });
check("webhook firmado y correcto (sin JWT) -> 200", ok.status === 200 && ok.json?.data?.outcome === "processed", ok.text);
const dup = await call("POST", "/api/v1/payments/webhook", { raw, headers: { "x-signature": sign(raw) } });
check("el mismo eventId otra vez -> 200 'duplicate' (idempotente)", dup.status === 200 && dup.json?.data?.outcome === "duplicate", dup.text);
const paid = (await call("GET", `/api/v1/payments/${p.id}`, { token: ana.token })).json?.data;
check("el cobro quedó 'pagado' con método y referencia de la pasarela", paid?.status === "paid" && paid.method === "card" && paid.gatewayReference === `gw_${sfx}`, JSON.stringify(paid));
const olPaid = (await call("GET", `/api/v1/orders/mine/${ol.id}`, { token: ana.token })).json?.data;
check("el pedido quedó pagado en línea", olPaid?.paidAt != null && olPaid.paymentMethod === "online", JSON.stringify(olPaid));
check("el pedido pagado ya no se puede cancelar (409)", (await move(ol.id, tokens.waiter, "cancelled")).status === 409);
check("ya no se puede pagar de nuevo (409)", (await call("POST", "/api/v1/payments", { token: ana.token, body: { orderId: ol.id } })).status === 409);
const failLate = JSON.stringify({ ...hook, eventId: `evt_f_${sfx}`, type: "payment.failed" });
check("un 'falló' tardío sobre un pago ya pagado se ignora (200)", (await call("POST", "/api/v1/payments/webhook", { raw: failLate, headers: { "x-signature": sign(failLate) } })).json?.data?.outcome === "ignored");
check("y el pago sigue pagado", (await call("GET", `/api/v1/payments/${p.id}`, { token: ana.token })).json?.data?.status === "paid");
const payNote = await eventually(async () => (await call("GET", "/api/v1/notifications/mine", { token: ana.token })).json?.data?.find((n) => n.type === "payment.confirmed"));
check("el cliente recibe 'pago recibido' en su campana", !!payNote && payNote.body.includes("$232.00"), payNote?.body);

console.log("CONSUMO TERMINADO: RESUMEN Y PREGUNTA DE FACTURA");
check("mesero: ready -> served (ya pagado en línea, pasa directo a pagado)", (await move(ol.id, tokens.waiter, "served")).json?.data?.status === "paid");
const summary1 = await eventually(async () => (await call("GET", "/api/v1/notifications/mine", { token: ana.token })).json?.data?.find((n) => n.type === "order.paid"));
check("el cliente recibe el resumen de su consumo", !!summary1, "no llegó");
check("el resumen trae la descripción de los platillos", summary1?.body.includes(`2 × Platillo ${sfx}`) && summary1.body.includes(`1 × Bebida ${sfx}`), summary1?.body);
check("el resumen trae importes y el método de pago", summary1?.body.includes("Total: $232.00") && summary1.body.includes("Método de pago: Pago en línea"), summary1?.body);
check("el resumen pregunta si va a facturar", summary1?.body.includes("¿Vas a facturar?"));

// ---------------------------------------------------------------- pedido en mesa ligado al cliente (cobro en mostrador)

console.log("PEDIDO EN MESA, LIGADO A UN CLIENTE");
check("un cliente inexistente -> 404", (await call("POST", "/api/v1/orders", { token: tokens.waiter, body: { tableId: t, customerUserId: "00000000-0000-4000-8000-000000000000", items: [{ dishId: d1, quantity: 1 }] } })).status === 404);
const order = await call("POST", "/api/v1/orders", {
  token: tokens.waiter,
  body: { tableId: t, customerUserId: beto.id, items: [{ dishId: d1, quantity: 2 }, { dishId: d2, quantity: 1 }, { dishId: d1, quantity: 1 }] },
});
check("mesero crea pedido para un cliente registrado -> 201", order.status === 201, order.text);
const o = order.json?.data;
check("renglones repetidos se unen (2 líneas)", o?.items?.length === 2, JSON.stringify(o?.items));
check("subtotal 3x8500 + 3000 = 28500", o?.subtotalCents === 28500, String(o?.subtotalCents));
check("IVA 16 % = 4560, total 33060", o?.taxCents === 4560 && o?.totalCents === 33060, `${o?.taxCents}/${o?.totalCents}`);
check("lleva el nombre del cliente", o?.customerName === `Beto Ruiz ${sfx}`, String(o?.customerName));
check("la mesa quedó ocupada", (await call("GET", `/api/v1/tables/${t}`, { token: tokens.waiter })).json?.data?.status === "occupied");
check("2º pedido activo en la misma mesa -> 409", (await call("POST", "/api/v1/orders", { token: tokens.waiter, body: { tableId: t, items: [{ dishId: d1, quantity: 1 }] } })).status === 409);

check("cajero no crea pedidos -> 403", (await call("POST", "/api/v1/orders", { token: tokens.cashier, body: { tableId: t, items: [{ dishId: d1, quantity: 1 }] } })).status === 403);
check("pending -> paid es transición inválida -> 409", (await move(o.id, tokens.cashier, "paid", { paymentMethod: "cash" })).status === 409);
check("cocinero: pending -> preparing", (await move(o.id, tokens.cook, "preparing")).json?.data?.status === "preparing");
check("mesero no marca listo -> 403", (await move(o.id, tokens.waiter, "ready")).status === 403);
check("cocinero: preparing -> ready", (await move(o.id, tokens.cook, "ready")).status === 200);
check("mesero: ready -> served", (await move(o.id, tokens.waiter, "served")).status === 200);
check("cocinero no cobra -> 403", (await move(o.id, tokens.cook, "paid", { paymentMethod: "cash" })).status === 403);
check("cobrar SIN método de pago -> 422", (await move(o.id, tokens.cashier, "paid")).status === 422);
check("'online' no se acepta en el mostrador -> 422", (await move(o.id, tokens.cashier, "paid", { paymentMethod: "online" })).status === 422);
const charged = await move(o.id, tokens.cashier, "paid", { paymentMethod: "card" });
check("cajero cobra con tarjeta: served -> paid", charged.json?.data?.status === "paid" && charged.json.data.paymentMethod === "card", charged.text);
check("al cobrar la mesa queda libre", (await call("GET", `/api/v1/tables/${t}`, { token: tokens.waiter })).json?.data?.status === "free");

const summary2 = await eventually(async () => (await call("GET", "/api/v1/notifications/mine", { token: beto.token })).json?.data?.find((n) => n.type === "order.paid"));
check("el cliente recibe el resumen con el método (Tarjeta) y la pregunta de factura", !!summary2 && summary2.body.includes("Método de pago: Tarjeta") && summary2.body.includes("¿Vas a facturar?"), summary2?.body);
check("el resumen trae el total 330.60 y los platillos", summary2?.body.includes("Total: $330.60") && summary2.body.includes(`3 × Platillo ${sfx}`), summary2?.body);

console.log("PLATILLO AGOTADO");
check("cocinero marca un platillo como agotado", (await call("PATCH", `/api/v1/dishes/${d2}/availability`, { token: tokens.cook, body: { available: false } })).status === 200);
check("pedir un platillo agotado -> 409", (await call("POST", "/api/v1/orders", { token: tokens.waiter, body: { tableId: t, items: [{ dishId: d2, quantity: 1 }] } })).status === 409);
check("tampoco en línea -> 409", (await call("POST", "/api/v1/orders/online", { token: ana.token, body: { items: [{ dishId: d2, quantity: 1 }] } })).status === 409);

// ---------------------------------------------------------------- Telegram (bot simulado)

console.log("TELEGRAM");
const link = await call("POST", "/api/v1/customers/me/telegram-link", { token: ana.token });
check("el cliente genera su código de vinculación (6 caracteres)", /^[A-Z0-9]{6}$/.test(link.json?.data?.code ?? ""), link.text);
const tg = await call("GET", "/api/v1/notifications/telegram", { token: ana.token });
check("el portal sabe si el bot está configurado", typeof tg.json?.data?.configured === "boolean", tg.text);
check("un código falso no vincula (404)", (await call("POST", "/api/v1/internal/telegram/link", { base: CUSTOMER_DIRECT, headers: internal, body: { code: "ZZZZZZ", chatId } })).status === 404);
check("las rutas internas exigen la llave -> 401", (await call("POST", "/api/v1/internal/telegram/link", { base: CUSTOMER_DIRECT, body: { code: link.json.data.code, chatId } })).status === 401);
const linked = await call("POST", "/api/v1/internal/telegram/link", { base: CUSTOMER_DIRECT, headers: internal, body: { code: link.json.data.code, chatId, username: "ana_demo" } });
check("el bot canjea el código (/start CODIGO) y vincula el chat", linked.status === 200 && linked.json?.data?.telegramLinked === true, linked.text);
check("el código ya no sirve una segunda vez", (await call("POST", "/api/v1/internal/telegram/link", { base: CUSTOMER_DIRECT, headers: internal, body: { code: link.json.data.code, chatId: "123" } })).status === 404);
check("el perfil ahora marca Telegram vinculado", (await call("GET", "/api/v1/customers/me", { token: ana.token })).json?.data?.telegramLinked === true);

const online2 = (await call("POST", "/api/v1/orders/online", { token: ana.token, body: { items: [{ dishId: d1, quantity: 1 }] } })).json?.data;
await move(online2.id, tokens.cook, "preparing");
await move(online2.id, tokens.cook, "ready");
const tgRow = await eventually(async () =>
  (await call("GET", "/api/v1/notifications?channel=telegram&limit=100", { token: tokens.manager })).json?.data?.find((n) => n.type === "order.ready" && n.body.includes(online2.code))
);
check("al quedar listo también sale por Telegram (enviado o simulado, no omitido)", !!tgRow && ["sent", "simulated", "failed"].includes(tgRow.delivery), JSON.stringify(tgRow));
const firstRow = (await call("GET", "/api/v1/notifications?channel=telegram&limit=100", { token: tokens.manager })).json?.data?.find((n) => n.type === "order.ready" && n.body.includes(ol.code));
check("antes de vincular quedó 'omitido' con el motivo", firstRow?.delivery === "skipped" && /no ha vinculado/i.test(firstRow.error ?? ""), JSON.stringify(firstRow));
check("el cliente no ve la bitácora del personal -> 403", (await call("GET", "/api/v1/notifications", { token: ana.token })).status === 403);

// ---------------------------------------------------------------- reservaciones

console.log("RESERVACIONES");
const day = new Date();
day.setDate(day.getDate() + 3);
const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
const at = (h, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d.toISOString(); };
const slots = await call("GET", `/api/v1/reservations/availability?date=${ymd}&partySize=2`, { token: ana.token });
check("consulta horarios del día (13:00 a 22:00 cada 30 min = 19)", slots.status === 200 && slots.json?.data?.length === 19, slots.text);
check("hay lugar a las 20:00", slots.json?.data?.find((s) => s.startsAt === at(20))?.available === true);
check("el grupo de 13 personas se rechaza -> 422", (await call("GET", `/api/v1/reservations/availability?date=${ymd}&partySize=13`, { token: ana.token })).status === 422);

const book = await call("POST", "/api/v1/reservations", { token: ana.token, body: { reservedFor: at(20), partySize: 2, notes: "Cumpleaños" } });
check("el cliente reserva con su HORA DE LLEGADA -> 201", book.status === 201 && book.json?.data?.status === "confirmed", book.text);
const rv = book.json?.data;
check("la reservación queda a su nombre con localizador de 6 caracteres", rv?.customerName === `Ana López ${sfx}` && /^[A-Z2-9]{6}$/.test(rv?.code ?? ""), JSON.stringify(rv));
check("hora fuera de horario (23:00) -> 422", (await call("POST", "/api/v1/reservations", { token: ana.token, body: { reservedFor: at(23), partySize: 2 } })).status === 422);
check("hora fuera de bloque (20:15) -> 422", (await call("POST", "/api/v1/reservations", { token: ana.token, body: { reservedFor: at(20, 15), partySize: 2 } })).status === 422);
check("grupo de 13 -> 422", (await call("POST", "/api/v1/reservations", { token: ana.token, body: { reservedFor: at(20), partySize: 13 } })).status === 422);
check("otra a esa misma hora para la misma persona -> 409", (await call("POST", "/api/v1/reservations", { token: ana.token, body: { reservedFor: at(20, 30), partySize: 2 } })).status === 409);
const confirmNote = await eventually(async () => (await call("GET", "/api/v1/notifications/mine", { token: ana.token })).json?.data?.find((n) => n.type === "reservation.confirmed"));
check("recibe la confirmación con el localizador y la hora (20:00)", !!confirmNote && confirmNote.body.includes(rv.code) && confirmNote.body.includes("20:00"), confirmNote?.body);

check("otro cliente no ve esa reservación (404)", (await call("GET", `/api/v1/reservations/${rv.id}`, { token: beto.token })).status === 404);
check("otro cliente no la puede cancelar (404)", (await call("PATCH", `/api/v1/reservations/${rv.id}/status`, { token: beto.token, body: { status: "cancelled" } })).status === 404);
check("el cliente solo lista las suyas", (await call("GET", "/api/v1/reservations", { token: beto.token })).json?.data?.every((r) => r.customerUserId === beto.id));
check("el mesero ve todas las del día", (await call("GET", `/api/v1/reservations?date=${ymd}`, { token: tokens.waiter })).json?.data?.some((r) => r.id === rv.id));
check("el cocinero no consulta reservaciones -> 403", (await call("GET", "/api/v1/reservations", { token: tokens.cook })).status === 403);
check("el cliente no puede marcar su propia llegada (403)", (await call("PATCH", `/api/v1/reservations/${rv.id}/status`, { token: ana.token, body: { status: "arrived" } })).status === 403);
check("llegada más de 1 h antes no se registra (409)", (await call("PATCH", `/api/v1/reservations/${rv.id}/status`, { token: tokens.waiter, body: { status: "arrived" } })).status === 409);
check("'no se presentó' antes de la hora no se permite (409)", (await call("PATCH", `/api/v1/reservations/${rv.id}/status`, { token: tokens.waiter, body: { status: "no_show" } })).status === 409);
check("no hay saltos de estado (confirmed -> completed) -> 409", (await call("PATCH", `/api/v1/reservations/${rv.id}/status`, { token: tokens.waiter, body: { status: "completed" } })).status === 409);

const walkin = await call("POST", "/api/v1/reservations", { token: tokens.waiter, body: { reservedFor: at(20), partySize: 4, customerName: "Luis Pérez", phone: "5511112222" } });
check("el mesero reserva por teléfono/mostrador (nombre + teléfono)", walkin.status === 201 && walkin.json?.data?.source === "staff", walkin.text);
check("sin nombre ni cliente -> 422", (await call("POST", "/api/v1/reservations", { token: tokens.waiter, body: { reservedFor: at(20), partySize: 2 } })).status === 422);

// El bot de Telegram reserva para quien no tiene cuenta.
const guest = await call("POST", "/api/v1/internal/reservations/telegram", {
  base: RESERVATION_DIRECT, headers: internal, body: { telegramChatId: `${chatId}9`, reservedFor: at(20), partySize: 2, customerName: "Invitado Humo" },
});
check("RESERVAR POR TELEGRAM: un invitado sin cuenta reserva con su chat -> 201", guest.status === 201 && guest.json?.data?.source === "telegram", guest.text);
const guestMsg = await eventually(async () =>
  (await call("GET", "/api/v1/notifications?channel=telegram&type=reservation.confirmed&limit=100", { token: tokens.manager })).json?.data?.find((n) => n.body.includes(guest.json.data.code))
);
check("a ese chat le llega la confirmación (modo real o simulado)", !!guestMsg && guestMsg.recipientUserId === null && guestMsg.delivery !== "skipped", JSON.stringify(guestMsg));
check("el bot lista las próximas reservaciones del chat", (await call("GET", `/api/v1/internal/reservations/by-chat/${chatId}9`, { base: RESERVATION_DIRECT, headers: internal })).json?.data?.length === 1);
check("las rutas del bot exigen la llave interna -> 401", (await call("GET", `/api/v1/internal/reservations/by-chat/${chatId}9`, { base: RESERVATION_DIRECT })).status === 401);
check("un chat ajeno no cancela la reservación (404)", (await call("POST", "/api/v1/internal/reservations/telegram/cancel", { base: RESERVATION_DIRECT, headers: internal, body: { chatId: "555", code: guest.json.data.code } })).status === 404);
check("el invitado la cancela desde el bot", (await call("POST", "/api/v1/internal/reservations/telegram/cancel", { base: RESERVATION_DIRECT, headers: internal, body: { chatId: `${chatId}9`, code: guest.json.data.code } })).json?.data?.status === "cancelled");

const sweep = await call("POST", "/api/v1/internal/reminders/run", { base: RESERVATION_DIRECT, headers: internal });
check("el escaneo de recordatorios corre", sweep.status === 200 && typeof sweep.json?.sent === "number", sweep.text);
check("el recordatorio no se puede forzar desde afuera (404 en el gateway)", (await call("POST", "/api/v1/internal/reminders/run", { token: admin })).status === 404);

check("el cliente cancela su reservación (falta más de 1 h)", (await call("PATCH", `/api/v1/reservations/${rv.id}/status`, { token: ana.token, body: { status: "cancelled" } })).json?.data?.status === "cancelled");
const cancelNote = await eventually(async () => (await call("GET", "/api/v1/notifications/mine", { token: ana.token })).json?.data?.find((n) => n.type === "reservation.cancelled"));
check("recibe el aviso de cancelación", !!cancelNote);
check("una cancelada no se puede reactivar (409)", (await call("PATCH", `/api/v1/reservations/${rv.id}/status`, { token: ana.token, body: { status: "confirmed" } })).status === 409);
check("el mesero cancela la del mostrador", (await call("PATCH", `/api/v1/reservations/${walkin.json.data.id}/status`, { token: tokens.waiter, body: { status: "cancelled" } })).status === 200);

// ---------------------------------------------------------------- aislamiento de rutas internas

console.log("RUTAS INTERNAS NO EXPUESTAS");
const evt = { type: "order.ready", orderId: ol.id, orderCode: "X", customerUserId: ana.id };
check("el gateway no publica /internal/events (404)", (await call("POST", "/api/v1/internal/events", { token: admin, body: evt })).status === 404);
check("nadie puede marcar un pedido como pagado desde afuera (404)", (await call("POST", `/api/v1/internal/orders/${online2.id}/payment-confirmed`, { token: admin, body: { paymentId: p.id } })).status === 404);
check("tampoco con el JWT de admin directo al servicio de notificaciones -> 401", (await call("POST", "/api/v1/internal/events", { base: `http://localhost:${port("services/notification/.env", 3005)}`, token: admin, body: evt })).status === 401);

// ---------------------------------------------------------------- accounting

console.log("ACCOUNTING");
await new Promise((r) => setTimeout(r, 1500)); // los eventos de auditoría son asíncronos
check("mesero no consulta la auditoría -> 403", (await call("GET", "/api/v1/audit", { token: tokens.waiter })).status === 403);
const audit = await call("GET", `/api/v1/audit?username=cook_${sfx}&limit=50`, { token: tokens.manager });
check("gerente consulta la bitácora", audit.status === 200 && audit.json?.total > 0, audit.text.slice(0, 200));
check("el intento denegado del cocinero quedó registrado", audit.json?.data?.some((e) => e.action === "dishes.create" && e.outcome === "denied"));
check("el gateway auditó los 401", (await call("GET", "/api/v1/audit?action=gateway.auth.denied&limit=5", { token: tokens.manager })).json?.total >= 2);
check("login fallido quedó como denied", (await call("GET", "/api/v1/audit?action=auth.login&outcome=denied", { token: tokens.manager })).json?.data?.some((e) => e.username === "no_existe"));
check("quedó el alta de personal hecha por el admin", (await call("GET", "/api/v1/audit?action=users.create&limit=50", { token: tokens.manager })).json?.data?.some((e) => e.username === ADMIN_USER));
check("quedó el pedido en línea del cliente", (await call("GET", `/api/v1/audit?action=orders.create-online&username=ana_${sfx}`, { token: tokens.manager })).json?.total >= 1);
check("quedó el inicio de pago del cliente", (await call("GET", `/api/v1/audit?action=payments.create&username=ana_${sfx}`, { token: tokens.manager })).json?.total >= 1);
check("quedó la confirmación de la pasarela", (await call("GET", "/api/v1/audit?action=payments.webhook&limit=20", { token: tokens.manager })).json?.data?.some((e) => e.resourceId === p.id));
check("quedó el intento con importe alterado como denied", (await call("GET", "/api/v1/audit?action=payments.webhook-amount-mismatch&limit=20", { token: tokens.manager })).json?.data?.some((e) => e.resourceId === p.id && e.outcome === "denied"));
check("quedó la reservación del cliente", (await call("GET", `/api/v1/audit?action=reservations.create&username=ana_${sfx}`, { token: tokens.manager })).json?.total >= 1);
const summary = await call("GET", "/api/v1/audit/summary", { token: tokens.manager });
check("resumen contable disponible", summary.status === 200 && summary.json?.data?.total > 0, summary.text.slice(0, 200));

const ingest = { service: "x", action: "a", resource: "r", outcome: "success" };
check("el gateway no expone la ingesta de auditoría -> 405", (await call("POST", "/api/v1/audit", { token: tokens.manager, body: ingest })).status === 405);
check("no se puede falsificar x-internal-key vía gateway -> 405", (await call("POST", "/api/v1/audit", { token: tokens.manager, headers: { "x-internal-key": INTERNAL_KEY }, body: ingest })).status === 405);
check("ingesta directa sin llave -> 401", (await call("POST", "/api/v1/audit", { base: AUDIT_DIRECT, body: ingest })).status === 401);

// ---------------------------------------------------------------- IVA

console.log("CALCULADORA DE IVA");
const calc = (token, body) => call("POST", "/api/v1/tax/calculate", { token, body });
check("agregar IVA 16 %: 100.00 -> 116.00", (await calc(tokens.cashier, { mode: "add", amountCents: 10000 })).json?.data?.totalCents === 11600);
const extracted = (await calc(tokens.manager, { mode: "extract", amountCents: 11600 })).json?.data;
check("desglosar IVA de 116.00 -> base 100.00 e IVA 16.00", extracted?.baseCents === 10000 && extracted?.ivaCents === 1600, JSON.stringify(extracted));
check("tasa fronteriza 8 %: 100.00 -> 108.00", (await calc(tokens.cashier, { mode: "add", amountCents: 10000, ratePercent: 8 })).json?.data?.totalCents === 10800);
check("tasa inventada (10 %) -> 422", (await calc(tokens.cashier, { mode: "add", amountCents: 10000, ratePercent: 10 })).status === 422);
check("monto cero -> 422", (await calc(tokens.cashier, { mode: "add", amountCents: 0 })).status === 422);
check("el mesero no usa la calculadora -> 403", (await calc(tokens.waiter, { mode: "add", amountCents: 100 })).status === 403);
check("el cliente tampoco -> 403", (await calc(ana.token, { mode: "add", amountCents: 100 })).status === 403);

const todayYmd = ymd8(new Date());
const taxReport = await call("GET", `/api/v1/tax/report?from=${todayYmd}&to=${todayYmd}`, { token: tokens.manager });
check("reporte de IVA trasladado de hoy", taxReport.status === 200, taxReport.text);
check("incluye los pedidos pagados de esta corrida (al menos 3,200 + 4,560 de IVA)", taxReport.json?.data?.ivaCents >= 7760 && taxReport.json.data.orders >= 2, JSON.stringify(taxReport.json?.data));
check("el IVA del reporte cuadra: total = subtotal + IVA", taxReport.json?.data?.totalCents === taxReport.json?.data?.subtotalCents + taxReport.json?.data?.ivaCents);
check("el desglose por día suma el total", taxReport.json?.data?.byDay?.reduce((s, d) => s + d.ivaCents, 0) === taxReport.json?.data?.ivaCents);
check("el cajero también ve el reporte", (await call("GET", `/api/v1/tax/report?from=${todayYmd}&to=${todayYmd}`, { token: tokens.cashier })).status === 200);
check("el mesero no ve el reporte -> 403", (await call("GET", `/api/v1/tax/report?from=${todayYmd}&to=${todayYmd}`, { token: tokens.waiter })).status === 403);
check("rango de más de un año -> 422", (await call("GET", "/api/v1/tax/report?from=2020-01-01&to=2022-01-01", { token: tokens.manager })).status === 422);

// ---------------------------------------------------------------- checador

console.log("CHECADOR");
const clockIn = await call("POST", "/api/v1/attendance/clock-in", { token: tokens.cook });
check("el cocinero checa su entrada -> 201", clockIn.status === 201 && clockIn.json?.data?.clockOut === null, clockIn.text);
check("la identidad de la entrada sale del token (no se puede checar por otro)", clockIn.json?.data?.userId === ids.cook && clockIn.json?.data?.source === "self");
check("el estado muestra la jornada abierta", (await call("GET", "/api/v1/attendance/me/status", { token: tokens.cook })).json?.data?.open?.id === clockIn.json?.data?.id);
check("checar entrada otra vez -> 409", (await call("POST", "/api/v1/attendance/clock-in", { token: tokens.cook })).status === 409);
check("checar salida de inmediato (doble clic) -> 409", (await call("POST", "/api/v1/attendance/clock-out", { token: tokens.cook })).status === 409);
check("sin entrada abierta no se puede checar salida -> 409", (await call("POST", "/api/v1/attendance/clock-out", { token: tokens.cashier })).status === 409);
check("el cliente no puede checar -> 403", (await call("POST", "/api/v1/attendance/clock-in", { token: ana.token })).status === 403);
check("sin token -> 401", (await call("POST", "/api/v1/attendance/clock-in")).status === 401);

check("el mesero no ve el checador de los demás -> 403", (await call("GET", "/api/v1/attendance", { token: tokens.waiter })).status === 403);
check("el mesero no corrige jornadas -> 403", (await call("PATCH", `/api/v1/attendance/${clockIn.json.data.id}`, { token: tokens.waiter, body: { note: "quiero más horas" } })).status === 403);
check("corregir sin motivo -> 422", (await call("PATCH", `/api/v1/attendance/${clockIn.json.data.id}`, { token: tokens.manager, body: { note: "" } })).status === 422);

// El gerente "retrocede" la entrada 9 h para simular un turno largo (queda marcada como corregida).
const nineHoursAgo = new Date(Date.now() - 9 * 3_600_000);
const fixed = await call("PATCH", `/api/v1/attendance/${clockIn.json.data.id}`, {
  token: tokens.manager,
  body: { clockIn: nineHoursAgo.toISOString(), note: "Humo: turno largo de prueba" },
});
check("el gerente corrige la entrada con motivo", fixed.status === 200 && fixed.json?.data?.source === "manual" && fixed.json.data.note === "Humo: turno largo de prueba", fixed.text);
check("no se puede dejar una hora en el futuro -> 422", (await call("PATCH", `/api/v1/attendance/${clockIn.json.data.id}`, { token: tokens.manager, body: { clockIn: new Date(Date.now() + 2 * 3_600_000).toISOString(), note: "futuro" } })).status === 422);
const clockOut = await call("POST", "/api/v1/attendance/clock-out", { token: tokens.cook });
check("el cocinero checa su salida: la jornada dura ~9 h", clockOut.status === 200 && clockOut.json?.data?.minutes >= 539 && clockOut.json.data.minutes <= 541, clockOut.text);

const shiftPeriod = ymd8(nineHoursAgo).slice(0, 7);
const mySummary = await call("GET", `/api/v1/attendance/me/summary?period=${shiftPeriod}`, { token: tokens.cook });
check("su resumen del mes cuenta ~9 h y 1 h extra (la jornada es de 8)", mySummary.json?.data?.hoursWorked >= 8.9 && mySummary.json.data.overtimeHours >= 0.9, mySummary.text);
const teamSummary = await call("GET", `/api/v1/attendance/summary?period=${shiftPeriod}`, { token: tokens.manager });
check("el gerente ve el resumen de todo el personal", teamSummary.json?.data?.rows?.some((r) => r.userId === ids.cook && r.overtimeHours >= 0.9), teamSummary.text.slice(0, 200));
check("el mesero no ve el resumen del equipo -> 403", (await call("GET", `/api/v1/attendance/summary?period=${shiftPeriod}`, { token: tokens.waiter })).status === 403);
check("periodo mal escrito -> 422", (await call("GET", "/api/v1/attendance/summary?period=2030-13", { token: tokens.manager })).status === 422);

// Traslapes: dos jornadas de la misma persona no pueden empalmarse.
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const shiftOf = (inH, outH, note) => ({ userId: ids.waiter, username: `waiter_${sfx}`, clockIn: hoursAgo(inH), clockOut: hoursAgo(outH), note });
const first = await call("POST", "/api/v1/attendance/manual", { token: tokens.manager, body: shiftOf(4, 3, "Humo: jornada A") });
check("el gerente captura una jornada pasada a mano", first.status === 201 && first.json?.data?.source === "manual", first.text);
const overlap = await call("POST", "/api/v1/attendance/manual", { token: tokens.manager, body: shiftOf(3.5, 2.5, "Humo: traslape") });
check("una jornada capturada a mano que se traslapa con otra -> 409", overlap.status === 409, overlap.text);
check("una jornada contigua (empieza justo cuando termina la otra) sí se acepta", (await call("POST", "/api/v1/attendance/manual", { token: tokens.manager, body: shiftOf(3, 2, "Humo: contigua") })).status === 201);
check("el mesero ve solo lo suyo en su historial", (await call("GET", "/api/v1/attendance/me", { token: tokens.waiter })).json?.data?.every((r) => r.userId === ids.waiter));

const ATTENDANCE_DIRECT = `http://localhost:${port("services/attendance/.env", 3009)}`;
check("el resumen interno exige la llave interna -> 401", (await call("GET", `/api/v1/internal/summary?period=${shiftPeriod}&userId=${ids.cook}`, { base: ATTENDANCE_DIRECT })).status === 401);
check("el resumen interno con llave funciona", (await call("GET", `/api/v1/internal/summary?period=${shiftPeriod}&userId=${ids.cook}&since=${shiftPeriod}-01`, { base: ATTENDANCE_DIRECT, headers: internal })).json?.data?.overtimeHours >= 0.9);
check("el gateway no publica el resumen interno (404)", (await call("GET", `/api/v1/internal/summary?period=${shiftPeriod}&userId=${ids.cook}`, { token: admin })).status === 404);

// ---------------------------------------------------------------- nómina con el motor externo (SistemaNomina)

console.log("NÓMINA (motor externo SistemaNomina, sin modificar)");
const engine = await call("GET", "/api/v1/payroll/engine", { token: tokens.manager });
check("el gerente ve el estado del motor externo", engine.status === 200, engine.text);
check("el mesero no ve la nómina ni sueldos -> 403", (await call("GET", "/api/v1/payroll/compensations", { token: tokens.waiter })).status === 403);
check("el cliente no entra a la nómina -> 403", (await call("GET", "/api/v1/payroll/me", { token: ana.token })).status === 403);

if (!engine.json?.data?.available) {
  check("el motor de nómina externo está disponible (npm run setup:nomina y npm start)", false, "no responde en 127.0.0.1:3102-3104");
} else {
  // Periodo antiguo y único por corrida: no mezcla datos de prueba con la nómina real del mes en curso.
  const n = Math.floor(Date.now() / 1000) % 360;
  const payPeriod = `${1990 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
  const [py, pm] = payPeriod.split("-").map(Number);
  const lastDayNum = new Date(py, pm, 0).getDate();
  const payDay = `${payPeriod}-${String(lastDayNum).padStart(2, "0")}`;
  const at = (h) => new Date(py, pm - 1, lastDayNum, h, 0, 0).toISOString();

  const salary = { fullName: `Cocinero Humo ${sfx}`, position: "Cocinero", monthlySalaryCents: 1_200_000, hireDate: payDay, active: true };
  check("el mesero no captura sueldos -> 403", (await call("PUT", `/api/v1/payroll/compensations/${ids.cook}`, { token: tokens.waiter, body: salary })).status === 403);
  check("sueldo absurdo -> 422", (await call("PUT", `/api/v1/payroll/compensations/${ids.cook}`, { token: tokens.manager, body: { ...salary, monthlySalaryCents: 5 } })).status === 422);
  check("fecha de ingreso imposible (31 de febrero) -> 422", (await call("PUT", `/api/v1/payroll/compensations/${ids.cook}`, { token: tokens.manager, body: { ...salary, hireDate: "2030-02-31" } })).status === 422);
  check("el gerente captura el sueldo", (await call("PUT", `/api/v1/payroll/compensations/${ids.cook}`, { token: tokens.manager, body: salary })).status === 200);

  const shift = await call("POST", "/api/v1/attendance/manual", {
    token: tokens.manager,
    body: { userId: ids.cook, username: `cook_${sfx}`, clockIn: at(9), clockOut: at(19), note: "Humo: jornada de 10 h para la nómina" },
  });
  check("el gerente captura la jornada de 10 h del periodo de prueba", shift.status === 201, shift.text);

  check("el mesero no calcula nómina -> 403", (await call("POST", "/api/v1/payroll/runs", { token: tokens.waiter, body: { period: payPeriod } })).status === 403);
  check("no se calcula un mes futuro -> 422", (await call("POST", "/api/v1/payroll/runs", { token: tokens.manager, body: { period: "2099-01" } })).status === 422);

  const run = await call("POST", "/api/v1/payroll/runs", { token: tokens.manager, body: { period: payPeriod } });
  check("el gerente calcula la nómina del periodo con el motor externo", run.status === 200 && run.json?.data?.status === "calculated", run.text);
  const line = run.json?.data?.lines?.find((l) => l.userId === ids.cook);
  check("la línea trae las horas extra del checador: 2 h × $50 × 2 = $200.00", line?.overtimeHours === 2 && line?.overtimePayCents === 20000, JSON.stringify(line));
  check("la base gravable es sueldo + extras - faltas = $12,200.00", line?.taxableCents === 1_220_000 && line?.absenceDays === 0, JSON.stringify(line));
  check("el motor calculó impuestos (ISR, IMSS e Infonavit)", line?.isrCents > 0 && line?.imssCents > 0 && line?.infonavitCents > 0, JSON.stringify(line));
  check("el neto = base - ISR - IMSS - Infonavit + subsidio (cuadra al centavo, ±1)", Math.abs(line?.netPayCents - (line.taxableCents - line.isrCents - line.imssCents - line.infonavitCents + line.subsidioCents)) <= 1, JSON.stringify(line));
  check("solo entra el personal con sueldo registrado en ese periodo", run.json?.data?.lines?.length === 1, String(run.json?.data?.lines?.length));
  check("el sueldo quedó dado de alta en el motor", (await call("GET", "/api/v1/payroll/compensations", { token: tokens.manager })).json?.data?.find((c) => c.userId === ids.cook)?.synced === true);

  // Recalcular NO duplica las incidencias en el motor externo.
  const again = await call("POST", "/api/v1/payroll/runs", { token: tokens.manager, body: { period: payPeriod } });
  check("recalcular el mismo periodo funciona", again.status === 200 && again.json?.data?.lines?.length === 1, again.text);
  const extIncidents = await call("GET", "/incidents", { base: "http://127.0.0.1:3104" });
  const mine = (extIncidents.json ?? []).filter((i) => i.period === payPeriod);
  check("tras recalcular, el motor externo tiene UNA sola incidencia de horas extra del periodo (no se duplica)", mine.filter((i) => i.type === "OVERTIME").length === 1, JSON.stringify(mine));

  check("el gerente NO puede aprobar (solo el administrador) -> 403", (await call("POST", `/api/v1/payroll/runs/${payPeriod}/approve`, { token: tokens.manager })).status === 403);
  check("aprobar un periodo mal escrito -> 422", (await call("POST", "/api/v1/payroll/runs/2030-99/approve", { token: admin })).status === 422);
  check("el cocinero aún no ve recibo: la nómina no está aprobada", !(await call("GET", "/api/v1/payroll/me", { token: tokens.cook })).json?.data?.some((p) => p.period === payPeriod));
  const approved = await call("POST", `/api/v1/payroll/runs/${payPeriod}/approve`, { token: admin });
  check("el administrador aprueba la nómina", approved.status === 200 && approved.json?.data?.status === "approved" && !!approved.json.data.approvedAt, approved.text);
  check("aprobar otra vez -> 409", (await call("POST", `/api/v1/payroll/runs/${payPeriod}/approve`, { token: admin })).status === 409);
  check("una nómina aprobada ya no se recalcula -> 409", (await call("POST", "/api/v1/payroll/runs", { token: tokens.manager, body: { period: payPeriod } })).status === 409);

  const slips = await call("GET", "/api/v1/payroll/me", { token: tokens.cook });
  check("el cocinero ya ve SU recibo aprobado con su neto", slips.json?.data?.some((p) => p.period === payPeriod && p.netPayCents === line.netPayCents), slips.text);
  check("el mesero NO ve el recibo del cocinero", !(await call("GET", "/api/v1/payroll/me", { token: tokens.waiter })).json?.data?.some((p) => p.period === payPeriod));
  check("el gerente consulta la nómina completa del periodo", (await call("GET", `/api/v1/payroll/runs/${payPeriod}`, { token: tokens.manager })).json?.data?.lines?.length === 1);

  // Se desactiva el sueldo de prueba: así NO entra en ninguna nómina real.
  await call("PUT", `/api/v1/payroll/compensations/${ids.cook}`, { token: tokens.manager, body: { ...salary, active: false } });
}

// ---------------------------------------------------------------- limpieza

// El segundo pedido en línea se cierra (entrega y cobro en mostrador) para no dejar pedidos activos.
await move(online2.id, tokens.waiter, "served");
await move(online2.id, tokens.cashier, "paid", { paymentMethod: "cash" });
await call("DELETE", "/api/v1/customers/me/telegram", { token: ana.token });
for (const id of [d1, d2]) await call("DELETE", `/api/v1/dishes/${id}`, { token: tokens.manager });
await call("DELETE", `/api/v1/tables/${t}`, { token: tokens.manager });

console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
