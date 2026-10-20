import type { Request, Response } from "express";
import { AppError } from "@resto/core";
import { taxReportQuerySchema, type TaxCalculateInput } from "@resto/contracts";
import { taxService } from "../services/tax.service.js";

/** CAPA 2 — CONTROLLER: calculadora de IVA y reporte de IVA trasladado. */
export const taxController = {
  calculate(req: Request, res: Response): void {
    res.status(200).json({ success: true, data: taxService.calculate(req.body as TaxCalculateInput) });
  },

  async report(req: Request, res: Response): Promise<void> {
    // En Express 5 req.query es de solo lectura: se valida aquí en lugar de con el middleware validate().
    const parsed = taxReportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.validation(
        "Datos de entrada inválidos",
        parsed.error.issues.map((i) => ({ field: i.path.join(".") || "(root)", issue: i.message }))
      );
    }
    res.status(200).json({ success: true, data: await taxService.report(parsed.data.from, parsed.data.to) });
  },
};
