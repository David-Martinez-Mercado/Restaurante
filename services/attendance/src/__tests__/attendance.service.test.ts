import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";

vi.mock("../repositories/attendance.repository.js", () => ({
  attendanceRepository: {
    openIfNone: vi.fn(),
    findOpen: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findOverlapping: vi.fn(),
    findBetween: vi.fn(),
    firstClockIns: vi.fn(),
  },
}));

const { attendanceRepository } = await import("../repositories/attendance.repository.js");
const { attendanceService } = await import("../services/attendance.service.js");
type Rules = import("../domain/attendance.js").AttendanceRules;

const RULES: Rules = { workdays: [1, 2, 3, 4, 5, 6], dailyHours: 8, staleShiftHours: 16, minShiftMinutes: 1 };
const at = (day: number, h = 0, m = 0) => new Date(2030, 5, day, h, m, 0, 0);
const NOW = at(11, 15, 0); // martes 11 de junio de 2030, 15:00

const ana = { userId: "11111111-1111-4111-8111-111111111111", username: "ana", role: "waiter" as const };
const boss = { userId: "99999999-9999-4999-8999-999999999999", username: "jefe", role: "manager" as const };

const rec = (o: Record<string, unknown> = {}) =>
  ({
    id: "a1", userId: ana.userId, username: "ana", clockIn: at(11, 9), clockOut: null, source: "self", note: null,
    createdBy: ana.userId, updatedBy: null, createdAt: at(11, 9), updatedAt: at(11, 9), ...o,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(attendanceRepository.findOverlapping).mockResolvedValue([]);
  vi.mocked(attendanceRepository.findBetween).mockResolvedValue([]);
  vi.mocked(attendanceRepository.firstClockIns).mockResolvedValue(new Map());
});

describe("clockIn", () => {
  it("abre la jornada con la hora actual y la identidad de quien checa (viene del token)", async () => {
    vi.mocked(attendanceRepository.openIfNone).mockResolvedValue({ ok: true, record: rec({ clockIn: NOW }) });

    const dto = await attendanceService.clockIn(ana, NOW, RULES);

    expect(attendanceRepository.openIfNone).toHaveBeenCalledWith({
      userId: ana.userId, username: "ana", clockIn: NOW, source: "self", createdBy: ana.userId,
    });
    expect(dto).toMatchObject({ clockOut: null, minutes: null, source: "self" });
  });

  it("409 si ya tiene una entrada abierta, diciendo desde qué hora", async () => {
    vi.mocked(attendanceRepository.openIfNone).mockResolvedValue({ ok: false, open: rec({ clockIn: at(11, 9, 5) }) });
    await expect(attendanceService.clockIn(ana, NOW, RULES)).rejects.toThrow(/desde las 09:05/);
  });

  it("si la abierta es vieja (olvidó la salida) pide corrección al gerente", async () => {
    vi.mocked(attendanceRepository.openIfNone).mockResolvedValue({ ok: false, open: rec({ clockIn: at(9, 9) }) });
    await expect(attendanceService.clockIn(ana, NOW, RULES)).rejects.toThrow(/pide a tu gerente que la corrija/);
  });
});

