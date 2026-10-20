import { describe, expect, it } from "vitest";
import {
  expectedWorkdays,
  isStale,
  localDay,
  minutesBetween,
  overlaps,
  periodBounds,
  summarizeUser,
  type AttendanceRules,
} from "../domain/attendance.js";

// Junio de 2030: el 1 es sábado (se comprueba abajo), así que las fechas de las pruebas son fijas.
const RULES: AttendanceRules = { workdays: [1, 2, 3, 4, 5, 6], dailyHours: 8, staleShiftHours: 16, minShiftMinutes: 1 };
const at = (day: number, h = 0, m = 0) => new Date(2030, 5, day, h, m, 0, 0);
const shift = (day: number, inH: number, outH: number | null) => ({ clockIn: at(day, inH), clockOut: outH === null ? null : at(day, outH) });

describe("calendario de prueba", () => {
  it("1 de junio de 2030 es sábado y 11 es martes", () => {
    expect(at(1).getDay()).toBe(6);
    expect(at(11).getDay()).toBe(2);
  });
});

describe("minutesBetween / localDay / periodBounds", () => {
  it("minutos completos y nunca negativos", () => {
    expect(minutesBetween(at(3, 9), at(3, 17, 30))).toBe(510);
    expect(minutesBetween(at(3, 9), new Date(at(3, 9).getTime() + 59_999))).toBe(0);
    expect(minutesBetween(at(3, 17), at(3, 9))).toBe(0);
  });

  it("fecha local AAAA-MM-DD", () => {
    expect(localDay(new Date(2030, 0, 5, 23, 59))).toBe("2030-01-05");
  });

  it("junio tiene 30 días; febrero bisiesto, 29", () => {
    expect(periodBounds("2030-06").days).toHaveLength(30);
    expect(periodBounds("2032-02").days).toHaveLength(29);
    expect(periodBounds("2030-06").start).toEqual(new Date(2030, 5, 1));
    expect(periodBounds("2030-06").endExclusive).toEqual(new Date(2030, 6, 1));
  });
});

describe("expectedWorkdays", () => {
  it("cuenta lunes a sábado ANTERIORES a hoy y salta los domingos", () => {
    const days = expectedWorkdays("2030-06", RULES, "2030-06-01", "2030-06-11");
    expect(days).toEqual(["2030-06-01", "2030-06-03", "2030-06-04", "2030-06-05", "2030-06-06", "2030-06-07", "2030-06-08", "2030-06-10"]);
  });

  it("hoy no cuenta todavía (el día no ha terminado)", () => {
    expect(expectedWorkdays("2030-06", RULES, "2030-06-01", "2030-06-04")).not.toContain("2030-06-04");
  });

  it("no cuenta nada antes de la fecha de ingreso", () => {
    const days = expectedWorkdays("2030-06", RULES, "2030-06-05", "2030-06-11");
    expect(days[0]).toBe("2030-06-05");
  });

  it("un periodo completamente futuro no tiene faltas", () => {
    expect(expectedWorkdays("2030-07", RULES, "2030-06-01", "2030-06-11")).toEqual([]);
  });

  it("respeta otros días laborables (solo lunes a viernes)", () => {
    const weekdays = expectedWorkdays("2030-06", { ...RULES, workdays: [1, 2, 3, 4, 5] }, "2030-06-01", "2030-06-11");
    expect(weekdays).not.toContain("2030-06-01");
    expect(weekdays).not.toContain("2030-06-08");
  });
});

