import { AppError, hasPermission, type Role } from "@resto/core";
import { emitEvent } from "@resto/http";
import type {
  CounterPaymentMethod,
  CreateOnlineOrderInput,
  CreateOrderInput,
  DishDTO,
  OrderDTO,
  OrderStatus,
  PaymentConfirmedInput,
} from "@resto/contracts";
import { customerClient } from "../clients/customer.client.js";
import { menuClient, type CallContext } from "../clients/menu.client.js";
import {
  ACTIVE_STATUSES,
  computeTotals,
  isFinal,
  mergeItems,
  requiredPermission,
} from "../domain/orderRules.js";
import {
  orderRepository,
  type OrderWithItems,
} from "../repositories/order.repository.js";

/** Quién hace la petición y con qué credenciales (para llamar a otros servicios). */
export interface Actor extends CallContext {
  userId: string;
  role: Role;
}

/** Código corto legible para el cliente (los 6 primeros caracteres del id). */
export const orderCode = (id: string) => id.slice(0, 6).toUpperCase();

function toDTO(order: OrderWithItems): OrderDTO {
  return {
    id: order.id,
    code: orderCode(order.id),
    tableId: order.tableId,
    waiterId: order.waiterId,
    channel: order.channel,
    customerUserId: order.customerUserId,
    customerName: order.customerName,
    status: order.status,
    notes: order.notes,
    items: order.items.map((i) => ({
      id: i.id,
      dishId: i.dishId,
      dishName: i.dishName,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      lineTotalCents: i.unitPriceCents * i.quantity,
    })),
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    paymentMethod: order.paymentMethod,
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

async function getOrThrow(id: string): Promise<OrderWithItems> {
  const order = await orderRepository.findById(id);
  if (!order) throw AppError.notFound("Pedido");
  return order;
}

/** Valida cada platillo contra el Menu Service y toma de ahí el precio (nunca del cliente). */
async function buildItems(inputItems: CreateOrderInput["items"], ctx: CallContext) {
  const lines = mergeItems(inputItems);
  const dishes = await Promise.all(lines.map((l) => menuClient.getDish(l.dishId, ctx)));

  return lines.map((line, i) => {
    const dish: DishDTO | null | undefined = dishes[i];
    if (!dish) throw AppError.notFound("Platillo");
    if (!dish.available) {
      throw AppError.conflict(`El platillo "${dish.name}" no está disponible`);
    }
    return {
      dishId: dish.id,
      dishName: dish.name,
      unitPriceCents: dish.priceCents,
      quantity: line.quantity,
    };
  });
}

/**
 * El cliente terminó de consumir y el pedido quedó pagado: se avisa al
 * Notification Service, que le manda el resumen del consumo (descripción,
 * importes y método de pago) y le pregunta si va a facturar.
 */
function announcePaid(order: OrderWithItems): void {
  if (!order.customerUserId || !order.paymentMethod) return;
  emitEvent("order.paid", {
    orderId: order.id,
    orderCode: orderCode(order.id),
    customerUserId: order.customerUserId,
    items: order.items.map((i) => ({
      name: i.dishName,
      quantity: i.quantity,
      lineTotalCents: i.unitPriceCents * i.quantity,
    })),
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    paymentMethod: order.paymentMethod,
    channel: order.channel,
  });
}

/**
 * CAPA 3 — SERVICE
 * Lógica de negocio de pedidos: valida contra el Menu Service, calcula
 * totales y gobierna el ciclo de vida con una máquina de estados.
 * Dos canales: pedido en mesa (lo toma el personal) y pedido en línea para
 * recoger (lo hace el propio cliente). El pago en línea llega por el Payment Service.
 */
export const orderService = {
  /** Pedido en mesa, tomado por el personal. Puede ligarse a un cliente registrado. */
  async create(input: CreateOrderInput, actor: Actor): Promise<OrderDTO> {
    const table = await menuClient.getTable(input.tableId, actor);
    if (!table) throw AppError.notFound("Mesa");

    const activeOrder = await orderRepository.findActiveByTable(
      input.tableId,
      ACTIVE_STATUSES
    );
    if (activeOrder) {
      throw AppError.conflict(`La mesa ${table.number} ya tiene un pedido activo`);
    }

    let customerName: string | null = null;
    if (input.customerUserId) {
      const customer = await customerClient.getByUser(input.customerUserId, actor.requestId);
      if (!customer) throw AppError.notFound("Cliente");
      customerName = customer.fullName;
    }

    const items = await buildItems(input.items, actor);

    const order = await orderRepository.create({
      tableId: input.tableId,
      waiterId: actor.userId,
      channel: "dine_in",
      customerUserId: input.customerUserId ?? null,
      customerName,
      notes: input.notes,
      items,
      ...computeTotals(items),
    });

    await menuClient.setTableStatus(input.tableId, "occupied", actor);
    return toDTO(order);
  },

  /** Pedido en línea para recoger, hecho por el propio cliente. */
  async createOnline(input: CreateOnlineOrderInput, actor: Actor): Promise<OrderDTO> {
    const customer = await customerClient.getByUser(actor.userId, actor.requestId);
    if (!customer) {
      throw AppError.conflict("Completa tu perfil de cliente (nombre y teléfono) antes de pedir en línea");
    }

    const items = await buildItems(input.items, actor);

    const order = await orderRepository.create({
      tableId: null,
      waiterId: null,
      channel: "pickup",
      customerUserId: actor.userId,
      customerName: customer.fullName,
      notes: input.notes,
      items,
      ...computeTotals(items),
    });
    return toDTO(order);
  },

  async list(filter: { status?: OrderStatus; tableId?: string }) {
    return (await orderRepository.findMany(filter)).map(toDTO);
  },

  async get(id: string): Promise<OrderDTO> {
    return toDTO(await getOrThrow(id));
  },

  /** Pedidos del propio cliente. */
  async listMine(actor: Actor): Promise<OrderDTO[]> {
    return (await orderRepository.findMany({ customerUserId: actor.userId })).map(toDTO);
  },

  /** Un cliente solo ve sus pedidos: el de otro "no existe" (404, no 403). */
  async getMine(id: string, actor: Actor): Promise<OrderDTO> {
    const order = await getOrThrow(id);
    if (order.customerUserId !== actor.userId) throw AppError.notFound("Pedido");
    return toDTO(order);
  },

  async changeStatus(
    id: string,
    target: OrderStatus,
    actor: Actor,
    paymentMethod?: CounterPaymentMethod
  ): Promise<OrderDTO> {
    const order = await getOrThrow(id);

    const permission = requiredPermission(order.status, target);
    if (!permission) {
      throw AppError.conflict(
        `Transición no permitida: ${order.status} -> ${target}`
      );
    }
    if (!hasPermission(actor.role, permission)) {
      throw AppError.forbidden(
        `Su rol no puede cambiar un pedido de ${order.status} a ${target}`
      );
    }

    if (target === "cancelled" && order.paidAt) {
      throw AppError.conflict("El pedido ya está pagado en línea; coordina el reembolso con el restaurante");
    }

    // Un pedido ya pagado en línea no tiene nada que cobrar al entregarlo: pasa directo a pagado.
    let finalTarget: OrderStatus = target;
    if (target === "served" && order.paidAt) finalTarget = "paid";

    let data: { status: OrderStatus; paymentMethod?: "cash" | "card" | "online"; paidAt?: Date } = {
      status: finalTarget,
    };
    if (target === "paid") {
      // Cobro en mostrador: el cajero indica cómo pagó el cliente.
      if (!paymentMethod) {
        throw AppError.validation("Datos de entrada inválidos", [
          { field: "paymentMethod", issue: "Indica el método de pago (efectivo o tarjeta)" },
        ]);
      }
      data = { status: "paid", paymentMethod, paidAt: new Date() };
    }

    const updated = await orderRepository.update(id, data);

    if (isFinal(finalTarget) && order.tableId) {
      await menuClient.setTableStatus(order.tableId, "free", actor);
    }

    if (finalTarget === "ready" && updated.customerUserId) {
      emitEvent("order.ready", {
        orderId: updated.id,
        orderCode: orderCode(updated.id),
        customerUserId: updated.customerUserId,
      });
    }
    if (finalTarget === "paid") announcePaid(updated);

    return toDTO(updated);
  },

  // ---- Uso interno (Payment Service) ----

  async getInternal(id: string): Promise<OrderDTO> {
    return toDTO(await getOrThrow(id));
  },

  /**
   * La pasarela confirmó un pago en línea. Es idempotente: si el pedido ya estaba
   * pagado no cambia nada. Si ya se había servido, queda pagado de una vez.
   */
  async confirmPayment(id: string, input: PaymentConfirmedInput): Promise<OrderDTO> {
    const order = await getOrThrow(id);
    if (order.paidAt) return toDTO(order);
    if (order.status === "cancelled") {
      throw AppError.conflict("El pedido está cancelado; el pago requiere reembolso");
    }

    const nowPaid = order.status === "served";
    const updated = await orderRepository.update(id, {
      paymentMethod: "online",
      paidAt: input.paidAt ?? new Date(),
      ...(nowPaid ? { status: "paid" as const } : {}),
    });

    if (nowPaid) {
      if (order.tableId) {
        await menuClient.setTableStatusInternal(order.tableId, "free", `payment-${input.paymentId}`);
      }
      announcePaid(updated);
    }
    return toDTO(updated);
  },
};
