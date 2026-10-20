import { useMemo, useState, type FormEvent } from "react";
import { get, patch, post } from "../api";
import { useAuth } from "../auth";
import { RES_TONE } from "../portal/MyReservations";
import {
  RESERVATION_STATUS_LABEL,
  type CustomerSummaryDTO,
  type ReservationDTO,
  type ReservationStatus,
  type SlotDTO,
  type TableDTO,
} from "../types";
import { Badge, Modal, PageHead, State, dayLong, errorMessage, timeOnly, todayLocal, useLoad, useToast } from "../ui";

const SOURCE_LABEL = { web: "En línea", telegram: "Telegram", staff: "Mostrador" } as const;

function NewReservation({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(todayLocal());
  const [partySize, setPartySize] = useState(2);
  const [slots, setSlots] = useState<SlotDTO[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [customerUserId, setCustomerUserId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customers = useLoad(
    () =>
      search.trim().length >= 2
        ? get<{ data: CustomerSummaryDTO[] }>(`/customers?search=${encodeURIComponent(search.trim())}`).then((r) => r.data)
        : Promise.resolve([] as CustomerSummaryDTO[]),
    [search]
  );

  async function loadSlots() {
    setBusy(true);
    setChosen(null);
    setError(null);
    try {
      setSlots((await get<{ data: SlotDTO[] }>(`/reservations/availability?date=${date}&partySize=${partySize}`)).data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const r = (
        await post<{ data: ReservationDTO }>("/reservations", {
          reservedFor: chosen,
          partySize,
          notes: notes || undefined,
          ...(customerUserId ? { customerUserId } : { customerName, phone }),
        })
      ).data;
      toast(`Reservación ${r.code} creada`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const open = (slots ?? []).filter((s) => s.available);

  return (
    <Modal title="Nueva reservación" onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
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
            <button type="button" disabled={busy || !date} onClick={() => void loadSlots()}>
              Ver horarios
            </button>
          </div>
        </div>

        {slots && (open.length === 0 ? (
          <p className="muted">No hay horarios disponibles para ese día y ese grupo.</p>
        ) : (
          <>
            <p className="muted small">Hora de llegada</p>
            <div className="chips">
              {open.map((s) => (
                <button type="button" key={s.startsAt} className={`chip ${chosen === s.startsAt ? "on" : ""}`} onClick={() => setChosen(s.startsAt)}>
                  {timeOnly(s.startsAt)}
                </button>
              ))}
            </div>
          </>
        ))}

        <div className="row">
          <label>
            Buscar cliente registrado
            <input value={search} onChange={(e) => (setSearch(e.target.value), setCustomerUserId(""))} placeholder="Nombre o teléfono…" />
          </label>
          <label>
            Cliente
            <select value={customerUserId} onChange={(e) => setCustomerUserId(e.target.value)} disabled={!customers.data?.length}>
              <option value="">{customers.data?.length ? "Selecciona…" : "Sin cliente registrado"}</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.userId}>
                  {c.fullName} · {c.phone}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!customerUserId && (
          <div className="row">
            <label>
              Nombre
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} minLength={3} required />
            </label>
            <label>
              Teléfono (10 dígitos)
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" pattern="\d{10}" required />
            </label>
          </div>
        )}

        <label>
          Notas
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} />
        </label>

        {error && <p className="error-box">{error}</p>}
        <div className="modal-foot">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !chosen}>
            {chosen ? `Reservar a las ${timeOnly(chosen)}` : "Elige una hora"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Arrival({ reservation, onClose, onDone }: { reservation: ReservationDTO; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const tables = useLoad(() => get<{ data: TableDTO[] }>("/tables?status=free").then((r) => r.data));
  const [tableId, setTableId] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirmArrival() {
    setBusy(true);
    try {
      await patch(`/reservations/${reservation.id}/status`, { status: "arrived", tableId: tableId || undefined });
      toast(`${reservation.customerName} ya llegó`);
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Llegada · ${reservation.customerName}`} onClose={onClose}>
      <div className="form">
        <p className="muted small">
          Reservó para las {timeOnly(reservation.reservedFor)} · {reservation.partySize} {reservation.partySize === 1 ? "persona" : "personas"}. Se registrará la hora real de llegada.
        </p>
        <label>
          Mesa (opcional)
          <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">Sin asignar</option>
            {tables.data
              ?.filter((t) => t.capacity >= reservation.partySize)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  Mesa {t.number} ({t.capacity} personas)
                </option>
              ))}
          </select>
        </label>
        <div className="modal-foot">
          <button onClick={onClose}>Cancelar</button>
          <button className="primary" disabled={busy} onClick={() => void confirmArrival()}>
            Registrar llegada
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ReservationsView() {
  const { can } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayLocal());
  const [status, setStatus] = useState<ReservationStatus | "">("");
  const [creating, setCreating] = useState(false);
  const [arriving, setArriving] = useState<ReservationDTO | null>(null);

  const query = new URLSearchParams({ date });
  if (status) query.set("status", status);
  const list = useLoad(() => get<{ data: ReservationDTO[] }>(`/reservations?${query}`).then((r) => r.data), [date, status], 15000);

  const expected = useMemo(
    () => (list.data ?? []).filter((r) => r.status === "confirmed" || r.status === "arrived").reduce((s, r) => s + r.partySize, 0),
    [list.data]
  );

  async function setState(r: ReservationDTO, next: ReservationStatus, okText: string) {
    try {
      await patch(`/reservations/${r.id}/status`, { status: next });
      toast(okText);
      void list.reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <>
      <PageHead title="Reservaciones" hint={`${dayLong(`${date}T12:00:00`)} · ${expected} comensales esperados. Se actualiza cada 15 s.`}>
        {can("reservations:create") && (
          <button className="primary" onClick={() => setCreating(true)}>
            + Nueva reservación
          </button>
        )}
      </PageHead>

      <div className="filters">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | "")}>
          <option value="">Todos los estados</option>
          {(Object.keys(RESERVATION_STATUS_LABEL) as ReservationStatus[]).map((s) => (
            <option key={s} value={s}>
              {RESERVATION_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <State loading={list.loading} error={list.error} empty={list.data?.length === 0 && "No hay reservaciones para este día."} onRetry={() => void list.reload()} />

      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Llegada</th>
                <th>Cliente</th>
                <th>Personas</th>
                <th>Localizador</th>
                <th>Origen</th>
                <th>Estado</th>
                <th>Llegó</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{timeOnly(r.reservedFor)}</b>
                  </td>
                  <td>
                    {r.customerName}
                    {r.phone && <span className="muted small"> · {r.phone}</span>}
                    {r.notes && <span className="muted small block">“{r.notes}”</span>}
                  </td>
                  <td>{r.partySize}</td>
                  <td>
                    <code>{r.code}</code>
                  </td>
                  <td>{SOURCE_LABEL[r.source]}</td>
                  <td>
                    <Badge tone={RES_TONE[r.status]}>{RESERVATION_STATUS_LABEL[r.status]}</Badge>
                    {r.tableNumber !== null && <span className="muted small"> Mesa {r.tableNumber}</span>}
                  </td>
                  <td>{r.arrivedAt ? timeOnly(r.arrivedAt) : "—"}</td>
                  <td className="cell-actions">
                    {can("reservations:manage") && r.status === "confirmed" && (
                      <>
                        <button className="small-btn primary" onClick={() => setArriving(r)}>
                          Llegó
                        </button>
                        <button className="small-btn" onClick={() => void setState(r, "no_show", "Marcada como no presentada")}>
                          No llegó
                        </button>
                        <button className="small-btn danger" onClick={() => void setState(r, "cancelled", "Reservación cancelada")}>
                          Cancelar
                        </button>
                      </>
                    )}
                    {can("reservations:manage") && r.status === "arrived" && (
                      <button className="small-btn" onClick={() => void setState(r, "completed", "Reservación terminada")}>
                        Terminó
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewReservation
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void list.reload(true);
          }}
        />
      )}
      {arriving && (
        <Arrival
          reservation={arriving}
          onClose={() => setArriving(null)}
          onDone={() => {
            setArriving(null);
            void list.reload(true);
          }}
        />
      )}
    </>
  );
}
