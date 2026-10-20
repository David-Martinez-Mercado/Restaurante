import { z } from "zod";

/** Datos fiscales del cliente para una futura factura (CFDI). Todos opcionales como conjunto. */
export const billingSchema = z.object({
  rfc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "RFC inválido (12 o 13 caracteres)"),
  businessName: z.string().trim().min(2, "Indica el nombre o razón social").max(150),
  postalCode: z.string().trim().regex(/^\d{5}$/, "El código postal fiscal debe tener 5 dígitos"),
  taxRegime: z.string().trim().regex(/^\d{3}$/, "Clave de régimen fiscal de 3 dígitos (p. ej. 612)"),
  cfdiUse: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]\d{2}$/, "Uso de CFDI inválido (p. ej. G03)"),
});
export type BillingInput = z.infer<typeof billingSchema>;

export const customerProfileSchema = z.object({
  fullName: z.string().trim().min(3, "Escribe tu nombre completo").max(120),
  phone: z.string().trim().regex(/^\d{10}$/, "El teléfono debe tener 10 dígitos"),
  /** null o ausente = sin datos fiscales. */
  billing: billingSchema.nullable().optional(),
});
export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

/** Lo que envía el bot de Telegram al recibir `/start CODIGO`. */
export const telegramLinkSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/, "Código inválido"),
  chatId: z.string().min(1).max(30),
  username: z.string().max(64).optional(),
});
export type TelegramLinkInput = z.infer<typeof telegramLinkSchema>;

/** Vista del propio cliente (incluye sus datos fiscales). */
export interface CustomerDTO {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  telegramLinked: boolean;
  telegramUsername: string | null;
  billing: BillingInput | null;
  createdAt: string;
  updatedAt: string;
}

/** Vista del personal: sin datos fiscales ni de Telegram. */
export interface CustomerSummaryDTO {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
}

/** Vista entre servicios: añade el chat de Telegram para poder avisarle. */
export interface CustomerInternalDTO extends CustomerDTO {
  telegramChatId: string | null;
}

export interface TelegramLinkCodeDTO {
  code: string;
  expiresAt: string;
}
