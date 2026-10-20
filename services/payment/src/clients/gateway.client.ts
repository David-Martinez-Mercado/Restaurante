import { z } from "zod";
import type { GatewayChargeRequest, GatewayChargeResponse } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

/** Respuesta que debe devolver la pasarela a POST /v1/charges (ver docs/CONTRATO-PASARELA-DE-PAGO.md). */
const chargeResponseSchema = z.object({
  gatewayReference: z.string().min(1).max(100),
  checkoutUrl: z.string().url(),
  expiresAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "Fecha inválida")
    .optional(),
});

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayError";
  }
}

/**
 * ADAPTADOR de la pasarela de pago: el único lugar que conoce su URL.
 * La pasarela la construye otro equipo; aquí solo se cumple el contrato.
 */
export const gatewayClient = {
  get configured(): boolean {
    return config.PAYMENT_GATEWAY_URL.length > 0;
  },

  async charge(request: GatewayChargeRequest): Promise<GatewayChargeResponse> {
    let res: Response;
    try {
      res = await fetch(`${config.PAYMENT_GATEWAY_URL}/v1/charges`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // La referencia del cobro funciona también como llave de idempotencia:
          // reintentar el mismo cobro no debe generar dos cargos.
          "idempotency-key": request.reference,
          ...(config.PAYMENT_GATEWAY_API_KEY ? { authorization: `Bearer ${config.PAYMENT_GATEWAY_API_KEY}` } : {}),
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new GatewayError("No se pudo contactar la pasarela de pago");
    }

    if (!res.ok) {
      logger.warn({ status: res.status }, "La pasarela rechazó el cobro");
      throw new GatewayError(`La pasarela respondió ${res.status}`);
    }

    // Tolera tanto el cuerpo directo como envuelto en { data: ... }.
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    const parsed = chargeResponseSchema.safeParse(json && "data" in json && json.data ? json.data : json);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues }, "La respuesta de la pasarela no cumple el contrato");
      throw new GatewayError("La respuesta de la pasarela no es válida");
    }
    return parsed.data;
  },
};
