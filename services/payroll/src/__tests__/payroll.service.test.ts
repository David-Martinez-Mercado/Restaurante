import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";

vi.mock("../repositories/payroll.repository.js", () => ({
  payrollRepository: {
    listCompensations: vi.fn(),
    findCompensation: vi.fn(),
    upsertCompensation: vi.fn(),
    setExternal: vi.fn(),
    listRuns: vi.fn(),
    findRun: vi.fn(),
    saveRun: vi.fn(),
    approve: vi.fn(),
    approvedLinesOf: vi.fn(),
    incidentsOf: vi.fn(),
    forgetIncidents: vi.fn(),
    rememberIncident: vi.fn(),
  },
}));
vi.mock("../clients/nomina.client.js", () => ({
  nominaClient: { ping: vi.fn(), createEmployee: vi.fn(), createIncident: vi.fn(), deleteIncident: vi.fn(), generate: vi.fn() },
}));
vi.mock("../clients/attendance.client.js", () => ({ attendanceClient: { summary: vi.fn() } }));

const { payrollRepository } = await import("../repositories/payroll.repository.js");
const { nominaClient } = await import("../clients/nomina.client.js");
const { attendanceClient } = await import("../clients/attendance.client.js");
const { payrollService } = await import("../services/payroll.service.js");

const NOW = new Date(2030, 5, 30, 18, 0, 0); // 30 de junio de 2030
const PAY = { overtimeMultiplier: 2, dailyHours: 8 };
const manager = { userId: "m1", username: "jefe", role: "manager" as const, requestId: "r1" };
const admin = { userId: "a1", username: "admin", role: "admin" as const, requestId: "r2" };

const comp = (o: Record<string, unknown> = {}) =>
  ({
    userId: "u1", fullName: "Ana López", position: "Mesera", monthlySalaryCents: 1_200_000, hireDate: "2030-06-01", active: true,
    externalEmployeeId: null, externalSalaryCents: null, createdAt: NOW, updatedAt: NOW, ...o,
  }) as never;

const att = (o: Record<string, unknown> = {}) =>
  ({ userId: "u1", username: "Ana", daysWorked: 20, hoursWorked: 180, overtimeHours: 0, absences: 0, absenceDates: [], openShifts: 0, ...o }) as never;

const ext = (o: Record<string, unknown>) => ({
  employeeId: 11, baseSalary: 12000, isr: 1875, imss: 296.875, infonavit: 625, subsidio: 0, netPay: 9703.13, overtimePay: 0, absenceDeduction: 0, ...o,
});

const savedRun = (lines: object[], o: Record<string, unknown> = {}) =>
  ({ id: "run1", period: "2030-06", status: "calculated", generatedBy: "m1", approvedBy: null, approvedAt: null, createdAt: NOW, updatedAt: NOW, lines, ...o }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(payrollRepository.findRun).mockResolvedValue(null);
  vi.mocked(payrollRepository.incidentsOf).mockResolvedValue([]);
  vi.mocked(nominaClient.ping).mockResolvedValue(true);
  vi.mocked(nominaClient.createEmployee).mockResolvedValue(11);
  vi.mocked(nominaClient.createIncident).mockResolvedValueOnce(501).mockResolvedValueOnce(502).mockResolvedValue(503);
  vi.mocked(payrollRepository.saveRun).mockImplementation(async (_p, _by, lines) => savedRun(lines.map((l) => ({ ...l, id: "l" }))));
});

