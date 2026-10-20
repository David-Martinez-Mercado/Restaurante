import type { Request, Response } from "express";
import {
  DISH_CATEGORIES,
  type CreateDishInput,
  type DishAvailabilityInput,
  type DishCategory,
  type UpdateDishInput,
} from "@resto/contracts";
import { AppError } from "@resto/core";
import { dishService } from "../services/dish.service.js";

/** CAPA 2 — CONTROLLER: traduce HTTP <-> dominio para platillos. */
export const dishController = {
  async list(req: Request, res: Response): Promise<void> {
    const { category, available } = req.query;

    if (category !== undefined && !DISH_CATEGORIES.includes(category as DishCategory)) {
      throw AppError.validation("Categoría inválida", [
        { field: "category", issue: `Valores permitidos: ${DISH_CATEGORIES.join(", ")}` },
      ]);
    }

    const data = await dishService.list({
      category: category as DishCategory | undefined,
      available: available === undefined ? undefined : available === "true",
    });
    res.status(200).json({ success: true, data });
  },

  async get(req: Request, res: Response): Promise<void> {
    res
      .status(200)
      .json({ success: true, data: await dishService.get(req.params.id as string) });
  },

  async create(req: Request, res: Response): Promise<void> {
    const data = await dishService.create(req.body as CreateDishInput);
    res.status(201).json({ success: true, data });
  },

  async update(req: Request, res: Response): Promise<void> {
    const data = await dishService.update(
      req.params.id as string,
      req.body as UpdateDishInput
    );
    res.status(200).json({ success: true, data });
  },

  async setAvailability(req: Request, res: Response): Promise<void> {
    const { available } = req.body as DishAvailabilityInput;
    const data = await dishService.setAvailability(req.params.id as string, available);
    res.status(200).json({ success: true, data });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await dishService.remove(req.params.id as string);
    res.status(204).send();
  },
};
