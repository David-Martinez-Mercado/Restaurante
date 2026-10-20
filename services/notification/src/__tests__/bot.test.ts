import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-16-chars";
process.env.INTERNAL_API_KEY = "test-internal-key-min-16-chars";

const { Bot } = await import("../telegram/bot.js");
const { ReservationRejected, ReservationUnavailable } = await import("../clients/reservation.client.js");
type Deps = ConstructorParameters<typeof Bot>[0];
type Update = import("../telegram/telegram.api.js").TelegramUpdate;

const CHAT = "777";
const TZ = "America/Mexico_City";
let clock = new Date("2030-06-04T16:00:00Z"); // 10:00 en CDMX
let n = 0;

const slot = (iso: string, available = true) => ({ startsAt: iso, remainingSeats: 20, available });
const slots = [slot("2030-06-05T02:00:00Z"), slot("2030-06-05T02:30:00Z"), slot("2030-06-05T03:00:00Z", false)]; // 20:00, 20:30, 21:00(lleno)

const profile = { id: "c1", fullName: "Ana López", userId: "u1", phone: "5512345678", telegramLinked: true, telegramUsername: null, billing: null, createdAt: "", updatedAt: "", telegramChatId: CHAT } as never;
const reservation = (o = {}) => ({ id: "r1", code: "ABC234", reservedFor: "2030-06-05T02:00:00Z", partySize: 4, status: "confirmed", ...o }) as never;

function setup() {
  const deps = {
    api: { send: vi.fn().mockResolvedValue(undefined), answerCallback: vi.fn().mockResolvedValue(undefined) },
    customers: { getByChat: vi.fn().mockResolvedValue(null), linkTelegram: vi.fn() },
    reservations: {
      availability: vi.fn().mockResolvedValue(slots),
      create: vi.fn().mockResolvedValue(reservation()),
      upcoming: vi.fn().mockResolvedValue([]),
      cancel: vi.fn().mockResolvedValue(reservation({ status: "cancelled" })),
    },
    timeZone: TZ,
    now: () => clock,
  };
  const bot = new Bot(deps as unknown as Deps);

  const text = (t: string, username?: string): Update =>
    ({ update_id: ++n, message: { message_id: n, text: t, chat: { id: Number(CHAT) }, from: { id: 1, username } } });
  const press = (data: string): Update =>
    ({ update_id: ++n, callback_query: { id: `cb${n}`, data, from: { id: 1 }, message: { chat: { id: Number(CHAT) } } } });

  const last = () => {
    const call = deps.api.send.mock.calls.at(-1)!;
    return { text: call[1] as string, buttons: (call[2]?.buttons ?? []) as { text: string; callback_data: string }[][] };
  };
  const flat = (rows: { text: string; callback_data: string }[][]) => rows.flat();

  return { deps, bot, text, press, last, flat };
}

beforeEach(() => {
  vi.clearAllMocks();
  clock = new Date("2030-06-04T16:00:00Z");
});

describe("vincular la cuenta con /start CODIGO", () => {
  it("canjea el código (en mayúsculas) con el chat y el usuario de Telegram", async () => {
    const { deps, bot, text, last } = setup();
    deps.customers.linkTelegram.mockResolvedValue(profile);

    await bot.handle(text("/start ab12cd", "ana_l"));

    expect(deps.customers.linkTelegram).toHaveBeenCalledWith({ code: "AB12CD", chatId: CHAT, username: "ana_l" });
    expect(last().text).toContain("Ana López");
    expect(last().text).toContain("vinculado");
  });

  it("código vencido o inexistente", async () => {
    const { deps, bot, text, last } = setup();
    deps.customers.linkTelegram.mockResolvedValue(null);
    await bot.handle(text("/start ZZZZZZ"));
    expect(last().text).toContain("no existe o ya venció");
  });

  it("/start sin código muestra la ayuda y el procedimiento para vincular", async () => {
    const { bot, text, last } = setup();
    await bot.handle(text("/start"));
    expect(last().text).toContain("/reservar");
    expect(last().text).toContain("/start CODIGO");
  });

  it("si el Customer Service falla, lo dice sin romperse", async () => {
    const { deps, bot, text, last } = setup();
    deps.customers.linkTelegram.mockRejectedValue(new Error("down"));
    await bot.handle(text("/start AB12CD"));
    expect(last().text).toContain("No pude vincular");
  });
});

