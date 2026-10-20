import type {
  DiningTable,
  Prisma,
  TableStatus,
} from "../generated/client/index.js";
import { prisma } from "../db.js";

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para DiningTable. */
export const tableRepository = {
  async findMany(status?: TableStatus): Promise<DiningTable[]> {
    return prisma.diningTable.findMany({
      where: status ? { status } : undefined,
      orderBy: { number: "asc" },
    });
  },

  async findById(id: string): Promise<DiningTable | null> {
    return prisma.diningTable.findUnique({ where: { id } });
  },

  async findByNumber(number: number): Promise<DiningTable | null> {
    return prisma.diningTable.findUnique({ where: { number } });
  },

  async create(data: Prisma.DiningTableCreateInput): Promise<DiningTable> {
    return prisma.diningTable.create({ data });
  },

  async update(
    id: string,
    data: Prisma.DiningTableUpdateInput
  ): Promise<DiningTable> {
    return prisma.diningTable.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.diningTable.delete({ where: { id } });
  },
};
