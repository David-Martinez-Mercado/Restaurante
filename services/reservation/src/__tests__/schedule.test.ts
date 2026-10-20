import { describe, expect, it } from "vitest";
import {
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

const P: ScheduleParams = {
  openMinutes: 13 * 60,
  lastMinutes: 22 * 60,
  slotMinutes: 30,
  stayMinutes: 120,
  capacity: 40,
  reminderMinutes: 30,
};

// 3 de junio de 2030 (hora local).
const at = (h: number, m = 0, day = 3) => new Date(2030, 5, day, h, m, 0, 0);

describe("isValidArrival (hora de llegada)", () => {
  it("acepta bloques de 30 min entre la apertura y la última llegada", () => {
    for (const [h, m] of [[13, 0], [13, 30], [18, 0], [21, 30], [22, 0]] as const) {
      expect(isValidArrival(at(h, m), P)).toBe(true);
    }
  });

  it("rechaza antes de abrir, después de la última llegada y minutos fuera de bloque", () => {
    expect(isValidArrival(at(12, 30), P)).toBe(false);
    expect(isValidArrival(at(22, 30), P)).toBe(false);
    expect(isValidArrival(at(13, 15), P)).toBe(false);
    expect(isValidArrival(at(18, 45), P)).toBe(false);
  });

  it("rechaza segundos o milisegundos sueltos y fechas inválidas", () => {
    expect(isValidArrival(new Date(2030, 5, 3, 18, 0, 5), P)).toBe(false);
    expect(isValidArrival(new Date(2030, 5, 3, 18, 0, 0, 7), P)).toBe(false);
    expect(isValidArrival(new Date("no es fecha"), P)).toBe(false);
  });

  it("respeta otra configuración de bloques (cada 15 min desde las 12:00)", () => {
    const q = { ...P, openMinutes: 12 * 60, slotMinutes: 15 };
    expect(isValidArrival(at(12, 45), q)).toBe(true);
    expect(isValidArrival(at(12, 40), q)).toBe(false);
  });
});

describe("slotsOfDay", () => {
  it("genera 19 llegadas de 13:00 a 22:00 cada 30 min", () => {
    const slots = slotsOfDay("2030-06-03", P);
    expect(slots).toHaveLength(19);
    expect(slots[0]).toEqual(at(13, 0));
    expect(slots[18]).toEqual(at(22, 0));
  });
});

describe("checkLead", () => {
  const now = at(10, 0);
  it("exige al menos 30 minutos de anticipación", () => {
    expect(checkLead(at(10, 29), now)).toBe("too_soon");
    expect(checkLead(at(10, 30), now)).toBe("ok");
  });

  it("no permite más de 60 días", () => {
    expect(checkLead(new Date(now.getTime() + 59 * 86_400_000), now)).toBe("ok");
    expect(checkLead(new Date(now.getTime() + 61 * 86_400_000), now)).toBe("too_far");
  });
});

describe("traslape de estancias (aforo)", () => {
  it("dos llegadas con menos de 2 h de diferencia comparten mesa; con 2 h o más, no", () => {
    expect(overlapsStay(at(13, 0), at(14, 30), P)).toBe(true);
    expect(overlapsStay(at(13, 0), at(14, 59), P)).toBe(true);
    expect(overlapsStay(at(13, 0), at(15, 0), P)).toBe(false);
    expect(overlapsStay(at(15, 0), at(13, 0), P)).toBe(false);
  });
});

describe("ventanas de tiempo", () => {
  const start = at(20, 0);

  it("el cliente cancela hasta 1 hora antes", () => {
    expect(customerMayCancel(start, at(19, 0))).toBe(true);
    expect(customerMayCancel(start, at(19, 1))).toBe(false);
  });

  it("la llegada se registra desde 1 hora antes", () => {
    expect(arrivalMayBeRecorded(start, at(18, 59))).toBe(false);
    expect(arrivalMayBeRecorded(start, at(19, 0))).toBe(true);
    expect(arrivalMayBeRecorded(start, at(21, 0))).toBe(true);
  });

  it("'no se presentó' solo 15 minutos después de la hora", () => {
    expect(isNoShowAllowed(start, at(20, 14))).toBe(false);
    expect(isNoShowAllowed(start, at(20, 15))).toBe(true);
  });
});

describe("reminderDue (ya casi es la hora)", () => {
  const start = at(20, 0);

  it("avisa cuando faltan 30 minutos o menos y la hora no ha pasado", () => {
    expect(reminderDue(start, at(19, 29), P)).toBe(false);
    expect(reminderDue(start, at(19, 30), P)).toBe(true);
    expect(reminderDue(start, at(19, 59), P)).toBe(true);
  });

  it("no avisa si la hora ya pasó", () => {
    expect(reminderDue(start, at(20, 0), P)).toBe(false);
    expect(reminderDue(start, at(20, 10), P)).toBe(false);
  });

  it("respeta otra anticipación (60 min)", () => {
    expect(reminderDue(start, at(19, 0), { ...P, reminderMinutes: 60 })).toBe(true);
    expect(reminderDue(start, at(18, 59), { ...P, reminderMinutes: 60 })).toBe(false);
  });
});

describe("máquina de estados", () => {
  it("cada transición exige su permiso", () => {
    expect(requiredPermission("confirmed", "arrived")).toBe("reservations:manage");
    expect(requiredPermission("confirmed", "no_show")).toBe("reservations:manage");
    expect(requiredPermission("confirmed", "cancelled")).toBe("reservations:create");
    expect(requiredPermission("arrived", "completed")).toBe("reservations:manage");
  });

  it("no hay saltos, retrocesos ni salida de estados finales", () => {
    expect(requiredPermission("confirmed", "completed")).toBeNull();
    expect(requiredPermission("arrived", "cancelled")).toBeNull();
    expect(requiredPermission("completed", "confirmed")).toBeNull();
    expect(requiredPermission("cancelled", "confirmed")).toBeNull();
    expect(requiredPermission("no_show", "arrived")).toBeNull();
  });
});

describe("generateCode", () => {
  it("genera localizadores de 6 caracteres sin letras ambiguas", () => {
    let i = 0;
    for (let n = 0; n < 200; n++) {
      expect(generateCode((max) => (i++ * 7) % max)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});
