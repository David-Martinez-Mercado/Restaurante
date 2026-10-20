import { MAX_PARTY_SIZE, type CustomerInternalDTO, type ReservationDTO, type SlotDTO } from "@resto/contracts";
import { logger } from "@resto/http";
import { UpstreamError } from "../clients/customer.client.js";
import { ReservationRejected, ReservationUnavailable } from "../clients/reservation.client.js";
import { escapeHtml, formatDay, formatTime } from "../domain/templates.js";
import type { InlineButton, SendOptions, TelegramUpdate } from "./telegram.api.js";

/** Lo que el bot necesita del exterior; se inyecta para poder probarlo sin red. */
export interface BotDeps {
  api: {
    send(chatId: string, html: string, options?: SendOptions): Promise<unknown>;
    answerCallback(callbackId: string): Promise<void>;
  };
  customers: {
    getByChat(chatId: string): Promise<CustomerInternalDTO | null>;
    linkTelegram(input: { code: string; chatId: string; username?: string }): Promise<CustomerInternalDTO | null>;
  };
  reservations: {
    availability(date: string, partySize: number): Promise<SlotDTO[]>;
    create(input: { telegramChatId: string; reservedFor: string; partySize: number; customerName?: string }): Promise<ReservationDTO>;
    upcoming(chatId: string): Promise<ReservationDTO[]>;
    cancel(chatId: string, code: string): Promise<ReservationDTO>;
  };
  timeZone: string;
  now: () => Date;
}

type Step = "date" | "party" | "time" | "name" | "confirm";

interface Session {
  step: Step;
  expiresAt: number;
  /** Cliente ya vinculado: no hay que pedirle el nombre. */
  knownName: string | null;
  date?: string;
  partySize?: number;
  slots?: SlotDTO[];
  startsAt?: string;
  guestName?: string;
}

const SESSION_TTL_MS = 10 * 60_000;
const DAYS_AHEAD = 7;

const HELP = [
  "<b>Asador La Brasa</b> 🥩",
  "",
  "/reservar — reservar una mesa (eliges fecha, personas y hora de llegada)",
  "/misreservaciones — ver tus próximas reservaciones",
  "/cancelar CODIGO — cancelar una reservación (hasta 1 hora antes)",
  "/salir — cortar lo que estés haciendo",
  "",
  "Para recibir avisos de tus pedidos y reservaciones, vincula tu cuenta: en el portal ve a Mi perfil → Vincular Telegram y manda aquí <code>/start CODIGO</code>.",
].join("\n");

const UNAVAILABLE = "El servicio de reservaciones no está disponible en este momento. Intenta de nuevo en unos minutos.";

