import type { Request, Response } from "express";
import type { CreatePaymentInput, GatewayWebhookInput } from "@resto/contracts";
import { paymentService, type Actor } from "../services/payment.service.js";

function actorFrom(req: Request): Actor {
  const user = req.user!;
  return { userId: user.sub, role: user.role, requestId: req.requestId };
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para pagos. */
export const paymentController = {
  async create(req: Request, res: Response): Promise<void> {
    const data = await paymentService.create(req.body as CreatePaymentInput, actorFrom(req));
    res.status(201).json({ success: true, data });
  },

  async listMine(req: Request, res: Response): Promise<void> {
    const data = await paymentService.listMine(req.user!.sub, { orderId: str(req.query.orderId) });
    res.status(200).json({ success: true, data });
  },

  async listAll(req: Request, res: Response): Promise<void> {
    const data = await paymentService.listAll({ status: str(req.query.status), orderId: str(req.query.orderId) });
    res.status(200).json({ success: true, data });
  },

  async get(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await paymentService.get(req.params.id as string, actorFrom(req)) });
  },

  /** Webhook de la pasarela. Responde 200 también a duplicados y avisos ignorados: no hay nada que reintentar. */
  async webhook(req: Request, res: Response): Promise<void> {
    const outcome = await paymentService.applyWebhook(req.body as GatewayWebhookInput, req.requestId);
    res.status(200).json({ success: true, data: { received: true, outcome } });
  },
};
