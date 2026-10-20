import { z } from "zod";

/** Los precios viajan siempre en centavos (entero) para evitar errores de flotantes. */

export const DISH_CATEGORIES = [
  "starter",
  "main",
  "dessert",
  "drink",
  "side",
] as const;
export type DishCategory = (typeof DISH_CATEGORIES)[number];

export const createDishSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  priceCents: z.number().int().positive().max(10_000_000),
  category: z.enum(DISH_CATEGORIES),
  available: z.boolean().optional().default(true),
});
export type CreateDishInput = z.infer<typeof createDishSchema>;

export const updateDishSchema = createDishSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Debe enviar al menos un campo");
export type UpdateDishInput = z.infer<typeof updateDishSchema>;

export const dishAvailabilitySchema = z.object({ available: z.boolean() });
export type DishAvailabilityInput = z.infer<typeof dishAvailabilitySchema>;

export interface DishDTO {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  category: DishCategory;
  available: boolean;
  createdAt: string;
  updatedAt: string;
}

export const TABLE_STATUSES = ["free", "occupied", "reserved"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const createTableSchema = z.object({
  number: z.number().int().positive().max(999),
  capacity: z.number().int().min(1).max(30),
});
export type CreateTableInput = z.infer<typeof createTableSchema>;

export const updateTableSchema = createTableSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Debe enviar al menos un campo");
export type UpdateTableInput = z.infer<typeof updateTableSchema>;

export const tableStatusSchema = z.object({ status: z.enum(TABLE_STATUSES) });
export type TableStatusInput = z.infer<typeof tableStatusSchema>;

export interface TableDTO {
  id: string;
  number: number;
  capacity: number;
  status: TableStatus;
  createdAt: string;
  updatedAt: string;
}
