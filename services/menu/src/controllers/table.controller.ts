import type { Request, Response } from "express";
import {
  TABLE_STATUSES,
  type CreateTableInput,
  type TableStatus,
  type TableStatusInput,
  type UpdateTableInput,
} from "@resto/contracts";
import { AppError } from "@resto/core";
import { tableService } from "../services/table.service.js";

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para mesas. */
export const tableController = {
  async list(req: Request, res: Response): Promise<void> {
    const { status } = req.query;

    if (status !== undefined && !TABLE_STATUSES.includes(status as TableStatus)) {
      throw AppError.validation("Estado inválido", [
        { field: "status", issue: `Valores permitidos: ${TABLE_STATUSES.join(", ")}` },
      ]);
    }

    const data = await tableService.list(status as TableStatus | undefined);
    res.status(200).json({ success: true, data });
  },

  async get(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json({ success: true, data: await tableService.get(req.params.id as string) });
  },

  async create(req: Request, res: Response): Promise<void> {
    const data = await tableService.create(req.body as CreateTableInput);
    res.status(201).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const data = await tableService.update(
      req.params.id as string,
      req.body as UpdateTableInput
    );
    res.status(200).json({ success: true, data });
  },

  async setStatus(req: Request, res: Response): Promise<void> {
    const { status } = req.body as TableStatusInput;
    const data = await tableService.setStatus(req.params.id as string, status);
    res.status(200).json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await tableService.remove(req.params.id as string);
    res.status(204).send();
  },
};
