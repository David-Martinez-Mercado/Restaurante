import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "@resto/core";
import { periodSchema, type EditAttendanceInput, type ManualAttendanceInput } from "@resto/contracts";
import { attendanceService, type Actor } from "../services/attendance.service.js";

function actorFrom(req: Request): Actor {
  const user = req.user!;
  return { userId: user.sub, username: user.username, role: user.role };
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD");
const rangeQuery = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  userId: z.string().uuid().optional(),
});
const periodQuery = z.object({ period: periodSchema });
const internalQuery = z.object({
  period: periodSchema,
  userId: z.string().uuid(),
  username: z.string().max(60).optional(),
  since: ymd.optional(),
});

/** En Express 5 req.query es de solo lectura: se valida aquí en lugar de con el middleware validate(). */
function parseQuery<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    throw AppError.validation(
      "Datos de entrada inválidos",
      parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(root)", issue: i.message }))
    );
  }
  return parsed.data;
}

function localDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Rango [from, to] incluyente; por defecto los últimos 31 días. */
function rangeFrom(q: z.infer<typeof rangeQuery>): { from: Date; toExclusive: Date } {
  const today = new Date();
  const to = q.to ? localDate(q.to) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const from = q.from ? localDate(q.from) : new Date(to.getFullYear(), to.getMonth(), to.getDate() - 30);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    throw AppError.validation("Rango inválido", [{ field: "to", issue: "Fechas inválidas o la final es anterior a la inicial" }]);
  }
  return { from, toExclusive: new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) };
}

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para el checador. */
export const attendanceController = {
  async clockIn(req: Request, res: Response): Promise<void> {
    res.status(201).json({ success: true, data: await attendanceService.clockIn(actorFrom(req)) });
  },

  async clockOut(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await attendanceService.clockOut(actorFrom(req)) });
  },

  async status(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await attendanceService.status(actorFrom(req)) });
  },

  async listMine(req: Request, res: Response): Promise<void> {
    const { from, toExclusive } = rangeFrom(parseQuery(rangeQuery, req));
    res.status(200).json({ success: true, data: await attendanceService.listMine(actorFrom(req), from, toExclusive) });
  },

  async summaryMine(req: Request, res: Response): Promise<void> {
    const { period } = parseQuery(periodQuery, req);
    const actor = actorFrom(req);
    res.status(200).json({ success: true, data: await attendanceService.summaryOf(actor.userId, actor.username, period, undefined) });
  },

  async list(req: Request, res: Response): Promise<void> {
    const q = parseQuery(rangeQuery, req);
    const { from, toExclusive } = rangeFrom(q);
    res.status(200).json({ success: true, data: await attendanceService.list({ userId: q.userId, from, toExclusive }) });
  },

  async summary(req: Request, res: Response): Promise<void> {
    const { period } = parseQuery(periodQuery, req);
    res.status(200).json({ success: true, data: await attendanceService.summary(period) });
  },

  async manualCreate(req: Request, res: Response): Promise<void> {
    res.status(201).json({ success: true, data: await attendanceService.manualCreate(req.body as ManualAttendanceInput, actorFrom(req)) });
  },

  async edit(req: Request, res: Response): Promise<void> {
    res.status(200).json({
      success: true,
      data: await attendanceService.edit(req.params.id as string, req.body as EditAttendanceInput, actorFrom(req)),
    });
  },

  // ---- Interno (Payroll Service) ----

  async summaryInternal(req: Request, res: Response): Promise<void> {
    const q = parseQuery(internalQuery, req);
    res.status(200).json({
      success: true,
      data: await attendanceService.summaryOf(q.userId, q.username ?? "", q.period, q.since),
    });
  },
};
