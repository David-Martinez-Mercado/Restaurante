import { randomInt } from "node:crypto";
import { AppError, hasPermission, type Role } from "@resto/core";
import { emitEvent } from "@resto/http";
import type {
  CreateReservationInput,
  ReservationDTO,
  ReservationStatus,
  SlotDTO,
  TelegramReservationInput,
  UpdateReservationStatusInput,
} from "@resto/contracts";
import { customerClient } from "../clients/customer.client.js";
import { menuClient } from "../clients/menu.client.js";
import { scheduleParams as defaultParams } from "../config.js";
import {
  addMinutes,
  arrivalMayBeRecorded,
  checkLead,
  customerMayCancel,
  generateCode,
  isNoShowAllowed,
  isValidArrival,
  overlapsStay,
  reminderDue,
  requiredPermission,
  slotsOfDay,
  type ScheduleParams,
} from "../domain/schedule.js";
import { reservationRepository, type Reservation } from "../repositories/reservation.repository.js";

/** Quién hace la petición (JWT del usuario). */
export interface Actor {
  userId: string;
  role: Role;
  token: string;
  requestId: string;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const arrivalHint = (p: ScheduleParams) =>
  `La hora de llegada debe ser entre ${hhmm(p.openMinutes)} y ${hhmm(p.lastMinutes)}, en bloques de ${p.slotMinutes} minutos (p. ej. ${hhmm(p.openMinutes)}, ${hhmm(p.openMinutes + p.slotMinutes)})`;

function toDTO(r: Reservation): ReservationDTO {
  return {
    id: r.id,
    code: r.code,
    customerUserId: r.customerUserId,
    customerName: r.customerName,
    phone: r.phone,
    partySize: r.partySize,
    reservedFor: r.reservedFor.toISOString(),
    status: r.status,
    source: r.source,
    tableId: r.tableId,
    tableNumber: r.tableNumber,
    notes: r.notes,
    arrivedAt: r.arrivedAt?.toISOString() ?? null,
    reminderSentAt: r.reminderSentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Carga útil de los eventos de aviso. Las llaves opcionales van ausentes, nunca en null. */
function eventPayload(r: Reservation) {
  return {
    reservationId: r.id,
    code: r.code,
    customerName: r.customerName,
    reservedFor: r.reservedFor.toISOString(),
    partySize: r.partySize,
    customerUserId: r.customerUserId ?? undefined,
    telegramChatId: r.telegramChatId ?? undefined,
  };
}

const seesAll = (actor: Actor) => hasPermission(actor.role, "reservations:read-all");

async function getAccessible(id: string, actor: Actor): Promise<Reservation> {
  const reservation = await reservationRepository.findById(id);
  // Para quien no puede verla, la reservación "no existe" (404, no 403).
  if (!reservation || (!seesAll(actor) && reservation.customerUserId !== actor.userId)) {
    throw AppError.notFound("Reservación");
  }
  return reservation;
}

async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode(randomInt);
    if (!(await reservationRepository.codeExists(code))) return code;
  }
  throw AppError.internal("No se pudo generar un localizador único");
}

interface BookingData {
  customerUserId: string | null;
  customerName: string;
  phone: string | null;
  telegramChatId: string | null;
  partySize: number;
  reservedFor: Date;
  source: "web" | "telegram" | "staff";
  notes: string | null;
  createdBy: string | null;
}

/** Reglas comunes a todas las vías de reserva: horario, anticipación, aforo y duplicados. */
async function book(data: BookingData, p: ScheduleParams, now: Date): Promise<ReservationDTO> {
  if (!isValidArrival(data.reservedFor, p)) {
    throw AppError.validation("Horario inválido", [{ field: "reservedFor", issue: arrivalHint(p) }]);
  }
  const lead = checkLead(data.reservedFor, now);
  if (lead === "too_soon") throw AppError.conflict("Las reservaciones se hacen con al menos 30 minutos de anticipación");
  if (lead === "too_far") throw AppError.conflict("Solo se puede reservar hasta con 60 días de anticipación");

  const result = await reservationRepository.createIfAvailable({ code: await uniqueCode(), ...data }, p);
  if (!result.ok) {
    throw AppError.conflict(
      result.reason === "duplicate"
        ? "Ya tienes una reservación que se traslapa con esa hora"
        : result.remaining === 0
          ? "No hay lugares disponibles a esa hora; prueba con otro horario"
          : `A esa hora solo quedan ${result.remaining} lugares; prueba con otro horario o menos personas`
    );
  }

  emitEvent("reservation.confirmed", eventPayload(result.reservation));
  return toDTO(result.reservation);
}

/**
 * CAPA 3 — SERVICE
 * Lógica de reservaciones: hora de llegada, aforo, un cliente = una reservación
 * por hora, ciclo de vida con permisos por paso y aviso automático cuando ya casi
 * es la hora. Se puede reservar desde el portal, por Telegram o con el personal.
 */
export const reservationService = {
  /** Reservación desde el portal (cliente) o desde el mostrador (personal). */
  async create(input: CreateReservationInput, actor: Actor, p: ScheduleParams = defaultParams, now = new Date()) {
    let data: BookingData;

    if (seesAll(actor)) {
      // El personal reserva a nombre de un cliente: con su cuenta o con nombre y teléfono.
      let customerName = input.customerName ?? null;
      let phone = input.phone ?? null;
      if (input.customerUserId) {
        const customer = await customerClient.getByUser(input.customerUserId, actor.requestId);
        if (!customer) throw AppError.notFound("Cliente");
        customerName = customer.fullName;
        phone = customer.phone;
      }
      if (!customerName || !phone) {
        throw AppError.validation("Datos de entrada inválidos", [
          { field: "customerName", issue: "Indica el nombre y el teléfono del cliente (o elige un cliente registrado)" },
        ]);
      }
      data = {
        customerUserId: input.customerUserId ?? null,
        customerName,
        phone,
        telegramChatId: null,
        partySize: input.partySize,
        reservedFor: input.reservedFor,
        source: "staff",
        notes: input.notes ?? null,
        createdBy: actor.userId,
      };
    } else {
      // Un cliente reserva siempre para sí mismo: se ignora cualquier nombre o cuenta enviados.
      const customer = await customerClient.getByUser(actor.userId, actor.requestId);
      if (!customer) throw AppError.conflict("Completa tu perfil de cliente (nombre y teléfono) antes de reservar");
      data = {
        customerUserId: actor.userId,
        customerName: customer.fullName,
        phone: customer.phone,
        telegramChatId: null,
        partySize: input.partySize,
        reservedFor: input.reservedFor,
        source: "web",
        notes: input.notes ?? null,
        createdBy: actor.userId,
      };
    }

    return book(data, p, now);
  },

  /** Reservación hecha desde el bot de Telegram (ruta interna). */
  async createFromTelegram(
    input: TelegramReservationInput,
    requestId: string,
    p: ScheduleParams = defaultParams,
    now = new Date()
  ) {
    // Si el chat está vinculado a una cuenta, la reservación queda a su nombre.
    const customer = await customerClient.getByChat(input.telegramChatId, requestId);
    const customerName = customer?.fullName ?? input.customerName;
    if (!customerName) {
      throw AppError.validation("Datos de entrada inválidos", [
        { field: "customerName", issue: "Indica a nombre de quién es la reservación" },
      ]);
    }

    return book(
      {
        customerUserId: customer?.userId ?? null,
        customerName,
        phone: customer?.phone ?? null,
        telegramChatId: input.telegramChatId,
        partySize: input.partySize,
        reservedFor: input.reservedFor,
        source: "telegram",
        notes: input.notes ?? null,
        createdBy: "telegram",
      },
      p,
      now
    );
  },

  /** Horarios del día con los lugares que quedan; sirve al portal y al bot. */
  async availability(date: string, partySize: number, p: ScheduleParams = defaultParams, now = new Date()): Promise<SlotDTO[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      throw AppError.validation("Fecha inválida", [{ field: "date", issue: "Use el formato AAAA-MM-DD" }]);
    }
    const slots = slotsOfDay(date, p);
    const first = slots[0]!;
    const last = slots[slots.length - 1]!;
    const active = await reservationRepository.findActiveInRange(
      addMinutes(first, -p.stayMinutes),
      addMinutes(last, p.stayMinutes)
    );

    return slots.map((start) => {
      const used = active.filter((r) => overlapsStay(start, r.reservedFor, p)).reduce((s, r) => s + r.partySize, 0);
      const remainingSeats = Math.max(p.capacity - used, 0);
      return {
        startsAt: start.toISOString(),
        remainingSeats,
        available: checkLead(start, now) === "ok" && remainingSeats >= partySize,
      };
    });
  },

