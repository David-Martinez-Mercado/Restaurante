import type { DeliveryStatus } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface SendOptions {
  buttons?: InlineButton[][];
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number };
    from?: { id: number; username?: string; first_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number; username?: string };
    message?: { chat: { id: number } };
  };
}

export interface SendResult {
  status: DeliveryStatus;
  error?: string;
}

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

const base = () => `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}`;

async function call<T>(method: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const res = await fetch(`${base()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok) {
    const err = new Error(json.description ?? `Telegram respondió ${res.status}`) as Error & { code?: number; retryAfter?: number };
    err.code = json.error_code ?? res.status;
    err.retryAfter = json.parameters?.retry_after;
    throw err;
  }
  return json.result as T;
}

/**
 * Cliente mínimo de la Bot API de Telegram.
 * Sin TELEGRAM_BOT_TOKEN funciona en modo SIMULADO: nada sale a internet y los
 * envíos quedan registrados como "simulated", así el sistema es demostrable
 * sin crear un bot.
 */
export const telegram = {
  get configured(): boolean {
    return config.TELEGRAM_BOT_TOKEN.length > 0;
  },

  username: config.TELEGRAM_BOT_USERNAME,

  /** Si no se indicó el usuario del bot en el .env, se le pregunta a Telegram. */
  async resolveUsername(): Promise<string | null> {
    if (!telegram.configured) return null;
    if (telegram.username) return telegram.username;
    try {
      const me = await call<{ username?: string }>("getMe", {}, 5000);
      telegram.username = me.username ?? "";
    } catch (err) {
      logger.warn({ err }, "No se pudo consultar getMe en Telegram");
    }
    return telegram.username || null;
  },

  /** Envía un mensaje (HTML). Nunca lanza: devuelve el resultado de la entrega. */
  async send(chatId: string, html: string, options: SendOptions = {}): Promise<SendResult> {
    if (!telegram.configured) {
      logger.info({ chatId }, "[Telegram simulado] " + html.replace(/\n/g, " ⏎ ").slice(0, 200));
      return { status: "simulated" };
    }
    try {
      await call(
        "sendMessage",
        {
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
          reply_markup: options.buttons ? { inline_keyboard: options.buttons } : undefined,
        },
        4000
      );
      return { status: "sent" };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      logger.warn({ err, chatId }, "Telegram rechazó el mensaje");
      return { status: "failed", error: message.slice(0, 300) };
    }
  },

  async answerCallback(callbackId: string): Promise<void> {
    if (!telegram.configured) return;
    await call("answerCallbackQuery", { callback_query_id: callbackId }, 4000).catch(() => undefined);
  },

  async deleteWebhook(): Promise<void> {
    await call("deleteWebhook", {}, 5000);
  },

  /** Long polling: Telegram mantiene la petición abierta hasta que haya mensajes (o pasen `timeoutSec`). */
  async getUpdates(offset: number, timeoutSec: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    const res = await fetch(`${base()}/getUpdates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] }),
      signal,
    });
    const json = (await res.json()) as ApiResponse<TelegramUpdate[]>;
    if (!json.ok) {
      const err = new Error(json.description ?? `Telegram respondió ${res.status}`) as Error & { code?: number };
      err.code = json.error_code ?? res.status;
      throw err;
    }
    return json.result ?? [];
  },
};

export type TelegramApi = Pick<typeof telegram, "send" | "answerCallback">;
