import type { NotificationEvent } from "@resto/contracts";

export interface Message {
  title: string;
  body: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  online: "Pago en línea",
};

export const paymentLabel = (method: string): string => PAYMENT_LABELS[method] ?? method;

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
export const formatMoney = (cents: number): string => money.format(cents / 100);

/** "martes 4 de junio" en la zona horaria del restaurante. */
export function formatDay(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone }).format(
    new Date(iso)
  );
}

/** "20:00" (24 h) en la zona horaria del restaurante. */
export function formatTime(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(iso)
  );
}

const pluralPeople = (n: number) => `${n} ${n === 1 ? "persona" : "personas"}`;

export interface RenderContext {
  timeZone: string;
  now: Date;
}

/**
 * Convierte un evento de dominio en el texto que lee el cliente.
 * Es una función pura: el mismo texto sale en la campana de la app y en Telegram.
 */
export function renderMessage(event: NotificationEvent, ctx: RenderContext): Message {
  switch (event.type) {
    case "order.ready":
      return {
        title: "¡Tu pedido está listo!",
        body: `Tu pedido ${event.orderCode} ya está listo. ¡Buen provecho!`,
      };

    case "order.paid": {
      const lines = event.items.map((i) => `• ${i.quantity} × ${i.name} — ${formatMoney(i.lineTotalCents)}`);
      return {
        title: `Resumen de tu consumo · ${event.orderCode}`,
        body: [
          `Gracias por tu visita. Esto fue lo que consumiste:`,
          "",
          ...lines,
          "",
          `Subtotal: ${formatMoney(event.subtotalCents)}`,
          `IVA: ${formatMoney(event.taxCents)}`,
          `Total: ${formatMoney(event.totalCents)}`,
          `Método de pago: ${paymentLabel(event.paymentMethod)}`,
          "",
          "¿Vas a facturar? Si es así, ten a la mano tus datos fiscales (puedes guardarlos en Mi perfil) y pídenos tu factura.",
        ].join("\n"),
      };
    }

    case "payment.confirmed":
      return {
        title: "Pago recibido",
        body: `Recibimos tu pago en línea de ${formatMoney(event.amountCents)} del pedido ${event.orderCode}. ¡Gracias!`,
      };

    case "reservation.confirmed":
      return {
        title: "Reservación confirmada",
        body:
          `Reservación ${event.code} para ${pluralPeople(event.partySize)}: ` +
          `${formatDay(event.reservedFor, ctx.timeZone)} a las ${formatTime(event.reservedFor, ctx.timeZone)}. ` +
          "Te avisaremos cuando se acerque la hora. Puedes cancelarla hasta 1 hora antes.",
      };

    case "reservation.reminder": {
      const minutes = Math.max(Math.round((Date.parse(event.reservedFor) - ctx.now.getTime()) / 60_000), 1);
      return {
        title: "Tu reservación es en unos minutos",
        body:
          `Te esperamos a las ${formatTime(event.reservedFor, ctx.timeZone)} (en unos ${minutes} min). ` +
          `Mesa para ${pluralPeople(event.partySize)}, localizador ${event.code}.`,
      };
    }

    case "reservation.cancelled":
      return {
        title: "Reservación cancelada",
        body:
          `Se canceló la reservación ${event.code} del ${formatDay(event.reservedFor, ctx.timeZone)} ` +
          `a las ${formatTime(event.reservedFor, ctx.timeZone)}.`,
      };
  }
}

/** Telegram con parse_mode=HTML: hay que escapar lo que venga de usuarios (nombres de platillos). */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const toTelegramHtml = (m: Message): string => `<b>${escapeHtml(m.title)}</b>\n${escapeHtml(m.body)}`;

/** Llave de deduplicación: un solo aviso de cada tipo por entidad y canal. */
export function dedupeKey(event: NotificationEvent, channel: string): string {
  const entity = event.type.startsWith("reservation.") ? (event as { reservationId: string }).reservationId : (event as { orderId: string }).orderId;
  return `${event.type}:${entity}:${channel}`;
}
