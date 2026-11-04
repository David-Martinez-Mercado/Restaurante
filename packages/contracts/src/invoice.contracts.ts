import { z } from "zod";

/**
 * Facturación electrónica (CFDI 4.0) con el PAC Profact.
 *  pending   = se está timbrando ahora mismo
 *  issued    = timbrada: tiene UUID y XML del SAT
 *  cancelled = cancelada ante el SAT
 *  rejected  = el PAC o el SAT la rechazaron (no existe como factura; se puede intentar de nuevo)
 */
export const INVOICE_STATUSES = ["pending", "issued", "cancelled", "rejected"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Motivos de cancelación del SAT: 01 con relación (exige factura sustituta), 02 con errores sin relación, 03 no se llevó a cabo, 04 global. */
export const CANCEL_REASONS = ["01", "02", "03", "04"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const issueInvoiceSchema = z.object({ orderId: z.string().uuid() });
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

export const cancelInvoiceSchema = z
  .object({
    reason: z.enum(CANCEL_REASONS),
    /** Solo con el motivo 01: la factura (ya emitida) que sustituye a esta. */
    replacementInvoiceId: z.string().uuid().optional(),
  })
  .refine((v) => v.reason !== "01" || !!v.replacementInvoiceId, {
    message: "El motivo 01 exige indicar la factura que la sustituye",
    path: ["replacementInvoiceId"],
  });
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;

export interface InvoiceConceptDTO {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  /** IVA trasladado de este concepto (la suma de todos es el IVA del pedido). */
  taxCents: number;
}

export interface InvoiceDTO {
  id: string;
  orderId: string;
  orderCode: string;
  serie: string;
  folio: number;
  status: InvoiceStatus;
  receptor: { rfc: string; name: string; postalCode: string; taxRegime: string; cfdiUse: string };
  concepts: InvoiceConceptDTO[];
  subtotalCents: number;
  ivaCents: number;
  totalCents: number;
  /** Clave SAT de la forma de pago (01 efectivo, 04 tarjeta de crédito...). */
  paymentForm: string;
  /** Folio fiscal (UUID del SAT); null mientras no esté timbrada. */
  uuid: string | null;
  stampedAt: string | null;
  /** Por qué se rechazó (mensaje del PAC/SAT). */
  errorMessage: string | null;
  cancelledAt: string | null;
  cancelReason: CancelReason | null;
  cancelMessage: string | null;
  createdAt: string;
}

/** Detalle para la representación impresa: añade al emisor, los sellos y el QR. */
export interface InvoiceDetailDTO extends InvoiceDTO {
  emisor: { rfc: string; name: string; taxRegime: string; postalCode: string };
  selloCfd: string | null;
  selloSat: string | null;
  noCertificadoSat: string | null;
  cadenaOriginal: string | null;
  /** Imagen JPEG del código QR, en base64. */
  qrBase64: string | null;
}
