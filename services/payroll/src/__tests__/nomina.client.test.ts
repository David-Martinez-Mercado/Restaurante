import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";

const { nominaClient } = await import("../clients/nomina.client.js");

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("cliente del motor de nómina externo (SistemaNomina)", () => {
  it("da de alta con los nombres de campo del original (baseSalary en pesos)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { id: 5, name: "Ana", position: "Mesera", baseSalary: 12000 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await nominaClient.createEmployee({ name: "Ana", position: "Mesera", baseSalaryPesos: 12000 })).toBe(5);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:3102/employees");
    expect(JSON.parse(init.body)).toEqual({ name: "Ana", position: "Mesera", baseSalary: 12000 });
  });

  it("manda la incidencia con los campos del original", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(201, { id: 9 }));
    vi.stubGlobal("fetch", fetchMock);

    await nominaClient.createIncident({ employeeId: 5, period: "2030-06", type: "OVERTIME", hoursOrDays: 4, amountPesos: 400 });

    expect(fetchMock.mock.calls[0]![0]).toBe("http://127.0.0.1:3104/incidents");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ employeeId: 5, period: "2030-06", type: "OVERTIME", hoursOrDays: 4, amount: 400 });
  });

  it("generate valida lo que devuelve el motor y aplica 0 a lo opcional", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, [{ employeeId: 1, baseSalary: 100, isr: 1, imss: 2, infonavit: 3, subsidio: 0, netPay: 94 }])));
    const [line] = await nominaClient.generate("2030-06");
    expect(line).toMatchObject({ employeeId: 1, netPay: 94, overtimePay: 0, absenceDeduction: 0 });
  });

  it("una respuesta con otra forma se rechaza con 502 (el autor cambió su API)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, [{ nombre: "x" }])));
    await expect(nominaClient.generate("2030-06")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("un 500 del motor es 502; un 503 o no poder conectar es 'servicio no disponible'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, { error: "boom" })));
    await expect(nominaClient.generate("2030-06")).rejects.toMatchObject({ statusCode: 502 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(503)));
    await expect(nominaClient.generate("2030-06")).rejects.toMatchObject({ statusCode: 503 });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(nominaClient.createEmployee({ name: "A", position: "B", baseSalaryPesos: 1 })).rejects.toMatchObject({ statusCode: 503 });
  });

  it("borrar una incidencia que ya no existe (500 del original) no es error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, { error: "No record" })));
    await expect(nominaClient.deleteIncident(40)).resolves.toBeUndefined();
  });

  it("ping: true si responden empleados e incidencias; false si alguno falla", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, [])));
    expect(await nominaClient.ping()).toBe(true);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await nominaClient.ping()).toBe(false);
  });
});
