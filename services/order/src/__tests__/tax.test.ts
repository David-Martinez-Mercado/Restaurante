import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";

vi.mock("../repositories/order.repository.js", () => ({
  orderRepository: { findPaidBetween: vi.fn() },
}));

const { addIva, extractIva, buildTaxReport, localDay } = await import("../domain/tax.js");
const { computeTotals } = await import("../domain/orderRules.js");
const { orderRepository } = await import("../repositories/order.repository.js");
const { taxService } = await import("../services/tax.service.js");

describe("addIva · del subtotal al total", () => {
  it("16 %: 100.00 -> IVA 16.00, total 116.00", () => {
    expect(addIva(10000, 16)).toEqual({ mode: "add", ratePercent: 16, baseCents: 10000, ivaCents: 1600, totalCents: 11600 });
  });

  it("8 % (frontera) y 0 %", () => {
    expect(addIva(10000, 8)).toMatchObject({ ivaCents: 800, totalCents: 10800 });
    expect(addIva(10000, 0)).toMatchObject({ ivaCents: 0, totalCents: 10000 });
  });

  it("redondea al centavo y el total siempre es base + IVA", () => {
    const r = addIva(999, 16); // 159.84 -> 160
    expect(r.ivaCents).toBe(160);
    expect(r.totalCents).toBe(r.baseCents + r.ivaCents);
  });

  it("es la MISMA fórmula que usan los pedidos (no hay dos IVA distintos)", () => {
    for (const subtotal of [1, 99, 999, 12345, 98765, 1_000_000]) {
      expect(computeTotals([{ unitPriceCents: subtotal, quantity: 1 }]).taxCents).toBe(addIva(subtotal, 16).ivaCents);
    }
  });
});

describe("extractIva · del total (IVA incluido) a la base", () => {
  it("116.00 con 16 % -> base 100.00, IVA 16.00", () => {
    expect(extractIva(11600, 16)).toEqual({ mode: "extract", ratePercent: 16, baseCents: 10000, ivaCents: 1600, totalCents: 11600 });
  });

  it("base + IVA siempre suman exactamente el total, sin descuadres de centavos", () => {
    for (const total of [1, 7, 99, 1160, 33333, 99999, 123457]) {
      for (const rate of [16, 8, 0]) {
        const r = extractIva(total, rate);
        expect(r.baseCents + r.ivaCents).toBe(total);
        expect(r.ivaCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("extraer y volver a sumar recupera el total (ida y vuelta)", () => {
    for (const total of [11600, 23200, 33060]) {
      const { baseCents } = extractIva(total, 16);
      expect(addIva(baseCents, 16).totalCents).toBe(total);
    }
  });

  it("tasa 0 %: todo es base", () => {
    expect(extractIva(5000, 0)).toMatchObject({ baseCents: 5000, ivaCents: 0 });
  });
});

describe("buildTaxReport", () => {
  const at = (d: number, h = 14) => new Date(2030, 5, d, h, 0, 0);
  const rows = [
    { subtotalCents: 10000, taxCents: 1600, totalCents: 11600, paymentMethod: "cash" as const, paidAt: at(3) },
    { subtotalCents: 20000, taxCents: 3200, totalCents: 23200, paymentMethod: "card" as const, paidAt: at(3, 21) },
    { subtotalCents: 5000, taxCents: 800, totalCents: 5800, paymentMethod: "online" as const, paidAt: at(4) },
    { subtotalCents: 1000, taxCents: 160, totalCents: 1160, paymentMethod: "cash" as const, paidAt: at(4) },
  ];

  it("suma el total, por método de pago y por día", () => {
    const r = buildTaxReport("2030-06-03", "2030-06-04", rows);
    expect(r).toMatchObject({ orders: 4, subtotalCents: 36000, ivaCents: 5760, totalCents: 41760 });
    expect(r.byPaymentMethod.find((m) => m.method === "cash")).toMatchObject({ orders: 2, ivaCents: 1760 });
    expect(r.byPaymentMethod.find((m) => m.method === "online")).toMatchObject({ orders: 1, ivaCents: 800 });
    expect(r.byDay.map((d) => [d.date, d.orders, d.ivaCents])).toEqual([
      ["2030-06-03", 2, 4800],
      ["2030-06-04", 2, 960],
    ]);
  });

  it("los totales por día y por método cuadran con el total", () => {
    const r = buildTaxReport("2030-06-03", "2030-06-04", rows);
    expect(r.byDay.reduce((s, d) => s + d.ivaCents, 0)).toBe(r.ivaCents);
    expect(r.byPaymentMethod.reduce((s, m) => s + m.totalCents, 0)).toBe(r.totalCents);
  });

  it("sin ventas devuelve ceros", () => {
    expect(buildTaxReport("2030-06-03", "2030-06-04", [])).toMatchObject({ orders: 0, ivaCents: 0, byDay: [], byPaymentMethod: [] });
  });

  it("localDay usa la fecha local", () => {
    expect(localDay(new Date(2030, 0, 5, 23, 59))).toBe("2030-01-05");
  });
});

describe("taxService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calcula en ambos sentidos", () => {
    expect(taxService.calculate({ mode: "add", amountCents: 10000, ratePercent: 16 }).totalCents).toBe(11600);
    expect(taxService.calculate({ mode: "extract", amountCents: 11600, ratePercent: 16 }).ivaCents).toBe(1600);
  });

  it("el reporte es incluyente en la fecha final (consulta hasta el inicio del día siguiente)", async () => {
    vi.mocked(orderRepository.findPaidBetween).mockResolvedValue([]);
    await taxService.report("2030-06-03", "2030-06-04");
    expect(orderRepository.findPaidBetween).toHaveBeenCalledWith(new Date(2030, 5, 3), new Date(2030, 5, 5));
  });

  it("rechaza fechas inválidas, rangos invertidos y rangos de más de un año (422)", async () => {
    await expect(taxService.report("2030-13-45", "2030-06-04")).rejects.toMatchObject({ statusCode: 422 });
    await expect(taxService.report("2030-06-04", "2030-06-03")).rejects.toMatchObject({ statusCode: 422 });
    await expect(taxService.report("2030-01-01", "2031-06-01")).rejects.toMatchObject({ statusCode: 422 });
    expect(orderRepository.findPaidBetween).not.toHaveBeenCalled();
  });

  it("acepta exactamente un año bisiesto completo (366 días)", async () => {
    vi.mocked(orderRepository.findPaidBetween).mockResolvedValue([]);
    await expect(taxService.report("2032-01-01", "2032-12-31")).resolves.toBeTruthy();
  });
});
