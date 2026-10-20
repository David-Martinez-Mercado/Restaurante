import type { Permission } from "@resto/core";
import type { OrderStatus } from "@resto/contracts";
import { GENERAL_IVA_PERCENT, addIva } from "./tax.js";

/** IVA México. Los precios del menú se guardan SIN impuesto. */
export const TAX_RATE = GENERAL_IVA_PERCENT / 100;

export interface PricedLine {
  unitPriceCents: number;
  quantity: number;
}

export function computeTotals(lines: PricedLine[]) {
  const subtotalCents = lines.reduce(
    (sum, l) => sum + l.unitPriceCents * l.quantity,
    0
  );
  // Una sola fórmula de IVA para los pedidos y para la calculadora.
  const { ivaCents, totalCents } = addIva(subtotalCents, GENERAL_IVA_PERCENT);
  return { subtotalCents, taxCents: ivaCents, totalCents };
}

/** Une renglones repetidos del mismo platillo sumando sus cantidades. */
export function mergeItems<T extends { dishId: string; quantity: number }>(
  items: T[]
): T[] {
  const merged = new Map<string, T>();
  for (const item of items) {
    const existing = merged.get(item.dishId);
    if (existing) existing.quantity += item.quantity;
    else merged.set(item.dishId, { ...item });
  }
  return [...merged.values()];
}

/**
 * Máquina de estados del pedido. Cada transición exige un permiso distinto:
 * así la cocina no puede cobrar ni el cajero marcar platillos como listos.
 *
 *   pending -> preparing -> ready -> served -> paid
 *       \________\_______________________________/
 *                  cancelled (solo antes de servir)
 */
const TRANSITIONS: Record<
  OrderStatus,
  Partial<Record<OrderStatus, Permission>>
> = {
  pending: { preparing: "orders:prepare", cancelled: "orders:cancel" },
  preparing: { ready: "orders:prepare", cancelled: "orders:cancel" },
  ready: { served: "orders:serve" },
  served: { paid: "orders:pay" },
  paid: {},
  cancelled: {},
};

/** Permiso requerido para pasar de `from` a `to`, o null si no es válida. */
export function requiredPermission(
  from: OrderStatus,
  to: OrderStatus
): Permission | null {
  return TRANSITIONS[from][to] ?? null;
}

export const ACTIVE_STATUSES: OrderStatus[] = [
  "pending",
  "preparing",
  "ready",
  "served",
];

export function isFinal(status: OrderStatus): boolean {
  return status === "paid" || status === "cancelled";
}
