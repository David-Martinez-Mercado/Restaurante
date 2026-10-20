import type {
  Prisma,
  Reservation,
  ReservationSource,
  ReservationStatus,
} from "../generated/client/index.js";
import { prisma } from "../db.js";
import { ACTIVE_STATUSES, addMinutes, type ScheduleParams } from "../domain/schedule.js";

export type { Reservation };

export interface NewReservation {
  code: string;
  customerUserId: string | null;
  customerName: string;
  phone: string | null;
  telegramChatId: string | null;
  partySize: number;
  reservedFor: Date;
  source: ReservationSource;
  notes: string | null;
  createdBy: string | null;
}

export type CreateResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: "capacity"; remaining: number }
  | { ok: false; reason: "duplicate" };

/** CAPA 4 — REPOSITORY: único punto de contacto con Prisma para reservaciones. */
export const reservationRepository = {
  /**
   * Crea la reservación solo si hay aforo y el cliente no tiene otra a la misma hora.
   * Se toma un candado consultivo para que dos solicitudes simultáneas se serialicen:
   * la segunda ya ve la reservación de la primera y no se sobrepasa el aforo.
   */
  async createIfAvailable(data: NewReservation, p: ScheduleParams): Promise<CreateResult> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('reservation-capacity'))`;

      // Reservaciones cuya estancia se traslapa con la nueva.
      const overlapping = await tx.reservation.findMany({
        where: {
          status: { in: ACTIVE_STATUSES },
          reservedFor: { gt: addMinutes(data.reservedFor, -p.stayMinutes), lt: addMinutes(data.reservedFor, p.stayMinutes) },
        },
      });

      const sameCustomer = overlapping.some(
        (r) =>
          (data.customerUserId !== null && r.customerUserId === data.customerUserId) ||
          (data.telegramChatId !== null && r.telegramChatId === data.telegramChatId)
      );
      if (sameCustomer) return { ok: false as const, reason: "duplicate" as const };

      const used = overlapping.reduce((sum, r) => sum + r.partySize, 0);
      if (used + data.partySize > p.capacity) {
        return { ok: false as const, reason: "capacity" as const, remaining: Math.max(p.capacity - used, 0) };
      }

      return { ok: true as const, reservation: await tx.reservation.create({ data }) };
    });
  },

  async findById(id: string): Promise<Reservation | null> {
    return prisma.reservation.findUnique({ where: { id } });
  },

  async findByCode(code: string): Promise<Reservation | null> {
    return prisma.reservation.findUnique({ where: { code } });
  },

  async codeExists(code: string): Promise<boolean> {
    return (await prisma.reservation.count({ where: { code } })) > 0;
  },

  async findMany(filter: {
    customerUserId?: string;
    status?: ReservationStatus;
    from?: Date;
    to?: Date;
  }): Promise<Reservation[]> {
    return prisma.reservation.findMany({
      where: {
        customerUserId: filter.customerUserId,
        status: filter.status,
        reservedFor: filter.from || filter.to ? { gte: filter.from, lt: filter.to } : undefined,
      },
      orderBy: { reservedFor: "asc" },
      take: 300,
    });
  },

  /** Próximas reservaciones confirmadas de una persona (por cuenta o por chat de Telegram). */
  async findUpcoming(owner: { customerUserId?: string; telegramChatId?: string }, now: Date): Promise<Reservation[]> {
    const or: Prisma.ReservationWhereInput[] = [];
    if (owner.customerUserId) or.push({ customerUserId: owner.customerUserId });
    if (owner.telegramChatId) or.push({ telegramChatId: owner.telegramChatId });
    if (or.length === 0) return [];
    return prisma.reservation.findMany({
      where: { status: "confirmed", reservedFor: { gte: now }, OR: or },
      orderBy: { reservedFor: "asc" },
      take: 20,
    });
  },

  /** Reservaciones activas dentro de un rango (para calcular la disponibilidad). */
  async findActiveInRange(from: Date, to: Date): Promise<Reservation[]> {
    return prisma.reservation.findMany({
      where: { status: { in: ACTIVE_STATUSES }, reservedFor: { gte: from, lt: to } },
    });
  },

  async update(id: string, data: Prisma.ReservationUncheckedUpdateInput): Promise<Reservation> {
    return prisma.reservation.update({ where: { id }, data });
  },

  /** Reservaciones confirmadas que ya están dentro de la ventana del aviso y no se han avisado. */
  async findDueForReminder(now: Date, until: Date): Promise<Reservation[]> {
    return prisma.reservation.findMany({
      where: { status: "confirmed", reminderSentAt: null, reservedFor: { gt: now, lte: until } },
      orderBy: { reservedFor: "asc" },
      take: 200,
    });
  },

  /**
   * Reclama el aviso de forma atómica: solo una ejecución puede marcarlo, así que
   * aunque dos escaneos coincidan, el cliente recibe UN solo recordatorio.
   */
  async claimReminder(id: string, now: Date): Promise<boolean> {
    const result = await prisma.reservation.updateMany({
      where: { id, status: "confirmed", reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    return result.count === 1;
  },
};
