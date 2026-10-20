import { logger } from "@resto/http";
import { config } from "../config.js";
import { customerClient } from "../clients/customer.client.js";
import { reservationClient } from "../clients/reservation.client.js";
import { Bot } from "./bot.js";
import { telegram } from "./telegram.api.js";

const POLL_SECONDS = 25;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Recibe los mensajes de Telegram por long polling (no necesita URL pública ni webhook,
 * por eso funciona igual en la laptop del proyecto). Sin token no hace nada.
 * Devuelve una función para detenerlo.
 */
export function startTelegramPolling(): () => void {
  if (!telegram.configured) {
    logger.warn("TELEGRAM_BOT_TOKEN vacío: Telegram en modo SIMULADO (los avisos se registran pero no salen).");
    return () => undefined;
  }

  const bot = new Bot({
    api: telegram,
    customers: customerClient,
    reservations: reservationClient,
    timeZone: config.TIMEZONE,
    now: () => new Date(),
  });

  const abort = new AbortController();

  void (async () => {
    // Con un webhook activo Telegram no entrega por getUpdates.
    await telegram.deleteWebhook().catch((err: unknown) => logger.warn({ err }, "No se pudo limpiar el webhook de Telegram"));
    const username = await telegram.resolveUsername();
    logger.info(`🤖 Bot de Telegram activo${username ? ` (@${username})` : ""}`);

    let offset = 0;
    let failures = 0;
    while (!abort.signal.aborted) {
      try {
        const updates = await telegram.getUpdates(offset, POLL_SECONDS, abort.signal);
        failures = 0;
        for (const update of updates) {
          offset = update.update_id + 1;
          await bot.handle(update);
        }
      } catch (err) {
        if (abort.signal.aborted) break;
        failures++;
        const code = (err as { code?: number }).code;
        // 401 = token inválido, 409 = otra instancia está leyendo los mensajes.
        const wait = Math.min(2000 * 2 ** Math.min(failures, 5), 60_000);
        logger.warn({ code, retryInMs: wait }, `Falló la lectura de Telegram: ${err instanceof Error ? err.message : "error"}`);
        await sleep(wait, abort.signal);
      }
    }
  })();

  return () => abort.abort();
}