describe("clockOut", () => {
  it("cierra la jornada abierta con la hora actual", async () => {
    vi.mocked(attendanceRepository.findOpen).mockResolvedValue(rec({ clockIn: at(11, 9) }));
    vi.mocked(attendanceRepository.update).mockResolvedValue(rec({ clockIn: at(11, 9), clockOut: NOW }));

    const dto = await attendanceService.clockOut(ana, NOW, RULES);

    expect(attendanceRepository.update).toHaveBeenCalledWith("a1", { clockOut: NOW });
    expect(dto.minutes).toBe(360);
  });

  it("409 sin entrada abierta", async () => {
    vi.mocked(attendanceRepository.findOpen).mockResolvedValue(null);
    await expect(attendanceService.clockOut(ana, NOW, RULES)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("409 si apenas checó entrada (doble clic)", async () => {
    vi.mocked(attendanceRepository.findOpen).mockResolvedValue(rec({ clockIn: new Date(NOW.getTime() - 20_000) }));
    await expect(attendanceService.clockOut(ana, NOW, RULES)).rejects.toThrow(/Acabas de checar/);
    expect(attendanceRepository.update).not.toHaveBeenCalled();
  });

  it("409 si la entrada lleva más de 16 h: no se inventan 30 horas, se corrige", async () => {
    vi.mocked(attendanceRepository.findOpen).mockResolvedValue(rec({ clockIn: at(10, 9) }));
    await expect(attendanceService.clockOut(ana, NOW, RULES)).rejects.toThrow(/más de 16 horas/);
    expect(attendanceRepository.update).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  it("suma las jornadas cerradas de hoy más la abierta", async () => {
    vi.mocked(attendanceRepository.findOpen).mockResolvedValue(rec({ id: "b", clockIn: at(11, 13) }));
    vi.mocked(attendanceRepository.findBetween).mockResolvedValue([
      rec({ id: "a", clockIn: at(11, 8), clockOut: at(11, 12) }), // 4 h
      rec({ id: "b", clockIn: at(11, 13), clockOut: null }), // 2 h hasta las 15:00
    ]);

    const s = await attendanceService.status(ana, NOW, RULES);

    expect(s.todayMinutes).toBe(360);
    expect(s.open?.id).toBe("b");
    expect(s.stale).toBe(false);
  });

  it("una entrada olvidada no infla las horas de hoy y se marca como 'stale'", async () => {
    vi.mocked(attendanceRepository.findOpen).mockResolvedValue(rec({ clockIn: at(9, 9) }));
    const s = await attendanceService.status(ana, NOW, RULES);
    expect(s).toMatchObject({ todayMinutes: 0, stale: true });
  });

  it("sin jornada abierta", async () => {
    vi.mocked(attendanceRepository.findOpen).mockResolvedValue(null);
    expect(await attendanceService.status(ana, NOW, RULES)).toEqual({ open: null, todayMinutes: 0, stale: false });
  });
});

describe("correcciones del gerente", () => {
  const input = { userId: ana.userId, username: "ana", clockIn: at(10, 9), clockOut: at(10, 17), note: "Olvidó checar" };

  it("captura una jornada manual con motivo y deja quién la capturó", async () => {
    vi.mocked(attendanceRepository.create).mockResolvedValue(rec({ source: "manual", clockIn: at(10, 9), clockOut: at(10, 17), note: "Olvidó checar" }));

    const dto = await attendanceService.manualCreate(input, boss, NOW);

    expect(attendanceRepository.create).toHaveBeenCalledWith(expect.objectContaining({ source: "manual", createdBy: boss.userId, note: "Olvidó checar" }));
    expect(dto).toMatchObject({ source: "manual", minutes: 480 });
  });

  it("422 si es del futuro, y 422 si dura más de 24 h", async () => {
    await expect(attendanceService.manualCreate({ ...input, clockIn: at(12, 9), clockOut: at(12, 17) }, boss, NOW)).rejects.toMatchObject({ statusCode: 422 });
    await expect(attendanceService.manualCreate({ ...input, clockIn: at(8, 9), clockOut: at(9, 12) }, boss, NOW)).rejects.toMatchObject({ statusCode: 422 });
    expect(attendanceRepository.create).not.toHaveBeenCalled();
  });

  it("409 si se traslapa con otra jornada de esa persona", async () => {
    vi.mocked(attendanceRepository.findOverlapping).mockResolvedValue([rec({ clockIn: at(10, 12), clockOut: at(10, 20) })]);
    await expect(attendanceService.manualCreate(input, boss, NOW)).rejects.toThrow(/Se traslapa/);
    expect(attendanceRepository.create).not.toHaveBeenCalled();
  });

  it("corrige la salida de una jornada olvidada (y la marca como manual)", async () => {
    vi.mocked(attendanceRepository.findById).mockResolvedValue(rec({ clockIn: at(10, 9) }));
    vi.mocked(attendanceRepository.update).mockResolvedValue(rec({ clockIn: at(10, 9), clockOut: at(10, 18), source: "manual" }));

    await attendanceService.edit("a1", { clockOut: at(10, 18), note: "Salió a las 6" }, boss, NOW);

    expect(attendanceRepository.update).toHaveBeenCalledWith("a1", {
      clockIn: at(10, 9), clockOut: at(10, 18), source: "manual", note: "Salió a las 6", updatedBy: boss.userId,
    });
    // al validar el traslape se excluye la propia jornada
    expect(attendanceRepository.findOverlapping).toHaveBeenCalledWith(ana.userId, at(10, 9), at(10, 18), "a1");
  });

  it("puede reabrir una jornada (salida = null)", async () => {
    vi.mocked(attendanceRepository.findById).mockResolvedValue(rec({ clockIn: at(11, 9), clockOut: at(11, 10) }));
    vi.mocked(attendanceRepository.update).mockResolvedValue(rec());
    await attendanceService.edit("a1", { clockOut: null, note: "Se cerró por error" }, boss, NOW);
    expect(attendanceRepository.update).toHaveBeenCalledWith("a1", expect.objectContaining({ clockOut: null }));
  });

  it("404 si el registro no existe", async () => {
    vi.mocked(attendanceRepository.findById).mockResolvedValue(null);
    await expect(attendanceService.edit("x", { note: "motivo" }, boss, NOW)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("422 si la nueva salida queda antes de la entrada", async () => {
    vi.mocked(attendanceRepository.findById).mockResolvedValue(rec({ clockIn: at(10, 9) }));
    await expect(attendanceService.edit("a1", { clockOut: at(10, 8), note: "motivo" }, boss, NOW)).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("resúmenes", () => {
  it("resumen del personal: una fila por persona, ordenada, con faltas desde su primera entrada", async () => {
    vi.mocked(attendanceRepository.findBetween).mockResolvedValue([
      rec({ id: "1", userId: "u2", username: "beto", clockIn: at(4, 9), clockOut: at(4, 19) }),
      rec({ id: "2", userId: "u1", username: "ana", clockIn: at(3, 9), clockOut: at(3, 17) }),
      rec({ id: "3", userId: "u1", username: "ana", clockIn: at(4, 9), clockOut: at(4, 17) }),
    ]);
    vi.mocked(attendanceRepository.firstClockIns).mockResolvedValue(new Map([["u1", at(3, 9)], ["u2", at(4, 9)]]));

    const s = await attendanceService.summary("2030-06", NOW, RULES);

    expect(s.rows.map((r) => r.username)).toEqual(["ana", "beto"]);
    expect(s.rows[0]).toMatchObject({ hoursWorked: 16, overtimeHours: 0, daysWorked: 2 });
    expect(s.rows[1]).toMatchObject({ hoursWorked: 10, overtimeHours: 2 });
    // beto empezó el 4: no se le cuentan el 1 ni el 3
    expect(s.rows[1]!.absenceDates).not.toContain("2030-06-03");
    expect(s.rules).toEqual({ workdays: [1, 2, 3, 4, 5, 6], dailyHours: 8, staleShiftHours: 16 });
  });

  it("resumen de una persona con fecha de ingreso (la manda Nómina) cuenta desde ahí aunque no tenga registros", async () => {
    const row = await attendanceService.summaryOf("u9", "carla", "2030-06", "2030-06-01", NOW, RULES);
    expect(row).toMatchObject({ userId: "u9", username: "carla", hoursWorked: 0, absences: 8 });
    expect(attendanceRepository.firstClockIns).not.toHaveBeenCalled();
  });

  it("sin fecha de ingreso y sin registros no inventa faltas", async () => {
    const row = await attendanceService.summaryOf("u9", "carla", "2030-06", undefined, NOW, RULES);
    expect(row.absences).toBe(0);
  });
});
