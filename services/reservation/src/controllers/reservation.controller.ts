import type { Request, Response } from "express";
import { AppError } from "@resto/core";
import {
  MAX_PARTY_SIZE,
  RESERVATION_STATUSES,
  type CreateReservationInput,
  type ReservationStatus,
  type TelegramReservationInput,
  type UpdateReservationStatusInput,
} from "@resto/contracts";
import { reservationService, type Actor } from "../services/reservation.service.js";

function actorFrom(req: Request): Actor {
  const user = req.user!;
  return {
    userId: user.sub,
    role: user.role,
    token: req.header("authorization")!.slice("Bearer ".length).trim(),
    requestId: req.requestId,
  };
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);

function partySizeFrom(req: Request): number {
  const raw = str(req.query.partySize);
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PARTY_SIZE) {
    throw AppError.validation("Datos de entrada inválidos", [
      { field: "partySize", issue: `Debe ser un entero entre 1 y ${MAX_PARTY_SIZE}` },
    ]);
  }
  return n;
}

function dateFrom(req: Request): string {
  const date = str(req.query.date);
  if (!date) {
    throw AppError.validation("Datos de entrada inválidos", [{ field: "date", issue: "Requerido (AAAA-MM-DD)" }]);
  }
  return date;
}

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para reservaciones. */
export const reservationController = {
  async create(req: Request, res: Response): Promise<void> {
    const data = await reservationService.create(req.body as CreateReservationInput, actorFrom(req));
    res.status(201).json({ success: true, data });
  },

  async availability(req: Request, res: Response): Promise<void> {
    const data = await reservationService.availability(dateFrom(req), partySizeFrom(req));
    res.status(200).json({ success: true, data });
  },

  async list(req: Request, res: Response): Promise<void> {
    const status = str(req.query.status);
    if (status && !RESERVATION_STATUSES.includes(status as ReservationStatus)) {
      throw AppError.validation("Estado inválido", [
        { field: "status", issue: `Valores permitidos: ${RESERVATION_STATUSES.join(", ")}` },
      ]);
    }
    const data = await reservationService.list(
      { status: status as ReservationStatus | undefined, date: str(req.query.date) },
      actorFrom(req)
    );
    res.status(200).json({ success: true, data });
  },

  async get(req: Request, res: Response): Promise<void> {
    const data = await reservationService.get(req.params.id as string, actorFrom(req));
    res.status(200).json({ success: true, data });
  },

  async changeStatus(req: Request, res: Response): Promise<void> {
    const data = await reservationService.changeStatus(
      req.params.id as string,
      req.body as UpdateReservationStatusInput,
      actorFrom(req)
    );
    res.status(200).json({ success: true, data });
  },

  // ---- Interno (bot de Telegram) ----

  async createFromTelegram(req: Request, res: Response): Promise<void> {
    const data = await reservationService.createFromTelegram(req.body as TelegramReservationInput, req.requestId);
    res.status(201).json({ success: true, data });
  },

  async availabilityInternal(req: Request, res: Response): Promise<void> {
    const data = await reservationService.availability(dateFrom(req), partySizeFrom(req));
    res.status(200).json({ success: true, data });
  },

  async upcomingForChat(req: Request, res: Response): Promise<void> {
    const data = await reservationService.upcomingForChat(req.params.chatId as string, req.requestId);
    res.status(200).json({ success: true, data });
  },

  async cancelFromTelegram(req: Request, res: Response): Promise<void> {
    const { chatId, code } = req.body as { chatId: string; code: string };
    const data = await reservationService.cancelFromTelegram(code, chatId, req.requestId);
    res.status(200).json({ success: true, data });
  },

  /** Fuerza un escaneo de recordatorios ahora mismo (pruebas y operación). */
  async runReminders(_req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, sent: await reservationService.runReminders() });
  },
};
