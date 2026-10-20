import { AppError } from "@resto/core";
import {
  DELIVERY_STATUSES,
  NOTIFICATION_CHANNELS,
  type DeliveryStatus,
  type NotificationChannel,
  type NotificationDTO,
  type NotificationEvent,
  type NotificationEventType,
  type TelegramInfoDTO,
} from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";
import { customerClient } from "../clients/customer.client.js";
import { dedupeKey, renderMessage, toTelegramHtml, type Message } from "../domain/templates.js";
import { notificationRepository, type Notification } from "../repositories/notification.repository.js";
import { telegram } from "../telegram/telegram.api.js";

function toDTO(n: Notification, withRecipient: boolean): NotificationDTO {
  return {
    id: n.id,
    type: n.type as NotificationEventType,
    channel: n.channel,
    delivery: n.delivery,
    title: n.title,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    recipientUserId: withRecipient ? n.recipientUserId : null,
    error: withRecipient ? n.error : null,
    createdAt: n.createdAt.toISOString(),
  };
}

interface Delivery {
  channel: NotificationChannel;
  delivery: DeliveryStatus;
  recipientChatId: string | null;
  error: string | null;
}

/** Chat de Telegram al que hay que avisar, o el motivo por el que no se puede. */
async function resolveChat(
  event: NotificationEvent,
  userId: string | null
): Promise<{ chatId: string } | { reason: string }> {
  // Las reservaciones hechas por el bot traen su chat: se avisa ahí aunque no haya cuenta.
  const direct = "telegramChatId" in event ? event.telegramChatId : undefined;
  if (direct) return { chatId: direct };
  if (!userId) return { reason: "Sin cuenta ni Telegram a quien avisar" };

  try {
    const profile = await customerClient.getByUser(userId);
    if (profile?.telegramChatId) return { chatId: profile.telegramChatId };
    return { reason: "El cliente no ha vinculado Telegram" };
  } catch {
    return { reason: "No se pudo consultar el perfil del cliente" };
  }
}

async function store(event: NotificationEvent, message: Message, userId: string | null, d: Delivery): Promise<boolean> {
  const saved = await notificationRepository.create({
    type: event.type,
    channel: d.channel,
    delivery: d.delivery,
    title: message.title,
    body: message.body,
    recipientUserId: userId,
    recipientChatId: d.recipientChatId,
    dedupeKey: dedupeKey(event, d.channel),
    error: d.error,
  });
  return saved !== null;
}

/** CAPA 3 — SERVICE: decide a quién y por qué canales se avisa, y lleva la bitácora. */
export const notificationService = {
  /**
   * Procesa un evento de dominio: guarda el aviso en la app (si hay cuenta) y lo manda por
   * Telegram (si hay chat). Cada canal es independiente: que Telegram falle no quita el
   * aviso de la campana. Es idempotente por (tipo, entidad, canal).
   */
  async dispatch(event: NotificationEvent, now = new Date()): Promise<{ stored: number }> {
    const message = renderMessage(event, { timeZone: config.TIMEZONE, now });
    const userId = event.customerUserId ?? null;
    let stored = 0;

    if (userId && !(await notificationRepository.exists(dedupeKey(event, "in_app")))) {
      const ok = await store(event, message, userId, { channel: "in_app", delivery: "sent", recipientChatId: null, error: null });
      if (ok) stored++;
    }

    if (!(await notificationRepository.exists(dedupeKey(event, "telegram")))) {
      const target = await resolveChat(event, userId);
      let delivery: Delivery;

      if ("chatId" in target) {
        const sent = await telegram.send(target.chatId, toTelegramHtml(message));
        delivery = { channel: "telegram", delivery: sent.status, recipientChatId: target.chatId, error: sent.error ?? null };
      } else {
        delivery = { channel: "telegram", delivery: "skipped", recipientChatId: null, error: target.reason };
      }

      // Sin cuenta y sin chat no hay a quien avisar: no se deja una fila vacía.
      if (userId || delivery.recipientChatId) {
        if (await store(event, message, userId, delivery)) stored++;
      }
      if (delivery.delivery === "failed") logger.warn({ type: event.type, error: delivery.error }, "Falló el envío por Telegram");
    }

    return { stored };
  },

  // ---- el propio cliente (campana) ----

  async listMine(userId: string, unreadOnly: boolean, limit = 50): Promise<NotificationDTO[]> {
    return (await notificationRepository.findMine(userId, unreadOnly, Math.min(limit, 100))).map((n) => toDTO(n, false));
  },

  async unreadCount(userId: string): Promise<number> {
    return notificationRepository.countUnread(userId);
  },

  async markRead(id: string, userId: string, now = new Date()): Promise<NotificationDTO> {
    const updated = await notificationRepository.markRead(id, userId, now);
    // 404 también cuando es de otra persona: no se revela que existe.
    if (!updated) throw AppError.notFound("Notificación");
    return toDTO(updated, false);
  },

  async markAllRead(userId: string, now = new Date()): Promise<{ updated: number }> {
    return { updated: await notificationRepository.markAllRead(userId, now) };
  },

  // ---- personal ----

  async outbox(
    filter: { type?: string; channel?: string; delivery?: string; limit?: number }
  ): Promise<NotificationDTO[]> {
    if (filter.channel && !NOTIFICATION_CHANNELS.includes(filter.channel as NotificationChannel)) {
      throw AppError.validation("Canal inválido", [{ field: "channel", issue: `Valores permitidos: ${NOTIFICATION_CHANNELS.join(", ")}` }]);
    }
    if (filter.delivery && !DELIVERY_STATUSES.includes(filter.delivery as DeliveryStatus)) {
      throw AppError.validation("Estado de entrega inválido", [{ field: "delivery", issue: `Valores permitidos: ${DELIVERY_STATUSES.join(", ")}` }]);
    }
    const rows = await notificationRepository.findOutbox({
      type: filter.type,
      channel: filter.channel as NotificationChannel | undefined,
      delivery: filter.delivery as DeliveryStatus | undefined,
      limit: Math.min(Math.max(filter.limit ?? 100, 1), 300),
    });
    return rows.map((n) => toDTO(n, true));
  },

  /** Para que el portal le diga al cliente a qué bot escribirle. */
  async telegramInfo(): Promise<TelegramInfoDTO> {
    return { configured: telegram.configured, botUsername: await telegram.resolveUsername() };
  },
};
