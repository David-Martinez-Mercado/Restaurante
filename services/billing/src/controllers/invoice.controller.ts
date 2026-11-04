import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "@resto/core";
import type { CancelInvoiceInput, IssueInvoiceInput } from "@resto/contracts";
import { invoiceService, type Actor } from "../services/invoice.service.js";

function actorFrom(req: Request): Actor {
  const user = req.user!;
  return { userId: user.sub, role: user.role, requestId: req.requestId };
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Los parámetros de ruta también se validan: un id mal escrito es 422, no un 500. */
function uuidParam(req: Request): string {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) throw AppError.validation("Datos de entrada inválidos", [{ field: "id", issue: "Debe ser un UUID" }]);
  return parsed.data;
}

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para facturas. */
export const invoiceController = {
  async issue(req: Request, res: Response): Promise<void> {
    const { orderId } = req.body as IssueInvoiceInput;
    res.status(201).json({ success: true, data: await invoiceService.issue(orderId, actorFrom(req)) });
  },

  async list(req: Request, res: Response): Promise<void> {
    const data = await invoiceService.list({ status: str(req.query.status), orderId: str(req.query.orderId) }, actorFrom(req));
    res.status(200).json({ success: true, data });
  },

  async get(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await invoiceService.get(uuidParam(req), actorFrom(req)) });
  },

  async xml(req: Request, res: Response): Promise<void> {
    const { xml, filename } = await invoiceService.xml(uuidParam(req), actorFrom(req));
    res.status(200).type("application/xml").set("content-disposition", `attachment; filename="${filename}"`).send(xml);
  },

  async cancel(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await invoiceService.cancel(uuidParam(req), req.body as CancelInvoiceInput, actorFrom(req)) });
  },

  // ---- Interno (bot de Telegram) ----

  async issueFromTelegram(req: Request, res: Response): Promise<void> {
    const { chatId, orderId } = req.body as { chatId: string; orderId: string };
    res.status(201).json({ success: true, data: await invoiceService.issueFromTelegram(chatId, orderId, req.requestId) });
  },
};