/** Conversación del bot de Telegram. Una sesión por chat, en memoria, que vence a los 10 minutos. */
export class Bot {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly deps: BotDeps) {}

  async handle(update: TelegramUpdate): Promise<void> {
    try {
      if (update.callback_query) {
        await this.onCallback(update.callback_query);
      } else if (update.message?.text) {
        await this.onText(String(update.message.chat.id), update.message.text.trim(), update.message.from?.username);
      }
    } catch (err) {
      logger.error({ err, updateId: update.update_id }, "Falló el procesamiento de un mensaje del bot");
    }
  }

  // ------------------------------------------------------------------ texto

  private async onText(chatId: string, text: string, username?: string): Promise<void> {
    const [first = "", ...rest] = text.split(/\s+/);
    const cmd = first.startsWith("/") ? first.toLowerCase().replace(/@\w+$/, "") : null;
    const arg = rest.join(" ").trim();

    switch (cmd) {
      case "/start":
        return arg ? this.link(chatId, arg, username) : this.say(chatId, HELP);
      case "/ayuda":
      case "/help":
        return this.say(chatId, HELP);
      case "/reservar":
        return this.beginReservation(chatId);
      case "/misreservaciones":
        return this.listReservations(chatId);
      case "/salir":
        this.sessions.delete(chatId);
        return this.say(chatId, "Listo, lo dejamos aquí. Escribe /ayuda para ver lo que puedo hacer.");
      case "/cancelar":
        if (arg) return this.cancelReservation(chatId, arg);
        if (this.sessions.delete(chatId)) return this.say(chatId, "Listo, lo dejamos aquí.");
        return this.say(chatId, "Dime qué reservación cancelar: <code>/cancelar CODIGO</code>. Con /misreservaciones ves tus códigos.");
      case null:
        break;
      default:
        return this.say(chatId, "No conozco ese comando. Escribe /ayuda.");
    }

    const session = this.live(chatId);
    if (session?.step === "name") return this.receiveName(chatId, session, text);
    return this.say(chatId, "Escribe /reservar para reservar una mesa o /ayuda para ver las opciones.");
  }

  private async link(chatId: string, code: string, username?: string): Promise<void> {
    try {
      const customer = await this.deps.customers.linkTelegram({ code: code.toUpperCase(), chatId, username });
      if (!customer) {
        return this.say(chatId, "Ese código no existe o ya venció. Genera uno nuevo en el portal (Mi perfil → Vincular Telegram).");
      }
      await this.say(
        chatId,
        `✅ ¡Listo, ${escapeHtml(customer.fullName)}! Tu Telegram quedó vinculado. Aquí te avisaremos cuando tu pedido esté listo, cuando se acerque la hora de tu reservación y con el resumen de tu consumo.\n\nPuedes reservar con /reservar.`
      );
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 422) {
        return this.say(chatId, "Ese código no es válido. Son 6 caracteres, por ejemplo <code>/start AB12CD</code>.");
      }
      await this.say(chatId, "No pude vincular tu cuenta ahorita. Intenta de nuevo en unos minutos.");
    }
  }

  // ----------------------------------------------------------- reservar

  private async beginReservation(chatId: string): Promise<void> {
    let profile: CustomerInternalDTO | null;
    try {
      profile = await this.deps.customers.getByChat(chatId);
    } catch {
      return this.say(chatId, "No pude consultar tus datos ahorita. Intenta de nuevo en unos minutos.");
    }

    this.sessions.set(chatId, {
      step: "date",
      expiresAt: this.deps.now().getTime() + SESSION_TTL_MS,
      knownName: profile?.fullName ?? null,
    });
    await this.say(chatId, "¿Para qué día quieres tu mesa?", { buttons: this.dateButtons() });
  }

  private dateButtons(): InlineButton[][] {
    const now = this.deps.now();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: this.deps.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    const label = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: this.deps.timeZone });

    const buttons: InlineButton[] = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(now.getTime() + i * 86_400_000);
      buttons.push({ text: `${i === 0 ? "Hoy · " : ""}${label.format(d)}`, callback_data: `d:${day.format(d)}` });
    }
    return chunk(buttons, 2);
  }

  private partyButtons(): InlineButton[][] {
    const buttons = Array.from({ length: MAX_PARTY_SIZE }, (_, i) => ({ text: String(i + 1), callback_data: `p:${i + 1}` }));
    return chunk(buttons, 4);
  }

  private async onCallback(cb: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    await this.deps.api.answerCallback(cb.id);
    const chatId = String(cb.message?.chat.id ?? cb.from.id);
    const [kind = "", value = ""] = (cb.data ?? "").split(":");

    // Cancelar una reservación desde la lista no necesita sesión.
    if (kind === "x") return this.cancelReservation(chatId, value);

    const session = this.live(chatId);
    if (!session) return this.say(chatId, "Esa conversación ya venció. Escribe /reservar para empezar de nuevo.");

    switch (kind) {
      case "d":
        if (session.step !== "date") return;
        session.date = value;
        session.step = "party";
        return this.say(chatId, "¿Cuántas personas son?", { buttons: this.partyButtons() });

      case "p":
        if (session.step !== "party") return;
        session.partySize = Number(value);
        return this.showSlots(chatId, session);

      case "t": {
        if (session.step !== "time") return;
        const slot = session.slots?.[Number(value)];
        if (!slot) return;
        session.startsAt = slot.startsAt;
        if (session.knownName) return this.askConfirmation(chatId, session);
        session.step = "name";
        return this.say(chatId, "¿A nombre de quién dejamos la reservación? Escribe tu nombre completo.");
      }

      case "c":
        if (session.step !== "confirm") return;
        if (value !== "y") {
          this.sessions.delete(chatId);
          return this.say(chatId, "Reservación descartada. Escribe /reservar cuando quieras intentarlo de nuevo.");
        }
        return this.confirm(chatId, session);
    }
  }

  private async showSlots(chatId: string, session: Session): Promise<void> {
    try {
      const slots = await this.deps.reservations.availability(session.date!, session.partySize!);
      const open = slots.filter((s) => s.available);
      if (open.length === 0) {
        this.sessions.delete(chatId);
        return this.say(chatId, "No hay lugares para ese día y ese número de personas. Prueba otra fecha con /reservar.");
      }
      session.slots = open;
      session.step = "time";
      const buttons = open.map((s, i) => ({ text: formatTime(s.startsAt, this.deps.timeZone), callback_data: `t:${i}` }));
      await this.say(chatId, "¿A qué hora llegarías?", { buttons: chunk(buttons, 4) });
    } catch (err) {
      await this.say(chatId, this.explain(err));
    }
  }

  private async receiveName(chatId: string, session: Session, text: string): Promise<void> {
    const name = text.replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.length > 120) {
      return this.say(chatId, "Escribe tu nombre completo (mínimo 3 letras).");
    }
    session.guestName = name;
    await this.askConfirmation(chatId, session);
  }

  private async askConfirmation(chatId: string, session: Session): Promise<void> {
    session.step = "confirm";
    const tz = this.deps.timeZone;
    const name = session.knownName ?? session.guestName!;
    await this.say(
      chatId,
      [
        "<b>Revisa tu reservación</b>",
        `Nombre: ${escapeHtml(name)}`,
        `Personas: ${session.partySize}`,
        `Día: ${formatDay(session.startsAt!, tz)}`,
        `Hora de llegada: ${formatTime(session.startsAt!, tz)}`,
        "",
        "¿La confirmamos?",
      ].join("\n"),
      { buttons: [[{ text: "✅ Confirmar", callback_data: "c:y" }, { text: "✖ Descartar", callback_data: "c:n" }]] }
    );
  }

  private async confirm(chatId: string, session: Session): Promise<void> {
    try {
      const created = await this.deps.reservations.create({
        telegramChatId: chatId,
        reservedFor: session.startsAt!,
        partySize: session.partySize!,
        customerName: session.knownName ? undefined : session.guestName,
      });
      this.sessions.delete(chatId);
      // El detalle completo llega aparte, como el aviso "reservation.confirmed".
      await this.say(chatId, `✅ Reservación registrada. Tu localizador es <b>${escapeHtml(created.code)}</b>.`);
    } catch (err) {
      // Si el horario se llenó o ya no cumple las reglas, se vuelve a ofrecer la elección.
      if (err instanceof ReservationRejected) this.sessions.delete(chatId);
      await this.say(chatId, this.explain(err));
    }
  }

  // ---------------------------------------------------- consultar/cancelar

  private async listReservations(chatId: string): Promise<void> {
    try {
      const list = await this.deps.reservations.upcoming(chatId);
      if (list.length === 0) {
        return this.say(chatId, "No tienes reservaciones próximas. Escribe /reservar para hacer una.");
      }
      const tz = this.deps.timeZone;
      const text = [
        "<b>Tus próximas reservaciones</b>",
        ...list.map(
          (r) => `• <b>${escapeHtml(r.code)}</b> — ${formatDay(r.reservedFor, tz)} a las ${formatTime(r.reservedFor, tz)}, ${r.partySize} ${r.partySize === 1 ? "persona" : "personas"}`
        ),
      ].join("\n");
      await this.say(chatId, text, {
        buttons: list.map((r) => [{ text: `Cancelar ${r.code}`, callback_data: `x:${r.code}` }]),
      });
    } catch (err) {
      await this.say(chatId, this.explain(err));
    }
  }

  private async cancelReservation(chatId: string, code: string): Promise<void> {
    try {
      const cancelled = await this.deps.reservations.cancel(chatId, code.trim().toUpperCase());
      await this.say(chatId, `🗑 Reservación <b>${escapeHtml(cancelled.code)}</b> cancelada.`);
    } catch (err) {
      await this.say(chatId, this.explain(err));
    }
  }

  // ---------------------------------------------------------------- utilidades

  private live(chatId: string): Session | undefined {
    const session = this.sessions.get(chatId);
    if (!session) return undefined;
    if (session.expiresAt < this.deps.now().getTime()) {
      this.sessions.delete(chatId);
      return undefined;
    }
    return session;
  }

  private explain(err: unknown): string {
    if (err instanceof ReservationRejected) return escapeHtml(err.message);
    if (err instanceof ReservationUnavailable) return UNAVAILABLE;
    logger.error({ err }, "Error inesperado en el bot");
    return "Ocurrió un problema. Intenta de nuevo en unos minutos.";
  }

  private say(chatId: string, html: string, options?: SendOptions): Promise<void> {
    return this.deps.api.send(chatId, html, options).then(() => undefined);
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
