import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";

vi.mock("../repositories/reservation.repository.js", () => ({
  reservationRepository: {
    createIfAvailable: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    codeExists: vi.fn(),
    findMany: vi.fn(),
    findUpcoming: vi.fn(),
    findActiveInRange: vi.fn(),
    update: vi.fn(),
    findDueForReminder: vi.fn(),
    claimReminder: vi.fn(),
  },
}));
vi.mock("../clients/customer.client.js", () => ({
  customerClient: { getByUser: vi.fn(), getByChat: vi.fn() },
}));
vi.mock("../clients/menu.client.js", () => ({
  menuClient: { getTable: vi.fn() },
}));
vi.mock("@resto/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@resto/http")>()),
  emitEvent: vi.fn(),
}));

const { emitEvent } = await import("@resto/http");
const { reservationRepository } = await import("../repositories/reservation.repository.js");
const { customerClient } = await import("../clients/customer.client.js");
const { menuClient } = await import("../clients/menu.client.js");
const { reservationService } = await import("../services/reservation.service.js");
type ScheduleParams = import("../domain/schedule.js").ScheduleParams;

const P: ScheduleParams = {
  openMinutes: 13 * 60, lastMinutes: 22 * 60, slotMinutes: 30, stayMinutes: 120, capacity: 40, reminderMinutes: 30,
};

// Lunes 3 de junio de 2030, 10:00 (hora local).
const NOW = new Date(2030, 5, 3, 10, 0, 0, 0);
const at = (h: number, m = 0, day = 4) => new Date(2030, 5, day, h, m, 0, 0);

const CUSTOMER_USER = "11111111-1111-4111-8111-111111111111";
const customer = { userId: CUSTOMER_USER, role: "customer" as const, token: "tc", requestId: "r1" };
const other = { ...customer, userId: "22222222-2222-4222-8222-222222222222" };
const waiter = { userId: "w1", role: "waiter" as const, token: "tw", requestId: "r2" };
const manager = { userId: "m1", role: "manager" as const, token: "tm", requestId: "r3" };

const profile = {
  id: "cu1", userId: CUSTOMER_USER, fullName: "Ana López", phone: "5512345678",
  telegramLinked: true, telegramUsername: "ana", billing: null, createdAt: "", updatedAt: "", telegramChatId: "777",
};

const stored = (o: Record<string, unknown> = {}) =>
  ({
    id: "a1b2c3d4-0000-4000-8000-000000000001", code: "ABC234", customerUserId: CUSTOMER_USER, customerName: "Ana López",
    phone: "5512345678", telegramChatId: null, partySize: 4, reservedFor: at(20, 0), status: "confirmed", source: "web",
    tableId: null, tableNumber: null, notes: null, arrivedAt: null, reminderSentAt: null, createdBy: CUSTOMER_USER,
    createdAt: NOW, updatedAt: NOW, ...o,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reservationRepository.codeExists).mockResolvedValue(false);
  vi.mocked(reservationRepository.createIfAvailable).mockImplementation(
    // El servicio genera el localizador; aquí se fija para poder afirmarlo.
    async (data) => ({ ok: true, reservation: stored({ ...data, code: "ABC234" }) }) as never
  );
  vi.mocked(customerClient.getByUser).mockResolvedValue(profile);
  vi.mocked(customerClient.getByChat).mockResolvedValue(null);
});

