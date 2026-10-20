import { describe, expect, it } from "vitest";
import {
  centsToPesos,
  computeAdjustments,
  currentPeriod,
  dailyWageCents,
  lastDayOf,
  pesosToCents,
} from "../domain/payroll.js";

const CFG = { overtimeMultiplier: 2, dailyHours: 8 };
const SALARY = 1_200_000; // $12,000.00 al mes

describe("salario diario y por hora", () => {
  it("el día vale sueldo mensual / 30", () => {
    expect(dailyWageCents(SALARY)).toBe(40_000);
  });
});

describe("computeAdjustments", () => {
  it("la hora extra se paga doble: 12,000 / 30 / 8 = $50 por hora normal -> 4 h = $400", () => {
    expect(computeAdjustments({ monthlySalaryCents: SALARY, overtimeHours: 4, absences: 0 }, CFG)).toEqual({
      overtimePayCents: 40_000,
      absenceDeductionCents: 0,
    });
  });

  it("cada falta descuenta un día de salario ($400)", () => {
    expect(computeAdjustments({ monthlySalaryCents: SALARY, overtimeHours: 0, absences: 2 }, CFG).absenceDeductionCents).toBe(80_000);
  });

  it("horas extra en fracción y redondeo al centavo", () => {
    // 1.5 h × $50 × 2 = $150
    expect(computeAdjustments({ monthlySalaryCents: SALARY, overtimeHours: 1.5, absences: 0 }, CFG).overtimePayCents).toBe(15_000);
    // 0.33 h × (1,000,000/30/8 = 4166.67 c) × 2 = 2750 c
    expect(computeAdjustments({ monthlySalaryCents: 1_000_000, overtimeHours: 0.33, absences: 0 }, CFG).overtimePayCents).toBe(2750);
  });

  it("el múltiplo es configurable (triple)", () => {
    expect(computeAdjustments({ monthlySalaryCents: SALARY, overtimeHours: 2, absences: 0 }, { ...CFG, overtimeMultiplier: 3 }).overtimePayCents).toBe(30_000);
  });

  it("el descuento por faltas nunca pasa del sueldo mensual", () => {
    expect(computeAdjustments({ monthlySalaryCents: SALARY, overtimeHours: 0, absences: 45 }, CFG).absenceDeductionCents).toBe(SALARY);
  });

  it("sin horas ni faltas no hay ajustes", () => {
    expect(computeAdjustments({ monthlySalaryCents: SALARY, overtimeHours: 0, absences: 0 }, CFG)).toEqual({ overtimePayCents: 0, absenceDeductionCents: 0 });
  });

  it("valores negativos nunca producen pagos negativos", () => {
    const r = computeAdjustments({ monthlySalaryCents: SALARY, overtimeHours: -3, absences: -1 }, CFG);
    expect(r).toEqual({ overtimePayCents: 0, absenceDeductionCents: 0 });
  });
});

describe("conversión pesos <-> centavos (el motor externo trabaja en pesos con decimales)", () => {
  it("redondea al centavo sin errores de punto flotante", () => {
    expect(pesosToCents(0.1 + 0.2)).toBe(30);
    expect(pesosToCents(9703.13)).toBe(970_313);
    expect(pesosToCents(296.875)).toBe(29_688);
    expect(centsToPesos(970_313)).toBe(9703.13);
  });
});

describe("isRealDate", () => {
  it("acepta fechas reales y rechaza las imposibles (31 de febrero, mes 13, formato malo)", async () => {
    const { isRealDate } = await import("../domain/payroll.js");
    expect(isRealDate("2030-02-28")).toBe(true);
    expect(isRealDate("2032-02-29")).toBe(true);
    expect(isRealDate("2030-02-29")).toBe(false);
    expect(isRealDate("2030-02-31")).toBe(false);
    expect(isRealDate("2030-13-01")).toBe(false);
    expect(isRealDate("01/06/2030")).toBe(false);
  });
});

describe("periodos", () => {
  it("periodo actual y último día del mes (incluye bisiesto)", () => {
    expect(currentPeriod(new Date(2030, 5, 15))).toBe("2030-06");
    expect(currentPeriod(new Date(2031, 0, 1))).toBe("2031-01");
    expect(lastDayOf("2030-06")).toBe("2030-06-30");
    expect(lastDayOf("2032-02")).toBe("2032-02-29");
    expect(lastDayOf("2031-02")).toBe("2031-02-28");
  });
});
