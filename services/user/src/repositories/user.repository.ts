import type { Prisma, Role, User } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * CAPA 4 — REPOSITORY
 * Único punto de contacto con Prisma/PostgreSQL para la entidad User.
 * No contiene reglas de negocio: sólo consultas y mutaciones.
 */
export const userRepository = {
  async findByUsername(username: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { username } });
  },

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  async findAll(): Promise<User[]> {
    return prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  },

  async countByRole(role: Role): Promise<number> {
    return prisma.user.count({ where: { role } });
  },

  async create(data: {
    username: string;
    email: string;
    passwordHash: string;
    role: Role;
  }): Promise<User> {
    return prisma.user.create({ data });
  },

  async updateById(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },
};
