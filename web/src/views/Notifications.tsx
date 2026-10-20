import { useState } from "react";
import { get } from "../api";
import { CHANNEL_LABEL, DELIVERY_LABEL, type DeliveryStatus, type NotificationChannel, type NotificationDTO, type TelegramInfoDTO } from "../types";
import { Badge, PageHead, State, dateTime, useLoad } from "../ui";

const TONE: Record<DeliveryStatus, string> = { sent: "ok", simulated: "info", failed: "bad", skipped: "muted" };

const TYPE_LABEL: Record<string, string> = {
  "order.ready": "Pedido listo",
  "order.paid": "Resumen de consumo",
  "payment.confirmed": "Pago en línea",
  "reservation.confirmed": "Reservación confirmada",
  "reservation.reminder": "Recordatorio de reservación",
  "reservation.cancelled": "Reservación cancelada",
};

/** Bitácora de envíos: qué avisos salieron, por qué canal y si llegaron. */
export function NotificationsView() {
  const [channel, setChannel] = useState<NotificationChannel | "">("");
  const [delivery, setDelivery] = useState<DeliveryStatus | "">("");

  const query = new URLSearchParams({ limit: "100" });
  if (channel) query.set("channel", channel);
  if (delivery) query.set("delivery", delivery);

  const tg = useLoad(() => get<{ data: TelegramInfoDTO }>("/notifications/telegram").then((r) => r.data));
  const list = useLoad(() => get<{ data: NotificationDTO[] }>(`/notifications?${query}`).then((r) => r.data), [channel, delivery], 10000);

  return (
    <>
      <PageHead title="Avisos enviados" hint="Bitácora de notificaciones a clientes. Se actualiza cada 10 s.">
        <button onClick={() => void list.reload(true)}>Actualizar</button>
      </PageHead>

      {tg.data &&
        (tg.data.configured ? (
          <p className="banner banner-ok">Telegram activo{tg.data.botUsername ? ` · @${tg.data.botUsername}` : ""}</p>
        ) : (
          <p className="banner banner-warn">
            Telegram en modo simulado: los mensajes se registran aquí pero no salen. Configura <code>TELEGRAM_BOT_TOKEN</code> en el Notification Service.
          </p>
        ))}

      <div className="filters">
        <select value={channel} onChange={(e) => setChannel(e.target.value as NotificationChannel | "")}>
          <option value="">Todos los canales</option>
          {(Object.keys(CHANNEL_LABEL) as NotificationChannel[]).map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
        <select value={delivery} onChange={(e) => setDelivery(e.target.value as DeliveryStatus | "")}>
          <option value="">Todos los resultados</option>
          {(Object.keys(DELIVERY_LABEL) as DeliveryStatus[]).map((d) => (
            <option key={d} value={d}>
              {DELIVERY_LABEL[d]}
            </option>
          ))}
        </select>
      </div>

      <State loading={list.loading} error={list.error} empty={list.data?.length === 0 && "Todavía no se ha enviado ningún aviso."} onRetry={() => void list.reload()} />

      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Aviso</th>
                <th>Canal</th>
                <th>Resultado</th>
                <th>Mensaje</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((n) => (
                <tr key={n.id}>
                  <td>{dateTime(n.createdAt)}</td>
                  <td>{TYPE_LABEL[n.type] ?? n.type}</td>
                  <td>{CHANNEL_LABEL[n.channel]}</td>
                  <td>
                    <Badge tone={TONE[n.delivery]}>{DELIVERY_LABEL[n.delivery]}</Badge>
                    {n.error && <span className="muted small block">{n.error}</span>}
                  </td>
                  <td className="wrap-cell">
                    <b>{n.title}</b>
                    <span className="muted small block pre">{n.body}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
