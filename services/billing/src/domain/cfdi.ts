import type { PaymentMethod } from "@resto/contracts";

/**
 * Armado del CFDI 4.0 de ingreso a partir de un pedido pagado. Todo son funciones puras.
 *
 * Importes SIEMPRE en centavos enteros y con aritmética entera (nunca 0.1 + 0.2); solo al escribir el
 * XML se convierten a texto con 2 decimales. El PAC (Profact) **autosella**: el XML se manda SIN
 * Sello, NoCertificado ni Certificado; los pone el PAC con el CSD que se registró del emisor.
 */

export interface Emisor {
  rfc: string;
  name: string;
  /** Clave del régimen fiscal del emisor (601 = General de Ley Personas Morales, 612 = Personas Físicas con actividad empresarial...). */
  taxRegime: string;
  /** Código postal del lugar de expedición. */
  postalCode: string;
}

export interface Receptor {
  rfc: string;
  name: string;
  postalCode: string;
  taxRegime: string;
  cfdiUse: string;
}

export interface Line {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export const IVA_PERCENT = 16;

/** Concepto genérico del catálogo del SAT para alimentos y bebidas servidos: 90101501 "Servicios de restaurante". */
export const PROD_SERV_RESTAURANTE = "90101501";
/** E48 = unidad de servicio. */
export const CLAVE_UNIDAD = "E48";

/** 12345 -> "123.45". Sin decimales binarios. */
export function amount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Reparte el IVA del pedido entre sus conceptos, de modo que la suma de los IVA de los conceptos sea
 * EXACTAMENTE el IVA del pedido (que es lo que el cliente pagó). Cada concepto recibe el piso de su
 * IVA exacto o ese piso + 1 centavo (método del mayor residuo), que cae dentro de la tolerancia de
 * redondeo que acepta el SAT.
 */
export function allocateTax(baseCents: number[], totalTaxCents: number, ratePercent = IVA_PERCENT): number[] {
  const numerators = baseCents.map((b) => b * ratePercent);
  const floors = numerators.map((n) => Math.floor(n / 100));
  const remainders = numerators.map((n) => n % 100);
  let leftover = totalTaxCents - floors.reduce((s, f) => s + f, 0);
  if (leftover < 0 || leftover > baseCents.length) {
    throw new Error(`El IVA del pedido (${totalTaxCents}) no cuadra con sus conceptos`);
  }
  const order = remainders.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  const result = [...floors];
  for (const { i } of order) {
    if (leftover === 0) break;
    result[i]! += 1;
    leftover -= 1;
  }
  return result;
}

/** Clave SAT de la forma de pago según cómo se cobró el pedido. Efectivo = 01, tarjeta de crédito = 04. */
export function paymentFormOf(method: PaymentMethod | null): string {
  switch (method) {
    case "cash":
      return "01";
    case "card":
    case "online":
      return "04";
    default:
      throw new Error("El pedido no tiene método de pago registrado");
  }
}

/** Fecha del CFDI: AAAA-MM-DDTHH:MM:SS en la hora LOCAL del lugar de expedición (el SAT rechaza fechas "del futuro"). */
export function formatFecha(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "medium" }).format(now).replace(" ", "T");
}

/** ¿Las dos fechas caen en el mismo mes (en la zona del restaurante)? El consumo solo se factura dentro de su mes. */
export function sameMonthInZone(a: Date, b: Date, timeZone: string): boolean {
  const month = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit" }).format(d);
  return month(a) === month(b);
}

export const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Los nombres del emisor y receptor se escriben en mayúsculas y con espacios simples, como los tiene el SAT. */
export const normalizeName = (s: string): string => s.replace(/\s+/g, " ").trim().toUpperCase();

export interface BuildInput {
  serie: string;
  folio: number;
  now: Date;
  timeZone: string;
  paymentForm: string;
  emisor: Emisor;
  receptor: Receptor;
  lines: Line[];
  /** IVA del pedido, en centavos. */
  taxCents: number;
}

export interface Concept {
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  taxCents: number;
}

