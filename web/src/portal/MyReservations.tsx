import { useState } from "react";
import { get, patch, post } from "../api";
import {
  RESERVATION_STATUS_LABEL,
  type CustomerDTO,
  type ReservationDTO,
  type ReservationStatus,
  type SlotDTO,
  type TelegramInfoDTO,
} from "../types";
import { Badge, PageHead, State, dayLong, errorMessage, todayLocal, timeOnly, useLoad, useToast } from "../ui";

export const RES_TONE: Record<ReservationStatus, string> = {
  confirmed: "ok",
  arrived: "info",
  completed: "muted",
  cancelled: "bad",
  no_show: "warn",
};

export function MyReservations({ profile }: { profile: CustomerDTO | null }) {
  const toast = useToast();
  const [date, setDate] = useState(todayLocal());
  const [partySize, setPartySize] = useState(2);
  const [slots, setSlots] = useState<SlotDTO[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = useLoad(() => get<{ data: ReservationDTO[] }>("/reservations").then((r) => r.data), [], 15000);
  const tg = useLoad(() => get<{ data: TelegramInfoDTO }>("/notifications/telegram").then((r) => r.data));

  async function search() {
    setBusy(true);
    setChosen(null);
    try {
      setSlots((await get<{ data: SlotDTO[] }>(`/reservations/availability?date=${date}&partySize=${partySize}`)).data);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!chosen) return;
    setBusy(true);
    try {
      const r = (await post<{ data: ReservationDTO }>("/reservations", { reservedFor: chosen, partySize, notes: notes || undefined })).data;
      toast(`Reservación confirmada · localizador ${r.code}`);
      setSlots(null);
      setChosen(null);
      setNotes("");
      void mine.reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
      void search();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(r: ReservationDTO) {
    if (!confirm(`¿Cancelar la reservación ${r.code}?`)) return;
    try {
      await patch(`/reservations/${r.id}/status`, { status: "cancelled" });
      toast("Reservación cancelada");
      void mine.reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const open = (slots ?? []).filter((s) => s.available);

  return (
    <>
      <PageHead title="Reservaciones" hint="Elige día, personas y tu hora de llegada. Te recordaremos cuando se acerque la hora." />

      {!profile && (
        <p className="note-box">
          Antes de reservar necesitamos tu nombre y teléfono. <a href="#perfil">Completar mi perfil</a>
        </p>
      )}

      <section className="card form">
        <h3>Nueva reservación</h3>
        <div className="row3">
          <label>
            Día
            <input type="date" value={date} min={todayLocal()} onChange={(e) => (setDate(e.target.value), setSlots(null), setChosen(null))} />
          </label>
          <label>
            Personas
            <select value={partySize} onChange={(e) => (setPartySize(Number(e.target.value)), setSlots(null), setChosen(null))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="align-end">
            <button disabled={busy || !date || !profile} onClick={() => void search()}>
              Ver horarios
            </button>
          </div>
        </div>

        {slots && (
          <>
            {open.length === 0 ? (
              <p className="muted">No hay horarios disponibles ese día para {partySize} {partySize === 1 ? "persona" : "personas"}. Prueba otra fecha.</p>
            ) : (
              <>
                <p className="muted small">Hora de llegada — {dayLong(`${date}T12:00:00`)}</p>
                <div className="chips">
                  {open.map((s) => (
                    <button key={s.startsAt} className={`chip ${chosen === s.startsAt ? "on" : ""}`} onClick={() => setChosen(s.startsAt)}>
                      {timeOnly(s.startsAt)}
                    </button>
                  ))}
                </div>
                <label>
                  Notas (opcional)
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Cumpleaños, silla para bebé…" />
                </label>
                <div>
                  <button className="primary" disabled={busy || !chosen} onClick={() => void book()}>
                    {chosen ? `Reservar a las ${timeOnly(chosen)}` : "Elige una hora"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        <p className="hint">
          {tg.data?.botUsername ? (
            <>
              También puedes reservar desde Telegram con <b>@{tg.data.botUsername}</b> (escribe /reservar).
            </>
          ) : (
            <>También puedes reservar desde Telegram cuando el bot esté configurado (/reservar).</>
          )}
        </p>
      </section>

      <h3 className="section-title">Mis reservaciones</h3>
      <State loading={mine.loading} error={mine.error} empty={mine.data?.length === 0 && "Aún no tienes reservaciones."} onRetry={() => void mine.reload()} />
      <div className="grid">
        {mine.data?.map((r) => (
          <article key={r.id} className="card order">
            <div className="order-top">
              <strong>
                {dayLong(r.reservedFor)} · {timeOnly(r.reservedFor)}
              </strong>
              <Badge tone={RES_TONE[r.status]}>{RESERVATION_STATUS_LABEL[r.status]}</Badge>
            </div>
            <p>
              {r.partySize} {r.partySize === 1 ? "persona" : "personas"} · Localizador <b className="code-big">{r.code}</b>
            </p>
            {r.arrivedAt && <p className="muted small">Llegaste a las {timeOnly(r.arrivedAt)}</p>}
            {r.notes && <p className="note">“{r.notes}”</p>}
            {r.status === "confirmed" && (
              <div className="order-actions">
                <button className="small-btn danger" onClick={() => void cancel(r)}>
                  Cancelar
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
