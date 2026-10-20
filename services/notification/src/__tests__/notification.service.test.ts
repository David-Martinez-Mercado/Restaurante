import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";

vi.mock("../repositories/notification.repository.js", () => ({
  notificationRepository: {
    exists: vi.fn(),
    create: vi.fn(),
    findMine: vi.fn(),
    countUnread: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    findOutbox: vi.fn(),
  },
}));
vi.mock("../clients/customer.client.js", () => ({
  customerClient: { getByUser: vi.fn(), getByChat: vi.fn(), linkTelegram: vi.fn() },
  UpstreamError: class UpstreamError extends Error {},
}));
vi.mock("../telegram/telegram.api.js", () => ({
  telegram: { configured: true, send: vi.fn(), resolveUsername: vi.fn() },
}));

const { notificationRepository } = await import("../repositories/notification.repository.js");
const { customerClient } = await import("../clients/customer.client.js");
const { telegram } = await import("../telegram/telegram.api.js");
const { notificationService } = await import("../services/notification.service.js");
type Event = import("@resto/contracts").NotificationEvent;

const USER = "22222222-2222-4222-8222-222222222222";
const ORDER = "11111111-1111-4111-8111-111111111111";
const RES = "33333333-3333-4333-8333-333333333333";

const ready: Event = { type: "order.ready", orderId: ORDER, orderCode: "A-0042", customerUserId: USER };
const profile = (chat: string | null) =>
  ({ id: "c1", userId: USER, fullName: "Ana", phone: "5512345678", telegramLinked: chat !== null, telegramUsername: null, billing: null, createdAt: "", updatedAt: "", telegramChatId: chat }) as never;

const rowOf = (data: object) => ({ id: "n1", readAt: null, createdAt: new Date("2030-06-04T01:00:00Z"), ...data }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(notificationRepository.exists).mockResolvedValue(false);
  vi.mocked(notificationRepository.create).mockImplementation(async (d) => rowOf(d));
  vi.mocked(telegram.send).mockResolvedValue({ status: "sent" });
});

const created = () => vi.mocked(notificationRepository.create).mock.calls.map((c) => c[0]);

describe("dispatch · pedido listo (en línea)", () => {
  it("guarda el aviso en la campana y lo manda por Telegram si el cliente lo vinculó", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile("777"));

    const result = await notificationService.dispatch(ready);

    expect(result.stored).toBe(2);
    expect(telegram.send).toHaveBeenCalledWith("777", expect.stringContaining("<b>¡Tu pedido está listo!</b>"));
    expect(created()).toEqual([
      expect.objectContaining({ channel: "in_app", delivery: "sent", recipientUserId: USER, dedupeKey: `order.ready:${ORDER}:in_app` }),
      expect.objectContaining({ channel: "telegram", delivery: "sent", recipientChatId: "777", dedupeKey: `order.ready:${ORDER}:telegram` }),
    ]);
  });

  it("sin Telegram vinculado: la campana sí, Telegram queda 'skipped' con el motivo", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile(null));

    await notificationService.dispatch(ready);

    expect(telegram.send).not.toHaveBeenCalled();
    expect(created()[0]).toMatchObject({ channel: "in_app", delivery: "sent" });
    expect(created()[1]).toMatchObject({ channel: "telegram", delivery: "skipped", error: "El cliente no ha vinculado Telegram" });
  });

  it("si el Customer Service está caído, el aviso de la app NO se pierde", async () => {
    vi.mocked(customerClient.getByUser).mockRejectedValue(new Error("down"));

    const result = await notificationService.dispatch(ready);

    expect(result.stored).toBe(2);
    expect(created()[0]).toMatchObject({ channel: "in_app", delivery: "sent" });
    expect(created()[1]).toMatchObject({ channel: "telegram", delivery: "skipped", error: expect.stringContaining("perfil") });
  });

  it("si Telegram rechaza el mensaje queda 'failed' con el error, y la campana igual", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile("777"));
    vi.mocked(telegram.send).mockResolvedValue({ status: "failed", error: "Forbidden: bot was blocked by the user" });

    await notificationService.dispatch(ready);

    expect(created()[0]).toMatchObject({ channel: "in_app", delivery: "sent" });
    expect(created()[1]).toMatchObject({ channel: "telegram", delivery: "failed", error: "Forbidden: bot was blocked by the user" });
  });

  it("modo simulado (sin token) queda registrado como 'simulated'", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile("777"));
    vi.mocked(telegram.send).mockResolvedValue({ status: "simulated" });

    await notificationService.dispatch(ready);

    expect(created()[1]).toMatchObject({ channel: "telegram", delivery: "simulated" });
  });
});

describe("dispatch · idempotencia", () => {
  it("no repite un aviso que ya existe (misma llave) en ningún canal", async () => {
    vi.mocked(notificationRepository.exists).mockResolvedValue(true);

    const result = await notificationService.dispatch(ready);

    expect(result.stored).toBe(0);
    expect(notificationRepository.create).not.toHaveBeenCalled();
    expect(telegram.send).not.toHaveBeenCalled();
    expect(customerClient.getByUser).not.toHaveBeenCalled();
  });

  it("si la restricción única detecta un duplicado simultáneo, no cuenta ese aviso", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile(null));
    vi.mocked(notificationRepository.create).mockResolvedValue(null);

    expect((await notificationService.dispatch(ready)).stored).toBe(0);
  });
});