describe("/reservar — flujo completo de un invitado (sin cuenta)", () => {
  it("fecha → personas → hora de llegada → nombre → confirmar → crea la reservación", async () => {
    const { deps, bot, text, press, last, flat } = setup();

    await bot.handle(text("/reservar"));
    expect(last().text).toContain("¿Para qué día");
    const days = flat(last().buttons);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ callback_data: "d:2030-06-04" });
    expect(days[0]!.text).toContain("Hoy");

    await bot.handle(press("d:2030-06-05"));
    expect(last().text).toContain("¿Cuántas personas");
    expect(flat(last().buttons)).toHaveLength(12);

    await bot.handle(press("p:4"));
    expect(deps.reservations.availability).toHaveBeenCalledWith("2030-06-05", 4);
    expect(last().text).toContain("¿A qué hora");
    // Solo se ofrecen las llegadas con lugar: 20:00 y 20:30 (21:00 está lleno).
    expect(flat(last().buttons).map((b) => b.text)).toEqual(["20:00", "20:30"]);

    await bot.handle(press("t:1"));
    expect(last().text).toContain("nombre");

    await bot.handle(text("Beto Ruiz"));
    expect(last().text).toContain("Beto Ruiz");
    expect(last().text).toContain("20:30");
    expect(last().text).toContain("Personas: 4");

    await bot.handle(press("c:y"));
    expect(deps.reservations.create).toHaveBeenCalledWith({
      telegramChatId: CHAT, reservedFor: "2030-06-05T02:30:00Z", partySize: 4, customerName: "Beto Ruiz",
    });
    expect(last().text).toContain("ABC234");
  });

  it("rechaza un nombre demasiado corto sin avanzar", async () => {
    const { bot, text, press, last } = setup();
    await bot.handle(text("/reservar"));
    await bot.handle(press("d:2030-06-05"));
    await bot.handle(press("p:2"));
    await bot.handle(press("t:0"));
    await bot.handle(text("Al"));
    expect(last().text).toContain("nombre completo");
  });

  it("'Descartar' no crea nada", async () => {
    const { deps, bot, text, press, last } = setup();
    await bot.handle(text("/reservar"));
    await bot.handle(press("d:2030-06-05"));
    await bot.handle(press("p:2"));
    await bot.handle(press("t:0"));
    await bot.handle(text("Beto Ruiz"));
    await bot.handle(press("c:n"));
    expect(deps.reservations.create).not.toHaveBeenCalled();
    expect(last().text).toContain("descartada");
  });
});

describe("/reservar — cliente vinculado", () => {
  it("no pide el nombre: usa el de su perfil", async () => {
    const { deps, bot, text, press, last } = setup();
    deps.customers.getByChat.mockResolvedValue(profile);

    await bot.handle(text("/reservar"));
    await bot.handle(press("d:2030-06-05"));
    await bot.handle(press("p:2"));
    await bot.handle(press("t:0"));

    expect(last().text).toContain("Revisa tu reservación");
    expect(last().text).toContain("Ana López");

    await bot.handle(press("c:y"));
    expect(deps.reservations.create).toHaveBeenCalledWith(expect.objectContaining({ customerName: undefined, telegramChatId: CHAT }));
  });
});

