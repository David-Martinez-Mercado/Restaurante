import type { PaymentMethod, TaxBucketDTO, TaxCalculationDTO, TaxReportDTO } from "@resto/contracts";

/** IVA general de México. Los precios del menú se guardan SIN impuesto. */
export const GENERAL_IVA_PERCENT = 16;

/**
 * Todo en centavos enteros y con aritmética entera: nada de 0.1 + 0.2.
 * El redondeo es al centavo más cercano (mitades hacia arriba).
 */

/** Al SUBTOTAL se le suma el IVA. */
export function addIva(baseCents: number, ratePercent: number): TaxCalculationDTO {
  const ivaCents = Math.round((baseCents * ratePercent) / 100);
  return { mode: "add", ratePercent, baseCents, ivaCents, totalCents: baseCents + ivaCents };
}

/** Del TOTAL (IVA incluido) se desglosa la base y el impuesto. La base + el IVA suman siempre el total. */
export function extractIva(totalCents: number, ratePercent: number): TaxCalculationDTO {
  const baseCents = Math.round((totalCents * 100) / (100 + ratePercent));
  return { mode: "extract", ratePercent, baseCents, ivaCents: totalCents - baseCents, totalCents };
}

export interface PaidOrderRow {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  paidAt: Date;
}

const empty = (): TaxBucketDTO => ({ orders: 0, subtotalCents: 0, ivaCents: 0, totalCents: 0 });

function add(bucket: TaxBucketDTO, row: PaidOrderRow): void {
  bucket.orders += 1;
  bucket.subtotalCents += row.subtotalCents;
  bucket.ivaCents += row.taxCents;
  bucket.totalCents += row.totalCents;
}

/** AAAA-MM-DD en hora local del servidor (la misma que usan las reglas de horario). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Inicio del día local de una fecha AAAA-MM-DD. */
export function startOfLocalDay(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** IVA trasladado en pedidos pagados: total, por método de pago y por día. */
export function buildTaxReport(from: string, to: string, rows: PaidOrderRow[]): TaxReportDTO {
  const total = empty();
  const methods = new Map<string, TaxBucketDTO>();
  const days = new Map<string, TaxBucketDTO>();

  for (const row of rows) {
    add(total, row);
    const method = row.paymentMethod ?? "cash";
    add(methods.get(method) ?? methods.set(method, empty()).get(method)!, row);
    const day = localDay(row.paidAt);
    add(days.get(day) ?? days.set(day, empty()).get(day)!, row);
  }

  return {
    from,
    to,
    ...total,
    byPaymentMethod: [...methods.entries()].map(([method, b]) => ({ method: method as PaymentMethod, ...b })),
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, b]) => ({ date, ...b })),
  };
}