/** Importes por concepto y totales del pedido (sin XML): sirve para guardar la factura antes de timbrarla. */
export function computeAmounts(lines: Line[], taxCents: number): { concepts: Concept[]; subtotalCents: number; totalCents: number } {
  const amounts = lines.map((l) => l.unitPriceCents * l.quantity);
  const taxes = allocateTax(amounts, taxCents);
  const subtotalCents = amounts.reduce((sum, a) => sum + a, 0);
  return {
    concepts: lines.map((l, i) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      amountCents: amounts[i]!,
      taxCents: taxes[i]!,
    })),
    subtotalCents,
    totalCents: subtotalCents + taxCents,
  };
}

export interface Built {
  xml: string;
  concepts: Concept[];
  subtotalCents: number;
  ivaCents: number;
  totalCents: number;
}

/** Arma el XML (sin sellar) y los importes que lo componen. */
export function buildCfdi(input: BuildInput): Built {
  const { emisor, receptor } = input;
  const { concepts, subtotalCents, totalCents } = computeAmounts(input.lines, input.taxCents);

  const traslado = (base: number, tax: number) =>
    `<cfdi:Traslado Base="${amount(base)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${amount(tax)}"/>`;

  const conceptosXml = concepts
    .map(
      (c) => `    <cfdi:Concepto ClaveProdServ="${PROD_SERV_RESTAURANTE}" Cantidad="${c.quantity}" ClaveUnidad="${CLAVE_UNIDAD}" Unidad="Servicio" Descripcion="${escapeXml(c.description)}" ValorUnitario="${amount(c.unitPriceCents)}" Importe="${amount(c.amountCents)}" ObjetoImp="02">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          ${traslado(c.amountCents, c.taxCents)}
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" Serie="${escapeXml(input.serie)}" Folio="${input.folio}" Fecha="${formatFecha(input.now, input.timeZone)}" FormaPago="${input.paymentForm}" MetodoPago="PUE" SubTotal="${amount(subtotalCents)}" Moneda="MXN" Total="${amount(totalCents)}" TipoDeComprobante="I" Exportacion="01" LugarExpedicion="${escapeXml(emisor.postalCode)}">
  <cfdi:Emisor Rfc="${escapeXml(emisor.rfc)}" Nombre="${escapeXml(normalizeName(emisor.name))}" RegimenFiscal="${escapeXml(emisor.taxRegime)}"/>
  <cfdi:Receptor Rfc="${escapeXml(receptor.rfc)}" Nombre="${escapeXml(normalizeName(receptor.name))}" DomicilioFiscalReceptor="${escapeXml(receptor.postalCode)}" RegimenFiscalReceptor="${escapeXml(receptor.taxRegime)}" UsoCFDI="${escapeXml(receptor.cfdiUse)}"/>
  <cfdi:Conceptos>
${conceptosXml}
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="${amount(input.taxCents)}">
    <cfdi:Traslados>
      ${traslado(subtotalCents, input.taxCents)}
    </cfdi:Traslados>
  </cfdi:Impuestos>
</cfdi:Comprobante>`;

  return { xml, concepts, subtotalCents, ivaCents: input.taxCents, totalCents };
}

export interface Timbre {
  uuid: string | null;
  fechaTimbrado: string | null;
  selloCfd: string | null;
  selloSat: string | null;
  noCertificadoSat: string | null;
}

const attr = (xml: string, name: string): string | null => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1] ?? null;

/** Lee del Timbre Fiscal Digital (lo que agrega el SAT) los datos que se imprimen en la factura. */
export function parseTimbre(xml: string): Timbre {
  const tfd = /<tfd:TimbreFiscalDigital\b[^>]*>/.exec(xml)?.[0] ?? "";
  return {
    uuid: attr(tfd, "UUID"),
    fechaTimbrado: attr(tfd, "FechaTimbrado"),
    selloCfd: attr(tfd, "SelloCFD"),
    selloSat: attr(tfd, "SelloSAT"),
    noCertificadoSat: attr(tfd, "NoCertificadoSAT"),
  };
}
