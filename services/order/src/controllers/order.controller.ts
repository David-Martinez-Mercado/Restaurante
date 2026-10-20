import type { Request, Response } from "express";
import { AppError } from "@resto/core";
import {
  ORDER_STATUSES,
  type CreateOnlineOrderInput,
  type CreateOrderInput,
  type OrderStatus,
  type PaymentConfirmedInput,
  type UpdateOrderStatusInput,
} from "@resto/contracts";
import { orderService, type Actor } from "../services/order.service.js";

function actorFrom(req: Request): Actor {
  const user = req.user!;
  return {
    userId: user.sub,
    role: user.role,
    token: req.header("authorization")!.slice("Bearer ".length).trim(),
    requestId: req.requestId,
  };
}

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para pedidos. */
export const orderController = {
  async create(req: Request, res: Response): Promise<void> {
    const data = await orderService.create(req.body as CreateOrderInput, actorFrom(req));
    res.status(201).json({ success: true, data });
  },

  /** POST /orders/online — el cliente hace su propio pedido para recoger. */
  async createOnline(req: Request, res: Response): Promise<void> {
    const data = await orderService.createOnline(req.body as CreateOnlineOrderInput, actorFrom(req));
    res.status(201).json({ success: true, data });
  },

  async list(req: Request, res: Response): Promise<void> {
    const { status, tableId } = req.query;

    if (status !== undefined && !ORDER_STATUSES.includes(status as OrderStatus)) {
      throw AppError.validation("Estado inválido", [
        { field: "status", issue: `Valores permitidos: ${ORDER_STATUSES.join(", ")}` },
      ]);
    }

    const data = await orderService.list({
      status: status as OrderStatus | undefined,
      tableId: typeof tableId === "string" ? tableId : undefined,
    });
    res.status(200).json({ success: true, data });
  },

  async get(req: Request, res: Response): Promise<void> {
    const data = await orderService.get(req.params.id as string);
    res.status(200).json({ success: true, data });
  },

  async listMine(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await orderService.listMine(actorFrom(req)) });
  },

  async getMine(req: Request, res: Response): Promise<void> {
    const data = await orderService.getMine(req.params.id as string, actorFrom(req));
    res.status(200).json({ success: true, data });
  },

  async changeStatus(req: Request, res: Response): Promise<void> {
    const { status, paymentMethod } = req.body as UpdateOrderStatusInput;
    const data = await orderService.changeStatus(
      req.params.id as string,
      status,
      actorFrom(req),
      paymentMethod
    );
    res.status(200).json({ success: true, data });
  },

  // ---- Interno (Payment Service) ----

  async getInternal(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await orderService.getInternal(req.params.id as string) });
  },

  async confirmPayment(req: Request, res: Response): Promise<void> {
    const data = await orderService.confirmPayment(req.params.id as string, req.body as PaymentConfirmedInput);
    res.status(200).json({ success: true, data });
  },
};
