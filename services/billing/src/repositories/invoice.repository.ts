import type { Invoice, InvoiceStatus, Prisma } from "../generated/client/index.js";
import { prisma } from "../db.js";

export type { Invoice };

/** Una factura "en proceso" más vieja que esto se considera abandonada (el servicio se cayó a media operación). */
const PENDING_TTL_MS = 2 * 60_000;

export type NewInvoice = Omit<Prisma.InvoiceUncheckedCreateInput, "id" | "folio" | "status">;

export type CreateResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; reason: "issued" | "in_progress"; invoice: Invoice };

export interface Stamping {
  uuid: string;
  xml: string;
  stampedAt: Date;
  selloCfd: string | null;
  selloSat: string | null;
  noCertificadoSat: string | null;
  cadenaOriginal: string | null;
  qrBase64: string | null;
}

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para facturas. */
export const invoiceRepository = {
  /**
   * Reserva el folio y deja la factura "en proceso", salvo que el pedido ya tenga una timbrada o una
   * en curso. El candado consultivo por pedido evita que dos clics simultáneos timbren dos veces.
   */
  async createPendingIfNone(data: NewInvoice, now: Date): Promise<CreateResult> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"invoice:" + data.orderId}))`;
      const existing = await tx.invoice.findFirst({
        where: {
          orderId: data.orderId,
          OR: [{ status: "issued" }, { status: "pending", createdAt: { gt: new Date(now.getTime() - PENDING_TTL_MS) } }],
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return { ok: false as const, reason: existing.status === "issued" ? ("issued" as const) : ("in_progress" as const), invoice: existing };
      return { ok: true as const, invoice: await tx.invoice.create({ data }) };
    });
  },

  async findById(id: string): Promise<Invoice | null> {
    return prisma.invoice.findUnique({ where: { id } });
  },

  async findMany(filter: { customerUserId?: string; status?: InvoiceStatus; orderId?: string; limit: number }): Promise<Invoice[]> {
    return prisma.invoice.findMany({
      where: { customerUserId: filter.customerUserId, status: filter.status, orderId: filter.orderId },
      orderBy: { createdAt: "desc" },
      take: filter.limit,
    });
  },

  async markIssued(id: string, s: Stamping): Promise<Invoice> {
    return prisma.invoice.update({ where: { id }, data: { status: "issued", errorMessage: null, ...s } });
  },

  async markRejected(id: string, message: string): Promise<Invoice> {
    return prisma.invoice.update({ where: { id }, data: { status: "rejected", errorMessage: message.slice(0, 500) } });
  },

  /** Cancela solo si sigue "issued": dos cancelaciones simultáneas no se pisan. */
  async markCancelled(id: string, c: { reason: string; message: string; by: string; at: Date }): Promise<Invoice | null> {
    const r = await prisma.invoice.updateMany({
      where: { id, status: "issued" },
      data: { status: "cancelled", cancelReason: c.reason, cancelMessage: c.message.slice(0, 500), cancelledBy: c.by, cancelledAt: c.at },
    });
    return r.count === 1 ? prisma.invoice.findUnique({ where: { id } }) : null;
  },
};
