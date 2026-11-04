import { z } from "zod";
import { AppError } from "@resto/core";
import { logger } from "@resto/http";
import { config } from "../config.js";

/**
 * ADAPTADOR del PAC Profact (TimbraCFDI API v2). Es el único lugar que conoce su forma de hablar.
 * Documentación: https://developers.timbracfdi33.mx
 *
 *   POST {PROFACT_URL}/Timbrado/TimbraCFDI   { XmlComprobanteBase64, IdComprobante }
 *        -> 200 { Codigo: 0, Xml, CodigoQr (JPEG en base64), CadenaOriginalTimbre, Valores: { UUID } }
 *   POST {PROFACT_URL}/Timbrado/CancelaCFDI  { RfcEmisor, FolioFiscal, MotivoCancelacion, FolioFiscalSustitucion? }
 *        -> 200 { CodigoSat, MensajeSat, XmlAcuse, Valores: { UUID } }
 *   Error  -> 4xx/500 { Categoria, Codigo, CodigoSat, Mensaje, MensajeSat, Valores }
 *   Autenticación: Authorization: Bearer <token de integrador>
 *
 * El PAC AUTOSELLA el CFDI con el CSD que se registró del emisor (RegistraEmisor): el XML se manda sin sellar.
 */

/** El PAC o el SAT rechazaron el comprobante (datos fiscales, estructura, fechas...). Se le muestra al usuario. */
export class PacRejected extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly satCode: string | null
  ) {
    super(message);
    this.name = "PacRejected";
  }
}

const stampedSchema = z.object({
  Codigo: z.number(),
  Xml: z.string().min(1),
  CodigoQr: z.string().nullish(),
  CadenaOriginalTimbre: z.string().nullish(),
  Valores: z.object({ UUID: z.string().min(1) }).passthrough(),
});

const cancelSchema = z
  .object({
    CodigoSat: z.union([z.string(), z.number()]).nullish(),
    MensajeSat: z.string().nullish(),
    ResultadoSat: z.string().nullish(),
    Mensaje: z.string().nullish(),
    XmlAcuse: z.string().nullish(),
  })
  .passthrough();

const errorSchema = z
  .object({ Categoria: z.string().nullish(), Codigo: z.number().nullish(), CodigoSat: z.union([z.string(), z.number()]).nullish(), Mensaje: z.string().nullish(), MensajeSat: z.string().nullish() })
  .passthrough();

export interface Stamped {
  uuid: string;
  xml: string;
  qrBase64: string | null;
  cadenaOriginal: string | null;
}

export interface Cancelled {
  message: string;
  acuseXml: string | null;
}

const unavailable = () => AppError.serviceUnavailable("de facturación (Profact)");

async function post(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  if (!config.PROFACT_TOKEN) {
    throw new AppError("SERVICE_UNAVAILABLE", "La facturación no está configurada: falta PROFACT_TOKEN", 503);
  }
  let res: Response;
  try {
    res = await fetch(`${config.PROFACT_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.PROFACT_TOKEN}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw unavailable();
  }
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** Convierte una respuesta de error del PAC en algo que se le pueda mostrar al usuario. */
function failure(status: number, data: unknown, what: string): never {
  if (status === 401) {
    logger.error("Profact rechazó el token de integrador: revisa PROFACT_TOKEN");
    throw new AppError("SERVICE_UNAVAILABLE", "El servicio de facturación rechazó las credenciales: avisa al administrador", 503);
  }
  const parsed = errorSchema.safeParse(data);
  if (status >= 400 && status < 600 && parsed.success && (parsed.data.Mensaje || parsed.data.MensajeSat)) {
    const e = parsed.data;
    throw new PacRejected(e.MensajeSat || e.Mensaje || "El PAC rechazó el comprobante", e.Codigo ?? null, e.CodigoSat !== undefined && e.CodigoSat !== null ? String(e.CodigoSat) : null);
  }
  logger.error({ status, what }, "Respuesta inesperada de Profact");
  throw unavailable();
}

export const profactClient = {
  get configured(): boolean {
    return config.PROFACT_TOKEN.length > 0;
  },

  /** Timbra (y sella) el CFDI. */
  async timbrar(xml: string, idComprobante: string): Promise<Stamped> {
    const { status, data } = await post("/Timbrado/TimbraCFDI", {
      XmlComprobanteBase64: Buffer.from(xml, "utf8").toString("base64"),
      IdComprobante: idComprobante,
    });
    if (status !== 200) failure(status, data, "timbrado");

    const parsed = stampedSchema.safeParse(data);
    if (!parsed.success || parsed.data.Codigo !== 0) {
      logger.error({ issues: parsed.success ? undefined : parsed.error.issues }, "Profact respondió algo inesperado al timbrar");
      throw unavailable();
    }
    return {
      uuid: parsed.data.Valores.UUID,
      xml: parsed.data.Xml,
      qrBase64: parsed.data.CodigoQr ?? null,
      cadenaOriginal: parsed.data.CadenaOriginalTimbre ?? null,
    };
  },

  /** Cancela un CFDI ya timbrado. */
  async cancelar(input: { rfcEmisor: string; uuid: string; reason: string; replacementUuid?: string }): Promise<Cancelled> {
    const { status, data } = await post("/Timbrado/CancelaCFDI", {
      RfcEmisor: input.rfcEmisor,
      FolioFiscal: input.uuid,
      MotivoCancelacion: input.reason,
      FolioFiscalSustitucion: input.replacementUuid ?? "",
    });
    if (status !== 200) failure(status, data, "cancelación");

    const parsed = cancelSchema.safeParse(data);
    if (!parsed.success) throw unavailable();
    return {
      message: parsed.data.MensajeSat || parsed.data.ResultadoSat || parsed.data.Mensaje || "Cancelación solicitada al SAT",
      acuseXml: parsed.data.XmlAcuse ?? null,
    };
  },
};