describe("calculate · flujo completo con el motor externo", () => {
  beforeEach(() => {
    vi.mocked(payrollRepository.listCompensations).mockResolvedValue([comp(), comp({ userId: "u2", fullName: "Beto Ruiz", position: "Cocinero", externalEmployeeId: 7, externalSalaryCents: 1_200_000 })]);
    vi.mocked(attendanceClient.summary)
      .mockResolvedValueOnce(att({ overtimeHours: 4, absences: 1, hoursWorked: 190 }))
      .mockResolvedValueOnce(att({ userId: "u2" }));
    vi.mocked(nominaClient.generate).mockResolvedValue([
      ext({ employeeId: 11, overtimePay: 400, absenceDeduction: 400, netPay: 9703.13 }),
      ext({ employeeId: 7, netPay: 9703.13 }),
      ext({ employeeId: 99 }), // empleado ajeno del motor: se ignora
    ]);
  });

  it("da de alta en el motor solo a quien aún no está (sueldo en PESOS) y recuerda su id", async () => {
    await payrollService.calculate("2030-06", manager, NOW, PAY);

    expect(nominaClient.createEmployee).toHaveBeenCalledTimes(1);
    expect(nominaClient.createEmployee).toHaveBeenCalledWith({ name: "Ana López", position: "Mesera", baseSalaryPesos: 12000 });
    expect(payrollRepository.setExternal).toHaveBeenCalledWith("u1", 11, 1_200_000);
  });

  it("si cambió el sueldo vuelve a dar de alta (el motor original no permite editar empleados)", async () => {
    vi.mocked(payrollRepository.listCompensations).mockResolvedValue([comp({ externalEmployeeId: 7, externalSalaryCents: 1_000_000 })]);
    vi.mocked(attendanceClient.summary).mockReset().mockResolvedValue(att());
    vi.mocked(nominaClient.generate).mockResolvedValue([ext({ employeeId: 11 })]);

    await payrollService.calculate("2030-06", manager, NOW, PAY);

    expect(nominaClient.createEmployee).toHaveBeenCalledWith(expect.objectContaining({ baseSalaryPesos: 12000 }));
    expect(payrollRepository.setExternal).toHaveBeenCalledWith("u1", 11, 1_200_000);
  });

  it("pide al checador el resumen de cada quien desde su fecha de ingreso", async () => {
    await payrollService.calculate("2030-06", manager, NOW, PAY);
    expect(attendanceClient.summary).toHaveBeenCalledWith({ userId: "u1", username: "Ana López", period: "2030-06", since: "2030-06-01" }, "r1");
  });

  it("manda al motor horas extra (doble) y faltas con NUESTRAS reglas, en pesos", async () => {
    await payrollService.calculate("2030-06", manager, NOW, PAY);

    expect(nominaClient.createIncident).toHaveBeenCalledTimes(2); // la otra persona no tiene incidencias
    expect(nominaClient.createIncident).toHaveBeenCalledWith({ employeeId: 11, period: "2030-06", type: "OVERTIME", hoursOrDays: 4, amountPesos: 400 });
    expect(nominaClient.createIncident).toHaveBeenCalledWith({ employeeId: 11, period: "2030-06", type: "ABSENCE", hoursOrDays: 1, amountPesos: 400 });
    expect(payrollRepository.rememberIncident).toHaveBeenCalledWith({ period: "2030-06", userId: "u1", kind: "OVERTIME", externalId: 501 });
  });

  it("al RECALCULAR borra primero las incidencias del cálculo anterior (no se duplican)", async () => {
    vi.mocked(payrollRepository.incidentsOf).mockResolvedValue([
      { id: "i1", period: "2030-06", userId: "u1", kind: "OVERTIME", externalId: 40 },
      { id: "i2", period: "2030-06", userId: "u1", kind: "ABSENCE", externalId: 41 },
    ] as never);

    await payrollService.calculate("2030-06", manager, NOW, PAY);

    expect(nominaClient.deleteIncident).toHaveBeenCalledWith(40);
    expect(nominaClient.deleteIncident).toHaveBeenCalledWith(41);
    expect(payrollRepository.forgetIncidents).toHaveBeenCalledWith(["i1", "i2"]);
    const deleteOrder = vi.mocked(nominaClient.deleteIncident).mock.invocationCallOrder[0]!;
    const createOrder = vi.mocked(nominaClient.createIncident).mock.invocationCallOrder[0]!;
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it("guarda las líneas con los importes del motor en CENTAVOS y solo del personal propio", async () => {
    const run = await payrollService.calculate("2030-06", manager, NOW, PAY);

    expect(payrollRepository.saveRun).toHaveBeenCalledWith("2030-06", "m1", expect.any(Array));
    expect(run.lines).toHaveLength(2); // el empleado 99 del motor no entra
    expect(run.lines[0]).toMatchObject({
      userId: "u1", baseSalaryCents: 1_200_000, hoursWorked: 190, overtimeHours: 4, overtimePayCents: 40_000,
      absenceDays: 1, absenceDeductionCents: 40_000, taxableCents: 1_200_000, isrCents: 187_500, imssCents: 29_688,
      infonavitCents: 62_500, subsidioCents: 0, netPayCents: 970_313,
    });
    expect(run.status).toBe("calculated");
    expect(run.totals.netCents).toBe(970_313 * 2);
  });

  it("falla con claridad si el motor no devuelve el cálculo de alguien", async () => {
    vi.mocked(nominaClient.generate).mockResolvedValue([ext({ employeeId: 11 })]);
    await expect(payrollService.calculate("2030-06", manager, NOW, PAY)).rejects.toThrow(/no devolvió el cálculo de Beto Ruiz/);
    expect(payrollRepository.saveRun).not.toHaveBeenCalled();
  });
});

describe("calculate · reglas y errores", () => {
  beforeEach(() => {
    vi.mocked(payrollRepository.listCompensations).mockResolvedValue([comp()]);
    vi.mocked(attendanceClient.summary).mockResolvedValue(att());
  });

  it("422 con un periodo futuro", async () => {
    await expect(payrollService.calculate("2030-07", manager, NOW, PAY)).rejects.toMatchObject({ statusCode: 422 });
    expect(nominaClient.generate).not.toHaveBeenCalled();
  });

  it("409 si la nómina del periodo ya está aprobada: no se recalcula", async () => {
    vi.mocked(payrollRepository.findRun).mockResolvedValue(savedRun([], { status: "approved" }));
    await expect(payrollService.calculate("2030-06", manager, NOW, PAY)).rejects.toMatchObject({ statusCode: 409 });
    expect(nominaClient.generate).not.toHaveBeenCalled();
  });

  it("409 sin trabajadores activos o contratados después del periodo", async () => {
    vi.mocked(payrollRepository.listCompensations).mockResolvedValue([comp({ active: false }), comp({ userId: "u3", hireDate: "2030-07-05" })]);
    await expect(payrollService.calculate("2030-06", manager, NOW, PAY)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("503 y NO toca nada si el motor externo no responde", async () => {
    vi.mocked(nominaClient.ping).mockResolvedValue(false);
    await expect(payrollService.calculate("2030-06", manager, NOW, PAY)).rejects.toMatchObject({ statusCode: 503 });
    expect(nominaClient.createEmployee).not.toHaveBeenCalled();
    expect(nominaClient.createIncident).not.toHaveBeenCalled();
  });

  it("si el checador no responde no se calcula con datos incompletos", async () => {
    vi.mocked(attendanceClient.summary).mockRejectedValue(Object.assign(new Error("down"), { statusCode: 503 }));
    await expect(payrollService.calculate("2030-06", manager, NOW, PAY)).rejects.toMatchObject({ statusCode: 503 });
    expect(nominaClient.generate).not.toHaveBeenCalled();
  });

  it("dos cálculos simultáneos se ejecutan de uno en uno", async () => {
    vi.mocked(nominaClient.generate).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return [ext({ employeeId: 11 })];
    });
    vi.mocked(payrollRepository.listCompensations).mockResolvedValue([comp({ externalEmployeeId: 11, externalSalaryCents: 1_200_000 })]);

    let running = 0;
    let maxRunning = 0;
    vi.mocked(attendanceClient.summary).mockImplementation(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return att();
    });

    await Promise.all([payrollService.calculate("2030-06", manager, NOW, PAY), payrollService.calculate("2030-06", manager, NOW, PAY)]);
    expect(maxRunning).toBe(1);
  });
});

describe("aprobar (separación de funciones)", () => {
  it("quien calculó no puede aprobar su propia nómina (409)", async () => {
    vi.mocked(payrollRepository.findRun).mockResolvedValue(savedRun([], { generatedBy: "m1" }));
    await expect(payrollService.approve("2030-06", { ...manager }, NOW)).rejects.toThrow(/no puede aprobarla/);
    expect(payrollRepository.approve).not.toHaveBeenCalled();
  });

  it("otra persona sí la aprueba, y queda quién y cuándo", async () => {
    vi.mocked(payrollRepository.findRun)
      .mockResolvedValueOnce(savedRun([], { generatedBy: "m1" }))
      .mockResolvedValueOnce(savedRun([], { generatedBy: "m1", status: "approved", approvedBy: "a1", approvedAt: NOW }));
    vi.mocked(payrollRepository.approve).mockResolvedValue(true);

    const run = await payrollService.approve("2030-06", admin, NOW);

    expect(payrollRepository.approve).toHaveBeenCalledWith("2030-06", "a1", NOW);
    expect(run).toMatchObject({ status: "approved", approvedBy: "a1" });
  });

  it("404 si no existe, 409 si ya estaba aprobada o si otra aprobación se adelantó", async () => {
    vi.mocked(payrollRepository.findRun).mockResolvedValueOnce(null);
    await expect(payrollService.approve("2030-06", admin, NOW)).rejects.toMatchObject({ statusCode: 404 });

    vi.mocked(payrollRepository.findRun).mockResolvedValueOnce(savedRun([], { status: "approved" }));
    await expect(payrollService.approve("2030-06", admin, NOW)).rejects.toMatchObject({ statusCode: 409 });

    vi.mocked(payrollRepository.findRun).mockResolvedValueOnce(savedRun([]));
    vi.mocked(payrollRepository.approve).mockResolvedValue(false);
    await expect(payrollService.approve("2030-06", admin, NOW)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("sueldos y recibos", () => {
  it("marca como 'synced' solo a quien ya está en el motor CON ese sueldo", async () => {
    vi.mocked(payrollRepository.listCompensations).mockResolvedValue([
      comp({ externalEmployeeId: 7, externalSalaryCents: 1_200_000 }),
      comp({ userId: "u2", externalEmployeeId: 8, externalSalaryCents: 900_000 }),
      comp({ userId: "u3" }),
    ]);
    expect((await payrollService.listCompensations()).map((c) => c.synced)).toEqual([true, false, false]);
  });

  it("rechaza una fecha de ingreso imposible (422)", async () => {
    await expect(
      payrollService.saveCompensation("u1", { fullName: "Ana López", position: "Mesera", monthlySalaryCents: 1_200_000, hireDate: "2030-02-31", active: true })
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("los recibos son de nóminas aprobadas y solo del usuario que los pide", async () => {
    vi.mocked(payrollRepository.approvedLinesOf).mockResolvedValue([
      { userId: "u1", fullName: "Ana", position: "Mesera", baseSalaryCents: 1, hoursWorked: 1, overtimeHours: 0, overtimePayCents: 0, absenceDays: 0, absenceDeductionCents: 0, taxableCents: 1, isrCents: 0, imssCents: 0, infonavitCents: 0, subsidioCents: 0, netPayCents: 1, run: { period: "2030-05", approvedAt: NOW } },
    ] as never);

    const slips = await payrollService.payslips("u1");

    expect(payrollRepository.approvedLinesOf).toHaveBeenCalledWith("u1");
    expect(slips[0]).toMatchObject({ period: "2030-05", approvedAt: NOW.toISOString() });
  });
});
