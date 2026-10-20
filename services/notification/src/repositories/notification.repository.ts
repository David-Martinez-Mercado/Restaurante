import type { Notification, NotificationChannel, DeliveryStatus } from "../generated/client/index.js";
import { prisma } from "../db.js";

export type { Notification };

export interface NewNotification {
  type: string;
  channel: NotificationChannel;
  delivery: DeliveryStatus;
  title: string;
  body: string;
  recipientUserId: string | null;
  recipientChatId: string | null;
  dedupeKey: string;
  error: string | null;
}

export interface OutboxFilter {
  type?: string;
  channel?: NotificationChannel;
  delivery?: DeliveryStatus;
  limit: number;
}

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para avisos. */
export const notificationRepository = {
  async exists(dedupeKey: string): Promise<boolean> {
    return (await prisma.notification.count({ where: { dedupeKey } })) > 0;
  },

  /**
   * Guarda el aviso. Si otra ejecución ya registró la misma llave devuelve null
   * (la restricción única es la última defensa contra avisos duplicados).
   */
  async create(data: NewNotification): Promise<Notification | null> {
    try {
      return await prisma.notification.create({ data });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return null;
      throw err;
    }
  },

  /** Campana del cliente: solo los avisos "in_app" de su cuenta, los más recientes primero. */
  async findMine(userId: string, unreadOnly: boolean, limit: number): Promise<Notification[]> {
    return prisma.notification.findMany({
      where: { recipientUserId: userId, channel: "in_app", ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  async countUnread(userId: string): Promise<number> {
    return prisma.notification.count({ where: { recipientUserId: userId, channel: "in_app", readAt: null } });
  },

  /** Marca como leído solo si es del usuario. Devuelve null si no existe o es de otro. */
  async markRead(id: string, userId: string, at: Date): Promise<Notification | null> {
    const found = await prisma.notification.findFirst({ where: { id, recipientUserId: userId, channel: "in_app" } });
    if (!found) return null;
    if (found.readAt) return found;
    return prisma.notification.update({ where: { id }, data: { readAt: at } });
  },

  async markAllRead(userId: string, at: Date): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { recipientUserId: userId, channel: "in_app", readAt: null },
      data: { readAt: at },
    });
    return result.count;
  },

  /** Bitácora de envíos para el personal. */
  async findOutbox(filter: OutboxFilter): Promise<Notification[]> {
    return prisma.notification.findMany({
      where: { type: filter.type, channel: filter.channel, delivery: filter.delivery },
      orderBy: { createdAt: "desc" },
      take: filter.limit,
    });
  },
};
