import type { Dish, DishCategory, Prisma } from "../generated/client/index.js";
import { prisma } from "../db.js";

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para Dish. */
export const dishRepository = {
  async findMany(filter: {
    category?: DishCategory;
    available?: boolean;
  }): Promise<Dish[]> {
    return prisma.dish.findMany({
      where: filter,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  },

  async findById(id: string): Promise<Dish | null> {
    return prisma.dish.findUnique({ where: { id } });
  },

  async findByName(name: string): Promise<Dish | null> {
    return prisma.dish.findUnique({ where: { name } });
  },

  async create(data: Prisma.DishCreateInput): Promise<Dish> {
    return prisma.dish.create({ data });
  },

  async update(id: string, data: Prisma.DishUpdateInput): Promise<Dish> {
    return prisma.dish.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.dish.delete({ where: { id } });
  },
};
