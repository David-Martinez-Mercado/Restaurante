import type { Request, Response } from "express";
import { AppError } from "@resto/core";
import { periodSchema, type CompensationInput, type GeneratePayrollInput } from "@resto/contracts";
import { z } from "zod";
import { payrollService, type Actor } from "../services/payroll.service.js";

function actorFrom(req: Request): Actor {
  const user = req.user!;
  return { userId: user.sub, username: user.username, role: user.role, requestId: req.requestId };
}

/** Los parámetros de ruta también se validan: un periodo mal escrito es 422, no un 404 confuso. */
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, field: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw AppError.validation("Datos de entrada inválidos", [{ field, issue: parsed.error.issues[0]?.message ?? "Inválido" }]);
  }
  return parsed.data;
}

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para nómina. */
export const payrollController = {
  async listCompensations(_req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await payrollService.listCompensations() });
  },

  async saveCompensation(req: Request, res: Response): Promise<void> {
    const userId = parse(z.string().uuid(), req.params.userId, "userId");
    res.status(200).json({ success: true, data: await payrollService.saveCompensation(userId, req.body as CompensationInput) });
  },

  async calculate(req: Request, res: Response): Promise<void> {
    const { period } = req.body as GeneratePayrollInput;
    res.status(200).json({ success: true, data: await payrollService.calculate(period, actorFrom(req)) });
  },

  async listRuns(_req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await payrollService.listRuns() });
  },

  async getRun(req: Request, res: Response): Promise<void> {
    const period = parse(periodSchema, req.params.period, "period");
    res.status(200).json({ success: true, data: await payrollService.getRun(period) });
  },

  async approve(req: Request, res: Response): Promise<void> {
    const period = parse(periodSchema, req.params.period, "period");
    res.status(200).json({ success: true, data: await payrollService.approve(period, actorFrom(req)) });
  },

  async payslips(req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await payrollService.payslips(req.user!.sub) });
  },

  async engineTransactions(req: Request, res: Response): Promise<void> {
    const limit = Number(req.query.limit);
    const data = await payrollService.engineTransactions(Number.isInteger(limit) && limit > 0 ? limit : undefined);
    res.status(200).json({ success: true, data });
  },

  async engineSnapshot(_req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await payrollService.engineSnapshot() });
  },

  async engineStatus(_req: Request, res: Response): Promise<void> {
    res.status(200).json({ success: true, data: await payrollService.engineStatus() });
  },
};
