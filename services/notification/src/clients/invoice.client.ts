import type { InvoiceDetailDTO } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

/** El Billing Service rechazó la operación con un motivo que el cliente debe leer (sin datos fiscales, plazo vencido, SAT...). */
export class InvoiceRejected extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "InvoiceRejected";
  }
}

export class InvoiceUnavailable extends Error {
  constructor() {
    super("El servicio de facturación no está disponible");
    this.name = "InvoiceUnavailable";
  }
}

/** Cliente HTTP interno del Billing Service, usado por el botón "Facturar" del bot de Telegram. */
export const invoiceClient = {
  async issue(chatId: string, orderId: string): Promise<InvoiceDetailDTO> {
    let res: Response;
    try {
      res = await fetch(`${config.BILLING_SERVICE_URL}/api/v1/internal/invoices/telegram`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-key": config.INTERNAL_API_KEY },
        body: JSON.stringify({ chatId, orderId }),
        // Timbrar con el PAC puede tardar unos segundos.
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new InvoiceUnavailable();
    }
    if (res.status === 401) {
      logger.error("El Billing Service rechazó la llave interna: revisa INTERNAL_API_KEY");
      throw new InvoiceUnavailable();
    }
    if (res.status === 503 || res.status >= 502) throw new InvoiceUnavailable();

    const json = (await res.json().catch(() => ({}))) as { data?: InvoiceDetailDTO; error?: { message?: string } };
    if (!res.ok) throw new InvoiceRejected(res.status, json.error?.message ?? "No se pudo emitir la factura");
    return json.data as InvoiceDetailDTO;
  },
};