  async list(filter: { status?: ReservationStatus; date?: string }, actor: Actor): Promise<ReservationDTO[]> {
    let from: Date | undefined;
    let to: Date | undefined;
    if (filter.date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filter.date) || Number.isNaN(Date.parse(filter.date))) {
        throw AppError.validation("Fecha inválida", [{ field: "date", issue: "Use el formato AAAA-MM-DD" }]);
      }
      const [y, m, d] = filter.date.split("-").map(Number) as [number, number, number];
      from = new Date(y, m - 1, d);
      to = new Date(y, m - 1, d + 1);
    }
    const rows = await reservationRepository.findMany({
      customerUserId: seesAll(actor) ? undefined : actor.userId,
      status: filter.status,
      from,
      to,
    });
    return rows.map(toDTO);
  },

  async get(id: string, actor: Actor): Promise<ReservationDTO> {
    return toDTO(await getAccessible(id, actor));
  },

  async changeStatus(
    id: string,
    input: UpdateReservationStatusInput,
    actor: Actor,
    now = new Date()
  ): Promise<ReservationDTO> {
    const reservation = await getAccessible(id, actor);
    const target = input.status;

    const permission = requiredPermission(reservation.status, target);
    if (!permission) {
      throw AppError.conflict(`Transición no permitida: ${reservation.status} -> ${target}`);
    }
    if (!hasPermission(actor.role, permission)) {
      throw AppError.forbidden(`Su rol no puede cambiar una reservación de ${reservation.status} a ${target}`);
    }
    if (input.tableId && target !== "arrived") {
      throw AppError.validation("Datos de entrada inválidos", [
        { field: "tableId", issue: "La mesa solo se asigna al registrar la llegada" },
      ]);
    }

    if (target === "cancelled" && !seesAll(actor) && !customerMayCancel(reservation.reservedFor, now)) {
      throw AppError.conflict("Puedes cancelar hasta 1 hora antes; comunícate con el restaurante");
    }
    if (target === "arrived" && !arrivalMayBeRecorded(reservation.reservedFor, now)) {
      throw AppError.conflict("La llegada se registra desde 1 hora antes de la hora reservada");
    }
    if (target === "no_show" && !isNoShowAllowed(reservation.reservedFor, now)) {
      throw AppError.conflict("Solo se marca 'no se presentó' 15 minutos después de la hora de llegada");
    }

    const data: Parameters<typeof reservationRepository.update>[1] = { status: target };
    if (target === "arrived") {
      data.arrivedAt = now;
      if (input.tableId) {
        const table = await menuClient.getTable(input.tableId, actor.token, actor.requestId);
        if (!table) throw AppError.notFound("Mesa");
        data.tableId = table.id;
        data.tableNumber = table.number;
      }
    }

    const updated = await reservationRepository.update(id, data);
    if (target === "cancelled") emitEvent("reservation.cancelled", eventPayload(updated));
    return toDTO(updated);
  },

  // ---- Uso interno (bot de Telegram) ----

  /** Próximas reservaciones de quien escribe al bot (por cuenta vinculada o por chat). */
  async upcomingForChat(chatId: string, requestId: string, now = new Date()): Promise<ReservationDTO[]> {
    const customer = await customerClient.getByChat(chatId, requestId);
    const rows = await reservationRepository.findUpcoming(
      { customerUserId: customer?.userId, telegramChatId: chatId },
      now
    );
    return rows.map(toDTO);
  },

  async cancelFromTelegram(code: string, chatId: string, requestId: string, now = new Date()): Promise<ReservationDTO> {
    const reservation = await reservationRepository.findByCode(code.trim().toUpperCase());
    if (!reservation) throw AppError.notFound("Reservación");

    let owns = reservation.telegramChatId === chatId;
    if (!owns && reservation.customerUserId) {
      const customer = await customerClient.getByChat(chatId, requestId);
      owns = customer?.userId === reservation.customerUserId;
    }
    // Para quien no es el dueño, la reservación "no existe".
    if (!owns) throw AppError.notFound("Reservación");

    if (reservation.status !== "confirmed") {
      throw AppError.conflict("Esa reservación ya no se puede cancelar");
    }
    if (!customerMayCancel(reservation.reservedFor, now)) {
      throw AppError.conflict("Puedes cancelar hasta 1 hora antes; comunícate con el restaurante");
    }

    const updated = await reservationRepository.update(reservation.id, { status: "cancelled" });
    emitEvent("reservation.cancelled", eventPayload(updated));
    return toDTO(updated);
  },

  /**
   * Avisa a los clientes cuya reservación está por llegar ("ya casi es la hora").
   * Cada reservación se avisa UNA sola vez, aunque se ejecute varias veces o haya
   * dos instancias: el aviso se reclama de forma atómica antes de enviarlo.
   * Devuelve cuántos avisos se enviaron.
   */
  async runReminders(now = new Date(), p: ScheduleParams = defaultParams): Promise<number> {
    const due = await reservationRepository.findDueForReminder(now, addMinutes(now, p.reminderMinutes));
    let sent = 0;
    for (const reservation of due) {
      if (!reminderDue(reservation.reservedFor, now, p)) continue;
      if (!(await reservationRepository.claimReminder(reservation.id, now))) continue;
      emitEvent("reservation.reminder", eventPayload(reservation));
      sent++;
    }
    return sent;
  },
};
