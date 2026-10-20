import { describe, expect, it } from "vitest";
import { buildChargeRequest, nextStatus, signBody, verifySignature } from "../domain/payment.js";

const SECRET = "secreto-compartido-del-webhook-123";
const body = Buffer.from(JSON.stringify({ eventId: "evt_1", type: "payment.succeeded" }));

describe("firma del webhook (HMAC-SHA256)", () => {
  it("la firma tiene el formato sha256=<hex de 64>", () => {
    expect(signBody(SECRET, body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("acepta la firma correcta", () => {
    expect(verifySignature(SECRET, body, signBody(SECRET, body))).toBe(true);
  });

  it("rechaza si cambia un solo byte del cuerpo, otro secreto o un encabezado ausente/mal formado", () => {
    const sig = signBody(SECRET, body);
    expect(verifySignature(SECRET, Buffer.from(body.toString().replace("evt_1", "evt_2")), sig)).toBe(false);
    expect(verifySignature("otro-secreto-distinto-123456", body, sig)).toBe(false);
    expect(verifySignature(SECRET, body, undefined)).toBe(false);
    expect(verifySignature(SECRET, body, "")).toBe(false);
    expect(verifySignature(SECRET, body, "sha256=abc")).toBe(false);
    expect(verifySignature(SECRET, body, sig.replace("sha256=", ""))).toBe(false);
    expect(verifySignature(SECRET, undefined, sig)).toBe(false);
  });

  it("la firma depende de los bytes exactos, no del JSON equivalente", () => {
    const spaced = Buffer.from(JSON.stringify({ eventId: "evt_1", type: "payment.succeeded" }, null, 2));
    expect(signBody(SECRET, spaced)).not.toBe(signBody(SECRET, body));
  });
});

describe("nextStatus", () => {
  it("un pago pendiente pasa a pagado, fallido o vencido según el aviso", () => {
    expect(nextStatus("pending", "payment.succeeded")).toBe("paid");
    expect(nextStatus("pending", "payment.failed")).toBe("failed");
    expect(nextStatus("pending", "payment.expired")).toBe("expired");
  });

  it("un pago ya pagado es final: ningún aviso lo cambia", () => {
    expect(nextStatus("paid", "payment.failed")).toBeNull();
    expect(nextStatus("paid", "payment.expired")).toBeNull();
    expect(nextStatus("paid", "payment.succeeded")).toBeNull();
  });

  it("un pago tardío sobre uno fallido o vencido sí se acepta (el dinero ya se cobró)", () => {
    expect(nextStatus("failed", "payment.succeeded")).toBe("paid");
    expect(nextStatus("expired", "payment.succeeded")).toBe("paid");
  });

  it("fallido o vencido no cambian entre sí", () => {
    expect(nextStatus("failed", "payment.expired")).toBeNull();
    expect(nextStatus("expired", "payment.failed")).toBeNull();
  });
});

describe("buildChargeRequest", () => {
  const order = {
    code: "A-0042",
    customerName: "Ana López",
    taxCents: 17280,
    totalCents: 125280,
    items: [
      { id: "i1", dishId: "d1", dishName: "Ribeye 300 g", unitPriceCents: 54000, quantity: 2, lineTotalCents: 108000 },
    ],
  };
  const urls = { publicApiUrl: "http://localhost:3000/", webUrl: "http://localhost:5173/" };

  it("manda la referencia, el importe en centavos MXN y las URLs de regreso y de aviso", () => {
    const r = buildChargeRequest("pay-1", order, "user-1", urls);
    expect(r).toMatchObject({
      reference: "pay-1",
      amountCents: 125280,
      currency: "MXN",
      description: "Pedido A-0042 · Asador La Brasa",
      customer: { id: "user-1", name: "Ana López" },
      returnUrl: "http://localhost:5173/portal?payment=pay-1",
      webhookUrl: "http://localhost:3000/api/v1/payments/webhook",
    });
  });

  it("las líneas suman exactamente el total (el IVA va como una línea más)", () => {
    const r = buildChargeRequest("pay-1", order, "user-1", urls);
    const sum = r.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
    expect(sum).toBe(r.amountCents);
    expect(r.items.at(-1)).toEqual({ name: "IVA", quantity: 1, unitPriceCents: 17280 });
  });

  it("sin IVA no agrega la línea, y sin nombre usa 'Cliente'", () => {
    const r = buildChargeRequest("p", { ...order, taxCents: 0, totalCents: 108000, customerName: null }, "u", urls);
    expect(r.items).toHaveLength(1);
    expect(r.customer.name).toBe("Cliente");
  });
});