describe("create · cliente en línea", () => {
  const input = { reservedFor: at(20, 0), partySize: 4 };

  it("reserva a nombre de su propio perfil, con la HORA DE LLEGADA indicada", async () => {
    const result = await reservationService.create(input, customer, P, NOW);

    expect(reservationRepository.createIfAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        customerUserId: CUSTOMER_USER, customerName: "Ana López", phone: "5512345678",
        reservedFor: at(20, 0), partySize: 4, source: "web",
      }),
      P
    );
    expect(result.reservedFor).toBe(at(20, 0).toISOString());
    expect(result.code).toBe("ABC234");
  });

  it("emite reservation.confirmed (sin llaves en null)", async () => {
    await reservationService.create(input, customer, P, NOW);

    expect(emitEvent).toHaveBeenCalledWith(
      "reservation.confirmed",
      expect.objectContaining({ code: "ABC234", customerUserId: CUSTOMER_USER, partySize: 4, reservedFor: at(20, 0).toISOString() })
    );
    const payload = vi.mocked(emitEvent).mock.calls[0]![1];
    expect(payload.telegramChatId).toBeUndefined();
  });

  it("ignora el nombre o la cuenta que mande un cliente: reserva siempre para sí mismo", async () => {
    await reservationService.create(
      { ...input, customerName: "Otra Persona", customerUserId: "99999999-9999-4999-8999-999999999999", phone: "5500000000" },
      customer,
      P,
      NOW
    );
    expect(customerClient.getByUser).toHaveBeenCalledWith(CUSTOMER_USER, "r1");
    expect(reservationRepository.createIfAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ customerUserId: CUSTOMER_USER, customerName: "Ana López" }),
      P
    );
  });

  it("409 si todavía no completó su perfil", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(null);
    await expect(reservationService.create(input, customer, P, NOW)).rejects.toMatchObject({ statusCode: 409 });
    expect(reservationRepository.createIfAvailable).not.toHaveBeenCalled();
  });

  it("422 con una hora de llegada fuera de horario o fuera de bloque", async () => {
    for (const reservedFor of [at(12, 30), at(22, 30), at(20, 15)]) {
      await expect(reservationService.create({ ...input, reservedFor }, customer, P, NOW)).rejects.toMatchObject({ statusCode: 422 });
    }
    expect(reservationRepository.createIfAvailable).not.toHaveBeenCalled();
  });

  it("409 con menos de 30 min de anticipación y con más de 60 días", async () => {
    await expect(
      reservationService.create({ ...input, reservedFor: at(13, 0, 3) }, customer, P, new Date(2030, 5, 3, 12, 45))
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      reservationService.create({ ...input, reservedFor: new Date(2030, 8, 20, 20, 0) }, customer, P, NOW)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("409 si no hay aforo (con el número de lugares que quedan) o si ya tiene otra a esa hora", async () => {
    vi.mocked(reservationRepository.createIfAvailable).mockResolvedValue({ ok: false, reason: "capacity", remaining: 3 });
    await expect(reservationService.create(input, customer, P, NOW)).rejects.toThrow(/solo quedan 3/);

    vi.mocked(reservationRepository.createIfAvailable).mockResolvedValue({ ok: false, reason: "capacity", remaining: 0 });
    await expect(reservationService.create(input, customer, P, NOW)).rejects.toThrow(/No hay lugares/);

    vi.mocked(reservationRepository.createIfAvailable).mockResolvedValue({ ok: false, reason: "duplicate" });
    await expect(reservationService.create(input, customer, P, NOW)).rejects.toThrow(/se traslapa/);
    expect(emitEvent).not.toHaveBeenCalled();
  });
});

describe("create · personal en mostrador", () => {
  const input = { reservedFor: at(20, 0), partySize: 2 };

  it("exige nombre y teléfono si no se elige un cliente registrado (422)", async () => {
    await expect(reservationService.create(input, waiter, P, NOW)).rejects.toMatchObject({ statusCode: 422 });
    await expect(reservationService.create({ ...input, customerName: "Luis Pérez" }, waiter, P, NOW)).rejects.toMatchObject({ statusCode: 422 });
  });

  it("reserva con nombre y teléfono (origen 'staff')", async () => {
    await reservationService.create({ ...input, customerName: "Luis Pérez", phone: "5598765432" }, waiter, P, NOW);
    expect(reservationRepository.createIfAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: "Luis Pérez", phone: "5598765432", customerUserId: null, source: "staff", createdBy: "w1" }),
      P
    );
  });

  it("con un cliente registrado toma su nombre y teléfono del perfil", async () => {
    await reservationService.create({ ...input, customerUserId: CUSTOMER_USER }, manager, P, NOW);
    expect(reservationRepository.createIfAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ customerUserId: CUSTOMER_USER, customerName: "Ana López" }),
      P
    );
  });

  it("404 si el cliente elegido no existe", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(null);
    await expect(reservationService.create({ ...input, customerUserId: CUSTOMER_USER }, waiter, P, NOW)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("createFromTelegram · reservar por el bot", () => {
  const input = { telegramChatId: "777", reservedFor: at(20, 0), partySize: 3 };

  it("si el chat está vinculado, la reservación queda a nombre del cliente", async () => {
    vi.mocked(customerClient.getByChat).mockResolvedValue(profile);
    await reservationService.createFromTelegram(input, "r", P, NOW);

    expect(reservationRepository.createIfAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ customerUserId: CUSTOMER_USER, customerName: "Ana López", telegramChatId: "777", source: "telegram" }),
      P
    );
  });

  it("un invitado sin cuenta debe dar su nombre (422) y reserva con su chat", async () => {
    await expect(reservationService.createFromTelegram(input, "r", P, NOW)).rejects.toMatchObject({ statusCode: 422 });

    await reservationService.createFromTelegram({ ...input, customerName: "Beto Ruiz" }, "r", P, NOW);
    expect(reservationRepository.createIfAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ customerUserId: null, customerName: "Beto Ruiz", telegramChatId: "777", phone: null }),
      P
    );
    expect(emitEvent).toHaveBeenCalledWith("reservation.confirmed", expect.objectContaining({ telegramChatId: "777" }));
  });

  it("aplica las mismas reglas de horario que el portal", async () => {
    await expect(
      reservationService.createFromTelegram({ ...input, customerName: "Beto Ruiz", reservedFor: at(23, 0) }, "r", P, NOW)
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("availability", () => {
  it("resta del aforo a los comensales de las reservaciones que se traslapan", async () => {
    vi.mocked(reservationRepository.findActiveInRange).mockResolvedValue([
      stored({ reservedFor: at(20, 0), partySize: 30 }),
      stored({ reservedFor: at(21, 30), partySize: 8 }),
    ]);

    const slots = await reservationService.availability("2030-06-04", 4, P, NOW);
    const by = (h: number, m = 0) => slots.find((s) => s.startsAt === at(h, m).toISOString())!;

    expect(slots).toHaveLength(19);
    expect(by(13, 0)).toMatchObject({ remainingSeats: 40, available: true });
    expect(by(20, 0)).toMatchObject({ remainingSeats: 2, available: false }); // 40 - 30 - 8 (21:30 también se traslapa)
    // A las 22:00 ya solo cuenta la de las 21:30: la de las 20:00 terminó (2 h de estancia exactas).
    expect(by(22, 0)).toMatchObject({ remainingSeats: 32, available: true });
    // A las 18:00 la de las 20:00 apenas empieza cuando esa estancia termina: no se traslapa.
    expect(by(18, 0)).toMatchObject({ remainingSeats: 40, available: true });
  });

  it("marca como no disponible lo que ya no cumple los 30 minutos de anticipación", async () => {
    vi.mocked(reservationRepository.findActiveInRange).mockResolvedValue([]);
    const slots = await reservationService.availability("2030-06-03", 2, P, new Date(2030, 5, 3, 13, 20));
    expect(slots.find((s) => s.startsAt === at(13, 30, 3).toISOString())!.available).toBe(false); // faltan 10 min
    expect(slots.find((s) => s.startsAt === at(14, 0, 3).toISOString())!.available).toBe(true);
  });

  it("422 con una fecha inválida", async () => {
    await expect(reservationService.availability("hoy", 2, P, NOW)).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("propiedad de las reservaciones", () => {
  it("un cliente no ve la reservación de otro (404, no 403)", async () => {
    vi.mocked(reservationRepository.findById).mockResolvedValue(stored());
    await expect(reservationService.get("x", other)).rejects.toMatchObject({ statusCode: 404 });
    await expect(reservationService.get("x", customer)).resolves.toMatchObject({ code: "ABC234" });
  });

  it("el personal ve cualquiera, y la lista de un cliente se filtra por su cuenta", async () => {
    vi.mocked(reservationRepository.findById).mockResolvedValue(stored());
    await expect(reservationService.get("x", waiter)).resolves.toMatchObject({ code: "ABC234" });

    vi.mocked(reservationRepository.findMany).mockResolvedValue([]);
    await reservationService.list({}, customer);
    expect(reservationRepository.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ customerUserId: CUSTOMER_USER }));
    await reservationService.list({}, waiter);
    expect(vi.mocked(reservationRepository.findMany).mock.lastCall![0].customerUserId).toBeUndefined();
  });
});

describe("changeStatus", () => {
  const change = (actor: typeof customer | typeof waiter, status: string, extra = {}, now = NOW) =>
    reservationService.changeStatus("x", { status, ...extra } as never, actor, now);

  beforeEach(() => {
    vi.mocked(reservationRepository.findById).mockResolvedValue(stored());
    vi.mocked(reservationRepository.update).mockImplementation(async (_id, data) => stored(data as Record<string, unknown>));
  });

  it("el cliente cancela la suya con más de 1 h de anticipación y se emite reservation.cancelled", async () => {
    await expect(change(customer, "cancelled")).resolves.toMatchObject({ status: "cancelled" });
    expect(emitEvent).toHaveBeenCalledWith("reservation.cancelled", expect.objectContaining({ code: "ABC234" }));
  });

  it("el cliente NO cancela con menos de 1 h (409); el personal sí", async () => {
    const late = new Date(2030, 5, 4, 19, 30);
    await expect(change(customer, "cancelled", {}, late)).rejects.toMatchObject({ statusCode: 409 });
    await expect(change(waiter, "cancelled", {}, late)).resolves.toMatchObject({ status: "cancelled" });
  });

  it("el cliente no puede registrar llegada ni 'no se presentó' (403)", async () => {
    await expect(change(customer, "arrived", {}, at(20, 0))).rejects.toMatchObject({ statusCode: 403 });
    await expect(change(customer, "no_show", {}, at(21, 0))).rejects.toMatchObject({ statusCode: 403 });
  });

  it("otro cliente no puede cancelar la reservación ajena (404)", async () => {
    await expect(change(other, "cancelled")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("el mesero registra la llegada con la HORA REAL y la mesa asignada", async () => {
    vi.mocked(menuClient.getTable).mockResolvedValue({ id: "t1", number: 6, capacity: 4, status: "free", createdAt: "", updatedAt: "" });
    const arrival = at(20, 5);

    await change(waiter, "arrived", { tableId: "33333333-3333-4333-8333-333333333333" }, arrival);

    expect(reservationRepository.update).toHaveBeenCalledWith(
      "x",
      expect.objectContaining({ status: "arrived", arrivedAt: arrival, tableId: "t1", tableNumber: 6 })
    );
  });

  it("la llegada se registra desde 1 h antes (409 si es más temprano) y 404 si la mesa no existe", async () => {
    await expect(change(waiter, "arrived", {}, at(18, 30))).rejects.toMatchObject({ statusCode: 409 });

    vi.mocked(menuClient.getTable).mockResolvedValue(null);
    await expect(change(waiter, "arrived", { tableId: "33333333-3333-4333-8333-333333333333" }, at(20, 0))).rejects.toMatchObject({ statusCode: 404 });
  });

  it("'no se presentó' solo 15 min después de la hora", async () => {
    await expect(change(waiter, "no_show", {}, at(20, 10))).rejects.toMatchObject({ statusCode: 409 });
    await expect(change(waiter, "no_show", {}, at(20, 16))).resolves.toMatchObject({ status: "no_show" });
  });

  it("la mesa solo se asigna al registrar la llegada (422) y no hay saltos de estado (409)", async () => {
    await expect(change(waiter, "no_show", { tableId: "33333333-3333-4333-8333-333333333333" }, at(21, 0))).rejects.toMatchObject({ statusCode: 422 });
    await expect(change(waiter, "completed", {}, at(21, 0))).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("bot: consultar y cancelar por Telegram", () => {
  it("lista las próximas por cuenta vinculada y por chat", async () => {
    vi.mocked(customerClient.getByChat).mockResolvedValue(profile);
    vi.mocked(reservationRepository.findUpcoming).mockResolvedValue([stored()]);

    const result = await reservationService.upcomingForChat("777", "r", NOW);

    expect(reservationRepository.findUpcoming).toHaveBeenCalledWith({ customerUserId: CUSTOMER_USER, telegramChatId: "777" }, NOW);
    expect(result).toHaveLength(1);
  });

  it("cancela por localizador solo si es suya (por chat o por cuenta vinculada)", async () => {
    vi.mocked(reservationRepository.findByCode).mockResolvedValue(stored({ telegramChatId: "777" }));
    vi.mocked(reservationRepository.update).mockResolvedValue(stored({ status: "cancelled" }));
    await expect(reservationService.cancelFromTelegram("abc234", "777", "r", NOW)).resolves.toMatchObject({ status: "cancelled" });

    vi.mocked(customerClient.getByChat).mockResolvedValue(profile);
    vi.mocked(reservationRepository.findByCode).mockResolvedValue(stored({ telegramChatId: null }));
    await expect(reservationService.cancelFromTelegram("ABC234", "555", "r", NOW)).resolves.toBeTruthy();

    vi.mocked(customerClient.getByChat).mockResolvedValue(null);
    await expect(reservationService.cancelFromTelegram("ABC234", "999", "r", NOW)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("no cancela con menos de 1 h ni una ya cancelada (409)", async () => {
    vi.mocked(reservationRepository.findByCode).mockResolvedValue(stored({ telegramChatId: "777" }));
    await expect(reservationService.cancelFromTelegram("ABC234", "777", "r", new Date(2030, 5, 4, 19, 30))).rejects.toMatchObject({ statusCode: 409 });

    vi.mocked(reservationRepository.findByCode).mockResolvedValue(stored({ telegramChatId: "777", status: "cancelled" }));
    await expect(reservationService.cancelFromTelegram("ABC234", "777", "r", NOW)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("runReminders · aviso de 'ya casi es la hora'", () => {
  const nowNear = at(19, 40); // faltan 20 min para las 20:00

  it("avisa a las reservaciones por llegar, una sola vez cada una", async () => {
    vi.mocked(reservationRepository.findDueForReminder).mockResolvedValue([stored()]);
    vi.mocked(reservationRepository.claimReminder).mockResolvedValue(true);

    expect(await reservationService.runReminders(nowNear, P)).toBe(1);

    expect(reservationRepository.findDueForReminder).toHaveBeenCalledWith(nowNear, new Date(nowNear.getTime() + 30 * 60_000));
    expect(reservationRepository.claimReminder).toHaveBeenCalledWith("a1b2c3d4-0000-4000-8000-000000000001", nowNear);
    expect(emitEvent).toHaveBeenCalledWith("reservation.reminder", expect.objectContaining({ code: "ABC234", partySize: 4 }));
  });

  it("si otra ejecución ya reclamó el aviso, no se envía de nuevo", async () => {
    vi.mocked(reservationRepository.findDueForReminder).mockResolvedValue([stored()]);
    vi.mocked(reservationRepository.claimReminder).mockResolvedValue(false);

    expect(await reservationService.runReminders(nowNear, P)).toBe(0);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("no avisa si todavía falta más de lo configurado", async () => {
    vi.mocked(reservationRepository.findDueForReminder).mockResolvedValue([stored()]);
    vi.mocked(reservationRepository.claimReminder).mockResolvedValue(true);

    expect(await reservationService.runReminders(at(18, 0), P)).toBe(0);
    expect(reservationRepository.claimReminder).not.toHaveBeenCalled();
  });

  it("sin reservaciones por avisar no hace nada", async () => {
    vi.mocked(reservationRepository.findDueForReminder).mockResolvedValue([]);
    expect(await reservationService.runReminders(nowNear, P)).toBe(0);
  });
});
