import type { Customer, Prisma } from "../generated/client/index.js";
import { prisma } from "../db.js";

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para Customer. */
export const customerRepository = {
  async findById(id: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { id } });
  },

  async findByUserId(userId: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { userId } });
  },

  async findByChatId(telegramChatId: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { telegramChatId } });
  },

  async findByLinkCode(linkCode: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { linkCode } });
  },

  async findMany(search?: string): Promise<Customer[]> {
    return prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : undefined,
      orderBy: { fullName: "asc" },
      take: 100,
    });
  },

  async create(data: Prisma.CustomerUncheckedCreateInput): Promise<Customer> {
    return prisma.customer.create({ data });
  },

  async update(id: string, data: Prisma.CustomerUncheckedUpdateInput): Promise<Customer> {
    return prisma.customer.update({ where: { id }, data });
  },

  /**
   * Vincula el chat de Telegram. Un chat pertenece a un solo cliente: si estaba
   * ligado a otra cuenta, se le quita en la misma transacción.
   */
  async bindTelegram(id: string, chatId: string, username: string | null): Promise<Customer> {
    const [, bound] = await prisma.$transaction([
      prisma.customer.updateMany({
        where: { telegramChatId: chatId, NOT: { id } },
        data: { telegramChatId: null, telegramUsername: null },
      }),
      prisma.customer.update({
        where: { id },
        data: { telegramChatId: chatId, telegramUsername: username, linkCode: null, linkCodeExpiresAt: null },
      }),
    ]);
    return bound;
  },
};
