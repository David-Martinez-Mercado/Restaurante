import { describe, expect, it } from "vitest";
import {
  computeTotals,
  mergeItems,
  requiredPermission,
} from "../domain/orderRules.js";

describe("computeTotals", () => {
  it("suma renglones y aplica 16% de IVA", () => {
    const totals = computeTotals([
      { unitPriceCents: 8500, quantity: 2 }, // 17000
      { unitPriceCents: 3000, quantity: 1 }, // 3000
    ]);
    expect(totals).toEqual({
      subtotalCents: 20000,
      taxCents: 3200,
      totalCents: 23200,
    });
  });

  it("redondea el impuesto al centavo", () => {
    // 999 * 0.16 = 159.84 -> 160
    expect(computeTotals([{ unitPriceCents: 999, quantity: 1 }]).taxCents).toBe(160);
  });
});

describe("mergeItems", () => {
  it("une renglones repetidos del mismo platillo", () => {
    const merged = mergeItems([
      { dishId: "a", quantity: 1 },
      { dishId: "b", quantity: 2 },
      { dishId: "a", quantity: 3 },
    ]);
    expect(merged).toEqual([
      { dishId: "a", quantity: 4 },
      { dishId: "b", quantity: 2 },
    ]);
  });

  it("no muta el arreglo original", () => {
    const original = [
      { dishId: "a", quantity: 1 },
      { dishId: "a", quantity: 1 },
    ];
    mergeItems(original);
    expect(original[0]!.quantity).toBe(1);
  });
});

describe("requiredPermission (máquina de estados)", () => {
  it("permite el flujo normal con el permiso de cada paso", () => {
    expect(requiredPermission("pending", "preparing")).toBe("orders:prepare");
    expect(requiredPermission("preparing", "ready")).toBe("orders:prepare");
    expect(requiredPermission("ready", "served")).toBe("orders:serve");
    expect(requiredPermission("served", "paid")).toBe("orders:pay");
  });

  it("permite cancelar solo antes de servir", () => {
    expect(requiredPermission("pending", "cancelled")).toBe("orders:cancel");
    expect(requiredPermission("preparing", "cancelled")).toBe("orders:cancel");
    expect(requiredPermission("ready", "cancelled")).toBeNull();
    expect(requiredPermission("served", "cancelled")).toBeNull();
  });

  it("rechaza saltos y retrocesos", () => {
    expect(requiredPermission("pending", "paid")).toBeNull();
    expect(requiredPermission("pending", "served")).toBeNull();
    expect(requiredPermission("ready", "preparing")).toBeNull();
  });

  it("los estados finales no tienen salida", () => {
    expect(requiredPermission("paid", "pending")).toBeNull();
    expect(requiredPermission("cancelled", "pending")).toBeNull();
  });
});
