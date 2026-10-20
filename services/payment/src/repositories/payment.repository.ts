import type { Payment, PaymentStatus, Prisma } from "../generated/client/index.js";
import { prisma } from "../db.js";

export type { Payment };

export interface NewPayment {
  orderId: string;
  orderCode: string;
  customerUserId: string;
  amountCents: number;
  requestSnapshot?: Prisma.InputJsonValue;
}

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para pagos. */
export const paymentRepository = {
  /**
   * Devuelve el cobro pendiente vigente del pedido o crea uno nuevo.
   * El candado consultivo por pedido evita que dos clics simultáneos generen dos cobros:
   * el segundo ya ve el pendiente del primero. Un pendiente vencido por reloj se marca
   * "expired" y se crea otro.
   */
  async getOrCreatePending(data: NewPayment, now: Date): Promise<{ payment: Payment; created: boolean }> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"payment:" + data.orderId}))`;

      const pending = await tx.payment.findFirst({
        where: { orderId: data.orderId, status: "pending" },
        orderBy: { createdAt: "desc" },
      });

      if (pending && (!pending.expiresAt || pending.expiresAt > now)) {
        return { payment: pending, created: false };
      }
      if (pending) {
        await tx.payment.update({ where: { id: pending.id }, data: { status: "expired" } });
      }
      return { payment: await tx.payment.create({ data }), created: true };
    });
  },

  async findById(id: string): Promise<Payment | null> {
    return prisma.payment.findUnique({ where: { id } });
  },

  async findMany(filter: { customerUserId?: string; orderId?: string; status?: PaymentStatus }): Promise<Payment[]> {
    return prisma.payment.findMany({
      where: { customerUserId: filter.customerUserId, orderId: filter.orderId, status: filter.status },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },

  async update(id: string, data: Prisma.PaymentUncheckedUpdateInput): Promise<Payment> {
    return prisma.payment.update({ where: { id }, data });
  },

  /**
   * Cambia el estado solo si el pago sigue en alguno de los estados de origen.
   * Así un aviso tardío de "falló" nunca pisa un pago que otro aviso ya confirmó.
   */
  async transition(
    id: string,
    from: PaymentStatus[],
    data: Prisma.PaymentUncheckedUpdateManyInput
  ): Promise<Payment | null> {
    const result = await prisma.payment.updateMany({ where: { id, status: { in: from } }, data });
    return result.count === 1 ? prisma.payment.findUnique({ where: { id } }) : null;
  },

  async eventSeen(eventId: string): Promise<boolean> {
    return (await prisma.webhookEvent.count({ where: { eventId } })) > 0;
  },

  /** true si es la primera vez que se registra; false si otra ejecución ya lo hizo. */
  async recordEvent(eventId: string, paymentId: string, type: string): Promise<boolean> {
    try {
      await prisma.webhookEvent.create({ data: { eventId, paymentId, type } });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return false;
      throw err;
    }
  },
};
