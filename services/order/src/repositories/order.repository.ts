import type {
  OrderChannel,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from "../generated/client/index.js";
import { prisma } from "../db.js";

export type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

export interface NewOrder {
  tableId: string | null;
  waiterId: string | null;
  channel: OrderChannel;
  customerUserId: string | null;
  customerName: string | null;
  notes?: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  items: {
    dishId: string;
    dishName: string;
    unitPriceCents: number;
    quantity: number;
  }[];
}

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para pedidos. */
export const orderRepository = {
  async create(data: NewOrder): Promise<OrderWithItems> {
    const { items, ...order } = data;
    return prisma.order.create({
      data: { ...order, items: { create: items } },
      include: { items: true },
    });
  },

  async findById(id: string): Promise<OrderWithItems | null> {
    return prisma.order.findUnique({ where: { id }, include: { items: true } });
  },

  async findMany(filter: {
    status?: OrderStatus;
    tableId?: string;
    customerUserId?: string;
  }): Promise<OrderWithItems[]> {
    return prisma.order.findMany({
      where: filter,
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  },

  /** Solo las columnas necesarias para el reporte de IVA de pedidos pagados en [from, toExclusive). */
  async findPaidBetween(
    from: Date,
    toExclusive: Date
  ): Promise<
    { subtotalCents: number; taxCents: number; totalCents: number; paymentMethod: PaymentMethod | null; paidAt: Date }[]
  > {
    const rows = await prisma.order.findMany({
      where: { status: "paid", paidAt: { gte: from, lt: toExclusive } },
      select: { subtotalCents: true, taxCents: true, totalCents: true, paymentMethod: true, paidAt: true },
    });
    return rows.flatMap((r) => (r.paidAt ? [{ ...r, paidAt: r.paidAt }] : []));
  },

  async findActiveByTable(
    tableId: string,
    activeStatuses: OrderStatus[]
  ): Promise<OrderWithItems | null> {
    return prisma.order.findFirst({
      where: { tableId, status: { in: activeStatuses } },
      include: { items: true },
    });
  },

  async update(
    id: string,
    data: { status?: OrderStatus; paymentMethod?: PaymentMethod; paidAt?: Date }
  ): Promise<OrderWithItems> {
    return prisma.order.update({
      where: { id },
      data,
      include: { items: true },
    });
  },
};