describe("casos límite del flujo", () => {
  it("sin lugares ese día lo dice y termina la conversación", async () => {
    const { deps, bot, text, press, last } = setup();
    deps.reservations.availability.mockResolvedValue([slot("2030-06-05T02:00:00Z", false)]);
    await bot.handle(text("/reservar"));
    await bot.handle(press("d:2030-06-05"));
    await bot.handle(press("p:12"));
    expect(last().text).toContain("No hay lugares");

    // La sesión se cerró: un botón viejo ya no hace nada raro.
    await bot.handle(press("t:0"));
    expect(last().text).toContain("ya venció");
  });

  it("la sesión vence a los 10 minutos", async () => {
    const { bot, text, press, last } = setup();
    await bot.handle(text("/reservar"));
    clock = new Date(clock.getTime() + 11 * 60_000);
    await bot.handle(press("d:2030-06-05"));
    expect(last().text).toContain("ya venció");
  });

  it("si al confirmar el horario se llenó, muestra el motivo del servicio y cierra la sesión", async () => {
    const { deps, bot, text, press, last } = setup();
    deps.customers.getByChat.mockResolvedValue(profile);
    deps.reservations.create.mockRejectedValue(new ReservationRejected(409, "No hay lugares a esa hora: solo quedan 2."));
    await bot.handle(text("/reservar"));
    await bot.handle(press("d:2030-06-05"));
    await bot.handle(press("p:4"));
    await bot.handle(press("t:0"));
    await bot.handle(press("c:y"));
    expect(last().text).toContain("solo quedan 2");

    await bot.handle(press("c:y"));
    expect(deps.reservations.create).toHaveBeenCalledTimes(1);
  });

  it("si el Reservation Service está caído, avisa", async () => {
    const { deps, bot, text, press, last } = setup();
    deps.reservations.availability.mockRejectedValue(new ReservationUnavailable());
    await bot.handle(text("/reservar"));
    await bot.handle(press("d:2030-06-05"));
    await bot.handle(press("p:2"));
    expect(last().text).toContain("no está disponible");
  });

  it("un botón fuera de orden se ignora (no salta pasos)", async () => {
    const { deps, bot, text, press } = setup();
    await bot.handle(text("/reservar"));
    await bot.handle(press("c:y"));
    expect(deps.reservations.create).not.toHaveBeenCalled();
  });

  it("/salir corta la conversación", async () => {
    const { bot, text, press, last } = setup();
    await bot.handle(text("/reservar"));
    await bot.handle(text("/salir"));
    expect(last().text).toContain("lo dejamos aquí");
    await bot.handle(press("d:2030-06-05"));
    expect(last().text).toContain("ya venció");
  });

  it("escapa el nombre del invitado en los mensajes HTML", async () => {
    const { bot, text, press, last } = setup();
    await bot.handle(text("/reservar"));
    await bot.handle(press("d:2030-06-05"));
    await bot.handle(press("p:2"));
    await bot.handle(press("t:0"));
    await bot.handle(text("<b>Beto</b> Ruiz"));
    expect(last().text).toContain("&lt;b&gt;Beto&lt;/b&gt; Ruiz");
  });
});

describe("consultar y cancelar", () => {
  it("/misreservaciones lista con localizador y un botón de cancelar por cada una", async () => {
    const { deps, bot, text, last, flat } = setup();
    deps.reservations.upcoming.mockResolvedValue([reservation(), reservation({ code: "XYZ789" })]);

    await bot.handle(text("/misreservaciones"));

    expect(deps.reservations.upcoming).toHaveBeenCalledWith(CHAT);
    expect(last().text).toContain("ABC234");
    expect(last().text).toContain("20:00");
    expect(flat(last().buttons).map((b) => b.callback_data)).toEqual(["x:ABC234", "x:XYZ789"]);
  });

  it("sin reservaciones invita a reservar", async () => {
    const { bot, text, last } = setup();
    await bot.handle(text("/misreservaciones"));
    expect(last().text).toContain("No tienes reservaciones");
  });

  it("/cancelar CODIGO y el botón cancelan con el chat de quien lo pide", async () => {
    const { deps, bot, text, press, last } = setup();

    await bot.handle(text("/cancelar abc234"));
    expect(deps.reservations.cancel).toHaveBeenCalledWith(CHAT, "ABC234");
    expect(last().text).toContain("cancelada");

    await bot.handle(press("x:XYZ789"));
    expect(deps.reservations.cancel).toHaveBeenLastCalledWith(CHAT, "XYZ789");
  });

  it("muestra el motivo si no se puede cancelar (menos de 1 h)", async () => {
    const { deps, bot, text, last } = setup();
    deps.reservations.cancel.mockRejectedValue(new ReservationRejected(409, "Solo puedes cancelar hasta 1 hora antes."));
    await bot.handle(text("/cancelar ABC234"));
    expect(last().text).toContain("hasta 1 hora antes");
  });

  it("/cancelar sin código explica cómo usarlo", async () => {
    const { bot, text, last } = setup();
    await bot.handle(text("/cancelar"));
    expect(last().text).toContain("/cancelar CODIGO");
  });
});

describe("mensajes que no entiende", () => {
  it("texto suelto y comandos desconocidos apuntan a la ayuda", async () => {
    const { bot, text, last } = setup();
    await bot.handle(text("hola"));
    expect(last().text).toContain("/reservar");
    await bot.handle(text("/volar"));
    expect(last().text).toContain("/ayuda");
  });

  it("acepta el comando con el nombre del bot (/reservar@mi_bot)", async () => {
    const { bot, text, last } = setup();
    await bot.handle(text("/reservar@asador_bot"));
    expect(last().text).toContain("¿Para qué día");
  });

  it("un fallo interno no tumba al bot", async () => {
    const { deps, bot, text } = setup();
    deps.api.send.mockRejectedValue(new Error("red caída"));
    await expect(bot.handle(text("/ayuda"))).resolves.toBeUndefined();
  });
});
