import { z } from "zod";
import { PAYMENT_METHODS } from "./order.contracts.js";

/** Tasas de IVA vigentes en México: general, franja fronteriza y tasa 0 (p. ej. alimentos no preparados). */
export const IVA_RATES = [
  { percent: 16, label: "General (16 %)" },
  { percent: 8, label: "Región fronteriza (8 %)" },
  { percent: 0, label: "Tasa 0 %" },
] as const;
export type IvaPercent = (typeof IVA_RATES)[number]["percent"];

/** Tope por operación: evita desbordes y capturas absurdas (10 millones de pesos). */
export const MAX_TAX_AMOUNT_CENTS = 1_000_000_000;

/**
 * Calculadora de IVA.
 *  - add:     el monto es el SUBTOTAL (sin IVA); se le suma el impuesto.
 *  - extract: el monto es el TOTAL (con IVA incluido); se desglosa la base y el impuesto.
 */
export const taxCalculateSchema = z.object({
  mode: z.enum(["add", "extract"]),
  amountCents: z.number().int().positive().max(MAX_TAX_AMOUNT_CENTS),
  ratePercent: z
    .number()
    .refine((r) => IVA_RATES.some((x) => x.percent === r), "Tasa no válida (16, 8 o 0)")
    .default(16),
});
export type TaxCalculateInput = z.infer<typeof taxCalculateSchema>;

export interface TaxCalculationDTO {
  mode: "add" | "extract";
  ratePercent: number;
  baseCents: number;
  ivaCents: number;
  totalCents: number;
}

/** Fechas AAAA-MM-DD (rango incluyente). */
export const taxReportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD"),
});
export type TaxReportQuery = z.infer<typeof taxReportQuerySchema>;

export interface TaxBucketDTO {
  orders: number;
  subtotalCents: number;
  ivaCents: number;
  totalCents: number;
}

/** IVA trasladado: lo cobrado en pedidos PAGADOS dentro del rango (por fecha de pago). */
export interface TaxReportDTO extends TaxBucketDTO {
  from: string;
  to: string;
  byPaymentMethod: ({ method: (typeof PAYMENT_METHODS)[number] } & TaxBucketDTO)[];
  byDay: ({ date: string } & TaxBucketDTO)[];
}