describe("dispatch · reservaciones", () => {
  const base = { reservationId: RES, code: "ABC234", customerName: "Beto Ruiz", partySize: 2, reservedFor: "2030-06-04T02:00:00Z" };

  it("reservación hecha por Telegram sin cuenta: se avisa directo al chat, sin fila de campana", async () => {
    const result = await notificationService.dispatch({ type: "reservation.confirmed", ...base, telegramChatId: "555" });

    expect(customerClient.getByUser).not.toHaveBeenCalled();
    expect(telegram.send).toHaveBeenCalledWith("555", expect.stringContaining("ABC234"));
    expect(result.stored).toBe(1);
    expect(created()).toEqual([expect.objectContaining({ channel: "telegram", recipientUserId: null, recipientChatId: "555" })]);
  });

  it("reservación de un cliente con cuenta: usa el chat de su perfil", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile("777"));

    await notificationService.dispatch({ type: "reservation.reminder", ...base, customerUserId: USER });

    expect(telegram.send).toHaveBeenCalledWith("777", expect.stringContaining("Tu reservación es en unos minutos"));
  });

  it("si el evento trae chat Y cuenta, manda a ese chat sin consultar el perfil", async () => {
    await notificationService.dispatch({ type: "reservation.cancelled", ...base, customerUserId: USER, telegramChatId: "555" });

    expect(customerClient.getByUser).not.toHaveBeenCalled();
    expect(telegram.send).toHaveBeenCalledWith("555", expect.any(String));
    expect(created().map((c) => c.channel)).toEqual(["in_app", "telegram"]);
  });

  it("el recordatorio de un mostrador sin cuenta ni Telegram no deja filas vacías", async () => {
    const result = await notificationService.dispatch({ type: "reservation.reminder", ...base });
    expect(result.stored).toBe(0);
    expect(notificationRepository.create).not.toHaveBeenCalled();
  });
});

describe("dispatch · resumen del consumo", () => {
  it("manda el consumo con descripción y método de pago, escapando el HTML de los platillos", async () => {
    vi.mocked(customerClient.getByUser).mockResolvedValue(profile("777"));

    await notificationService.dispatch({
      type: "order.paid", orderId: ORDER, orderCode: "A-0042", customerUserId: USER,
      items: [{ name: "Tacos <especiales>", quantity: 3, lineTotalCents: 30000 }],
      subtotalCents: 30000, taxCents: 4800, totalCents: 34800, paymentMethod: "cash", channel: "dine_in",
    });

    const html = vi.mocked(telegram.send).mock.calls[0]![1];
    expect(html).toContain("3 × Tacos &lt;especiales&gt; — $300.00");
    expect(html).toContain("Método de pago: Efectivo");
    expect(html).toContain("¿Vas a facturar?");
  });
});

describe("campana del cliente", () => {
  it("no expone destinatario ni error a quien lee sus propios avisos", async () => {
    vi.mocked(notificationRepository.findMine).mockResolvedValue([
      rowOf({ type: "order.ready", channel: "in_app", delivery: "sent", title: "t", body: "b", recipientUserId: USER, error: "interno" }),
    ]);

    const [dto] = await notificationService.listMine(USER, false);
    expect(dto).toMatchObject({ recipientUserId: null, error: null, readAt: null });
  });

  it("marcar como leído algo ajeno o inexistente es 404", async () => {
    vi.mocked(notificationRepository.markRead).mockResolvedValue(null);
    await expect(notificationService.markRead("x", USER)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("limita la lista a 100 y cuenta las no leídas", async () => {
    vi.mocked(notificationRepository.findMine).mockResolvedValue([]);
    await notificationService.listMine(USER, true, 9999);
    expect(notificationRepository.findMine).toHaveBeenCalledWith(USER, true, 100);

    vi.mocked(notificationRepository.countUnread).mockResolvedValue(3);
    expect(await notificationService.unreadCount(USER)).toBe(3);
  });
});

describe("bitácora del personal", () => {
  it("muestra destinatario y error, y valida los filtros (422)", async () => {
    vi.mocked(notificationRepository.findOutbox).mockResolvedValue([
      rowOf({ type: "order.ready", channel: "telegram", delivery: "failed", title: "t", body: "b", recipientUserId: USER, error: "bloqueado" }),
    ]);

    const [dto] = await notificationService.outbox({ delivery: "failed", limit: 5000 });
    expect(dto).toMatchObject({ recipientUserId: USER, error: "bloqueado" });
    expect(notificationRepository.findOutbox).toHaveBeenCalledWith(expect.objectContaining({ delivery: "failed", limit: 300 }));

    await expect(notificationService.outbox({ channel: "sms" })).rejects.toMatchObject({ statusCode: 422 });
    await expect(notificationService.outbox({ delivery: "perdido" })).rejects.toMatchObject({ statusCode: 422 });
  });

  it("informa si Telegram está configurado y cuál es el bot", async () => {
    vi.mocked(telegram.resolveUsername).mockResolvedValue("asador_bot");
    expect(await notificationService.telegramInfo()).toEqual({ configured: true, botUsername: "asador_bot" });
  });
});
