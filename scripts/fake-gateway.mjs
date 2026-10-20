// Pasarela de pago FALSA, solo para probar el lado del restaurante de punta a punta.
// Cumple el contrato de docs/CONTRATO-PASARELA-DE-PAGO.md: recibe POST /v1/charges,
// ofrece una página de pago con botones y, al elegir, envía el webhook FIRMADO al restaurante.
// No procesa tarjetas ni guarda nada: todo vive en memoria.
//
// Uso:  node scripts/fake-gateway.mjs
//       y en services/payment/.env:  PAYMENT_GATEWAY_URL=http://localhost:4100
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "services", "payment", ".env");
const SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET ??
  (existsSync(envFile) ? readFileSync(envFile, "utf8").match(/^PAYMENT_WEBHOOK_SECRET=(.*)$/m)?.[1].trim() : "");
const PORT = Number(process.env.FAKE_GATEWAY_PORT ?? 4100);

if (!SECRET) {
  console.error("No encontré PAYMENT_WEBHOOK_SECRET (services/payment/.env). Ejecuta primero: npm run setup");
  process.exit(1);
}

const charges = new Map(); // gatewayReference -> { request, status }
const money = (cents) => (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Envía el webhook firmado al restaurante, igual que lo haría la pasarela real. */
async function notify(charge, type, extra = {}) {
  const event = {
    eventId: `evt_${randomUUID()}`,
    type,
    reference: charge.request.reference,
    gatewayReference: charge.gatewayReference,
    amountCents: charge.request.amountCents,
    currency: "MXN",
    ...extra,
  };
  const body = JSON.stringify(event);
  const signature = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  const res = await fetch(charge.request.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature },
    body,
  });
  console.log(`webhook ${type} -> ${res.status} ${await res.text()}`);
  return res.ok;
}

const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px system-ui;max-width:460px;margin:40px auto;padding:0 16px}li{display:flex;justify-content:space-between}
ul{list-style:none;padding:0}button{padding:10px 16px;margin:4px 4px 0 0;font:inherit;cursor:pointer}.t{font-size:1.6rem;font-weight:700}
.note{background:#fef3c7;padding:8px 12px;border-radius:8px;font-size:.85rem}</style>${body}`;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // (1) El restaurante pide un cobro.
  if (req.method === "POST" && url.pathname === "/v1/charges") {
    const request = JSON.parse((await readBody(req)) || "{}");
    const gatewayReference = `gw_${randomUUID().slice(0, 8)}`;
    charges.set(gatewayReference, { request, gatewayReference, status: "pending" });
    console.log(`cobro ${gatewayReference}: ${money(request.amountCents)} (${request.description})`);
    res.writeHead(201, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        gatewayReference,
        checkoutUrl: `http://localhost:${PORT}/checkout/${gatewayReference}`,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      })
    );
    return;
  }

  // Página de pago de mentira.
  const checkout = url.pathname.match(/^\/checkout\/(gw_\w+)$/);
  if (req.method === "GET" && checkout) {
    const charge = charges.get(checkout[1]);
    if (!charge) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(page("No encontrado", "<p>Cobro desconocido (¿se reinició la pasarela falsa?).</p>"));
      return;
    }
    const { request } = charge;
    const lines = request.items.map((i) => `<li><span>${i.quantity} × ${esc(i.name)}</span><span>${money(i.quantity * i.unitPriceCents)}</span></li>`).join("");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      page(
        "Pasarela de prueba",
        `<h2>Pasarela de pago (simulada)</h2><p class="note">Esto es una pasarela falsa para pruebas. No se pide ninguna tarjeta.</p>
<p>${esc(request.description)}</p><ul>${lines}</ul><p class="t">${money(request.amountCents)}</p>
<form method="post" action="/checkout/${charge.gatewayReference}/pay"><button name="r" value="ok">Pagar</button>
<button name="r" value="fail">Rechazar tarjeta</button><button name="r" value="expire">Dejar vencer</button></form>`
      )
    );
    return;
  }

  // El "cliente" eligió un resultado: se avisa al restaurante y se le regresa a su portal.
  const pay = url.pathname.match(/^\/checkout\/(gw_\w+)\/pay$/);
  if (req.method === "POST" && pay) {
    const charge = charges.get(pay[1]);
    const choice = new URLSearchParams(await readBody(req)).get("r");
    if (!charge) {
      res.writeHead(404).end();
      return;
    }
    if (choice === "ok") await notify(charge, "payment.succeeded", { method: "card", paidAt: new Date().toISOString() });
    else if (choice === "fail") await notify(charge, "payment.failed", { failureReason: "Tarjeta rechazada (simulado)" });
    else await notify(charge, "payment.expired");
    res.writeHead(303, { location: charge.request.returnUrl });
    res.end();
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
}).listen(PORT, () => {
  console.log(`Pasarela FALSA escuchando en http://localhost:${PORT}`);
  console.log("Pon PAYMENT_GATEWAY_URL=http://localhost:" + PORT + " en services/payment/.env y reinicia el Payment Service.");
});
