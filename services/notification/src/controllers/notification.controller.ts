import type { Request, Response } from "express";
import type { NotificationEvent } from "@resto/contracts";
import { notificationService } from "../services/notification.service.js";

const userId = (req: Request) => req.user!.sub;
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para avisos. */
export const notificationController = {
  async listMine(req: Request, res: Response): Promise<void> {
    const unreadOnly = req.query.unread === "true";
    const limit = Number(req.query.limit);
    const data = await notificationService.listMine(userId(req), unreadOnly, Number.isInteger(limit) && limit > 0 ? limit : undefined);
    res.status(200).json({ success: true, data });
  },

  async unreadCount(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: { unread: await notificationService.unreadCount(userId(req)) } });
  },

  async markRead(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await notificationService.markRead(req.params.id as string, userId(req)) });
  },

  async markAllRead(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await notificationService.markAllRead(userId(req)) });
  },

  async telegramInfo(_req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await notificationService.telegramInfo() });
  },

  async outbox(req: Request, res: Response): Promise<void> {
    const limit = Number(req.query.limit);
    const data = await notificationService.outbox({
      type: str(req.query.type),
      channel: str(req.query.channel),
      delivery: str(req.query.delivery),
      limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    });
    res.status(200).json({ success: true, data });
  },

  // ---- Interno ----

  async receiveEvent(req: Request, res: Response): Promise<void> {
    const result = await notificationService.dispatch(req.body as NotificationEvent);
    res.status(202).json({ success: true, data: result });
  },
};
