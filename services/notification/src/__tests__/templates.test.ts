import { describe, expect, it } from "vitest";
import type { NotificationEvent } from "@resto/contracts";
import {
  dedupeKey,
  escapeHtml,
  formatMoney,
  formatTime,
  paymentLabel,
  renderMessage,
  toTelegramHtml,
} from "../domain/templates.js";

const TZ = "America/Mexico_City";
const ctx = { timeZone: TZ, now: new Date("2030-06-04T01:40:00Z") }; // 19:40 en CDMX (UTC-6)
const ORDER = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const RES = "33333333-3333-4333-8333-333333333333";

const reservation = {
  reservationId: RES, code: "ABC234", customerName: "Ana López", partySize: 4,
  reservedFor: "2030-06-04T02:00:00Z", // 20:00 en CDMX
};

describe("formatos", () => {
  it("el dinero sale en pesos desde centavos", () => {
    expect(formatMoney(123450)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("la hora se muestra en 24 h en la zona del restaurante, no en la del servidor", () => {
    expect(formatTime("2030-06-04T02:00:00Z", TZ)).toBe("20:00");
    expect(formatTime("2030-06-04T19:30:00Z", TZ)).toBe("13:30");
  });

  it("etiquetas de método de pago", () => {
    expect(paymentLabel("cash")).toBe("Efectivo");
    expect(paymentLabel("card")).toBe("Tarjeta");
    expect(paymentLabel("online")).toBe("Pago en línea");
  });
});

describe("renderMessage", () => {
  it("pedido listo", () => {
    const m = renderMessage({ type: "order.ready", orderId: ORDER, orderCode: "A-0042", customerUserId: USER }, ctx);
    expect(m.title).toContain("listo");
    expect(m.body).toContain("A-0042");
  });

  it("consumo: descripción de cada platillo, importes, método de pago y la pregunta de facturar", () => {
    const m = renderMessage(
      {
        type: "order.paid", orderId: ORDER, orderCode: "A-0042", customerUserId: USER,
        items: [
          { name: "Ribeye 300 g", quantity: 2, lineTotalCents: 108000 },
          { name: "Cerveza", quantity: 1, lineTotalCents: 6000 },
        ],
        subtotalCents: 114000, taxCents: 18240, totalCents: 132240, paymentMethod: "card", channel: "dine_in",
      },
      ctx
    );

    expect(m.title).toContain("A-0042");
    expect(m.body).toContain("2 × Ribeye 300 g — $1,080.00");
    expect(m.body).toContain("1 × Cerveza — $60.00");
    expect(m.body).toContain("Subtotal: $1,140.00");
    expect(m.body).toContain("IVA: $182.40");
    expect(m.body).toContain("Total: $1,322.40");
    expect(m.body).toContain("Método de pago: Tarjeta");
    expect(m.body).toContain("¿Vas a facturar?");
  });

  it("pago en línea confirmado", () => {
    const m = renderMessage({ type: "payment.confirmed", orderId: ORDER, orderCode: "A-0042", customerUserId: USER, amountCents: 50000 }, ctx);
    expect(m.body).toContain("$500.00");
    expect(m.body).toContain("A-0042");
  });

  it("reservación confirmada incluye el localizador, el grupo y la HORA DE LLEGADA", () => {
    const m = renderMessage({ type: "reservation.confirmed", ...reservation }, ctx);
    expect(m.body).toContain("ABC234");
    expect(m.body).toContain("4 personas");
    expect(m.body).toContain("20:00");
    expect(m.body).toContain("1 hora antes");
  });

  it("recordatorio: dice cuántos minutos faltan", () => {
    const m = renderMessage({ type: "reservation.reminder", ...reservation }, ctx);
    expect(m.title).toContain("unos minutos");
    expect(m.body).toContain("20:00");
    expect(m.body).toContain("en unos 20 min");
  });

  it("cancelación y singular de 'persona'", () => {
    expect(renderMessage({ type: "reservation.cancelled", ...reservation }, ctx).title).toBe("Reservación cancelada");
    expect(renderMessage({ type: "reservation.confirmed", ...reservation, partySize: 1 }, ctx).body).toContain("1 persona:");
  });
});

describe("Telegram HTML", () => {
  it("escapa lo que escribe el usuario para que no rompa el formato", () => {
    expect(escapeHtml("<b>Tacos</b> & más")).toBe("&lt;b&gt;Tacos&lt;/b&gt; &amp; más");
    expect(toTelegramHtml({ title: "T <1>", body: "a & b" })).toBe("<b>T &lt;1&gt;</b>\na &amp; b");
  });
});

describe("dedupeKey", () => {
  it("identifica el aviso por tipo, entidad y canal", () => {
    const ready: NotificationEvent = { type: "order.ready", orderId: ORDER, orderCode: "A-1", customerUserId: USER };
    const remind: NotificationEvent = { type: "reservation.reminder", ...reservation };
    expect(dedupeKey(ready, "in_app")).toBe(`order.ready:${ORDER}:in_app`);
    expect(dedupeKey(remind, "telegram")).toBe(`reservation.reminder:${RES}:telegram`);
    expect(dedupeKey(ready, "telegram")).not.toBe(dedupeKey(ready, "in_app"));
  });
});