describe("summarizeUser", () => {
  const ctx = { now: at(11, 10), since: "2030-06-01" };

  it("suma horas por día y detecta las horas extra día por día", () => {
    const s = summarizeUser([shift(3, 9, 17), shift(4, 8, 18), shift(5, 9, 17)], "2030-06", RULES, ctx);
    // 8 h + 10 h + 8 h = 26 h; extra solo el martes (2 h)
    expect(s.hoursWorked).toBe(26);
    expect(s.overtimeHours).toBe(2);
    expect(s.daysWorked).toBe(3);
  });

  it("varias jornadas en el mismo día se suman antes de calcular las extras (turno partido)", () => {
    const s = summarizeUser([shift(4, 8, 13), shift(4, 15, 21)], "2030-06", RULES, ctx);
    expect(s.hoursWorked).toBe(11);
    expect(s.overtimeHours).toBe(3);
    expect(s.daysWorked).toBe(1);
  });

  it("las horas extra de un día no se compensan con otro día corto", () => {
    const s = summarizeUser([shift(3, 9, 14), shift(4, 8, 18)], "2030-06", RULES, ctx);
    expect(s.hoursWorked).toBe(15);
    expect(s.overtimeHours).toBe(2);
  });

  it("falta = día laborable pasado sin ningún registro", () => {
    const worked = [3, 4, 5, 6, 7, 8].map((d) => shift(d, 9, 17));
    const s = summarizeUser(worked, "2030-06", RULES, ctx);
    // esperados: 1, 3,4,5,6,7,8, 10  →  faltaron el 1 y el 10
    expect(s.absenceDates).toEqual(["2030-06-01", "2030-06-10"]);
    expect(s.absences).toBe(2);
  });

  it("sin la fecha de ingreso no se inventan faltas anteriores", () => {
    const s = summarizeUser([shift(10, 9, 17)], "2030-06", RULES, { now: at(11, 10), since: "2030-06-10" });
    expect(s.absences).toBe(0);
  });

  it("una persona sin registros pero con ingreso antiguo acumula todas las faltas", () => {
    const s = summarizeUser([], "2030-06", RULES, ctx);
    expect(s.absences).toBe(8);
    expect(s.hoursWorked).toBe(0);
    expect(s.daysWorked).toBe(0);
  });

  it("una jornada sin salida cuenta como presencia pero NO suma horas", () => {
    const s = summarizeUser([shift(3, 9, 17), shift(4, 9, null)], "2030-06", RULES, ctx);
    expect(s.openShifts).toBe(1);
    expect(s.hoursWorked).toBe(8);
    expect(s.daysWorked).toBe(2);
    expect(s.absenceDates).not.toContain("2030-06-04");
  });

  it("trabajar en domingo cuenta horas pero no es 'falta' no haberlo hecho", () => {
    const s = summarizeUser([shift(2, 9, 17)], "2030-06", RULES, { now: at(3, 8), since: "2030-06-01" });
    expect(s.hoursWorked).toBe(8);
    expect(s.absences).toBe(1); // solo el sábado 1
  });

  it("un turno que cruza la medianoche se atribuye al día de la entrada", () => {
    const s = summarizeUser([{ clockIn: at(7, 20), clockOut: at(8, 4) }], "2030-06", RULES, ctx);
    expect(s.hoursWorked).toBe(8);
    expect(s.daysWorked).toBe(1);
    expect(s.absenceDates).not.toContain("2030-06-07");
    expect(s.absenceDates).toContain("2030-06-08");
  });

  it("redondea las horas a 2 decimales", () => {
    const s = summarizeUser([{ clockIn: at(3, 9, 0), clockOut: at(3, 9, 20) }], "2030-06", RULES, ctx);
    expect(s.hoursWorked).toBe(0.33);
  });
});

describe("isStale / overlaps", () => {
  it("una entrada de más de 16 h se considera olvidada", () => {
    expect(isStale(at(3, 8), at(3, 23, 59), RULES)).toBe(false);
    expect(isStale(at(3, 8), at(4, 0, 1), RULES)).toBe(true);
  });

  it("traslape de jornadas, incluyendo las abiertas (duran para siempre)", () => {
    expect(overlaps(shift(3, 9, 13), shift(3, 12, 18))).toBe(true);
    expect(overlaps(shift(3, 9, 13), shift(3, 13, 18))).toBe(false);
    expect(overlaps(shift(3, 9, null), shift(4, 9, 17))).toBe(true);
    expect(overlaps(shift(5, 9, 17), shift(3, 9, null))).toBe(true);
  });
});
