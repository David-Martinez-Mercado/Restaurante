import type { Request, Response } from "express";
import type { CustomerProfileInput, TelegramLinkInput } from "@resto/contracts";
import { customerService } from "../services/customer.service.js";

const userId = (req: Request) => req.user!.sub;

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para clientes. */
export const customerController = {
  async getMine(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await customerService.getMine(userId(req)) });
  },

  async putMine(req: Request, res: Response): Promise<void> {
    const data = await customerService.upsertMine(userId(req), req.body as CustomerProfileInput);
    res.status(200).json({ success: true, data });
  },

  async createLinkCode(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await customerService.createLinkCode(userId(req)) });
  },

  async unlinkTelegram(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await customerService.unlinkTelegram(userId(req)) });
  },

  async list(req: Request, res: Response): Promise<void> {
    const search = typeof req.query.search === "string" && req.query.search.trim() ? req.query.search.trim() : undefined;
    res.status(200).json({ success: true, data: await customerService.list(search) });
  },

  async get(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await customerService.get(req.params.id as string) });
  },

  // ---- Interno ----

  async getByUserInternal(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await customerService.getByUserInternal(req.params.userId as string) });
  },

  async getByChatInternal(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await customerService.getByChatInternal(req.params.chatId as string) });
  },

  async linkTelegram(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await customerService.linkTelegram(req.body as TelegramLinkInput) });
  },
};
