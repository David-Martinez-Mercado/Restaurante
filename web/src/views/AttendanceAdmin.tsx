import { useState, type FormEvent } from "react";
import { get, patch, post } from "../api";
import type { AttendanceRecordDTO, AttendanceSummaryDTO, UserPublicDTO } from "../types";
import { Badge, Modal, PageHead, State, dayLong, errorMessage, hm, monthNow, timeOnly, useLoad, useToast } from "../ui";

/** "2030-06-10T09:00" (hora local del navegador) a partir de un instante ISO. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Correction({ record, onClose, onDone }: { record: AttendanceRecordDTO; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [clockIn, setClockIn] = useState(toLocalInput(record.clockIn));
  const [clockOut, setClockOut] = useState(toLocalInput(record.clockOut));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch(`/attendance/${record.id}`, {
        clockIn: new Date(clockIn).toISOString(),
        clockOut: clockOut ? new Date(clockOut).toISOString() : null,
        note,
      });
      toast("Jornada corregida");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Corregir jornada · ${record.username}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="row">
          <label>
            Entrada
            <input type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} required />
          </label>
          <label>
            Salida
            <input type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
          </label>
        </div>
        <p className="hint">Deja la salida vacía para reabrir la jornada.</p>
        <label>
          Motivo (obligatorio, queda en la bitácora)
          <input value={note} onChange={(e) => setNote(e.target.value)} minLength={3} maxLength={200} required placeholder="Olvidó checar la salida" />
        </label>
        {error && <p className="error-box">{error}</p>}
        <div className="modal-foot">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            Guardar corrección
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ManualShift({ users, onClose, onDone }: { users: UserPublicDTO[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await post("/attendance/manual", {
        userId,
        username: user.username,
        clockIn: new Date(clockIn).toISOString(),
        clockOut: clockOut ? new Date(clockOut).toISOString() : undefined,
        note,
      });
      toast("Jornada agregada");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Agregar jornada a mano" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Trabajador
          <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
            <option value="">Selecciona…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            Entrada
            <input type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} required />
          </label>
          <label>
            Salida
            <input type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} />
          </label>
        </div>
        <label>
          Motivo (obligatorio)
          <input value={note} onChange={(e) => setNote(e.target.value)} minLength={3} maxLength={200} required placeholder="No funcionó el checador" />
        </label>
        {error && <p className="error-box">{error}</p>}
        <div className="modal-foot">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            Agregar
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Asistencia de todo el personal: resumen del mes y jornadas con corrección. */
export function AttendanceAdminView() {
  const [period, setPeriod] = useState(monthNow());
  const [who, setWho] = useState("");
  const [editing, setEditing] = useState<AttendanceRecordDTO | null>(null);
  const [adding, setAdding] = useState(false);

  const [y, m] = period.split("-").map(Number) as [number, number];
  const from = `${period}-01`;
  const to = `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  const summary = useLoad(() => get<{ data: AttendanceSummaryDTO }>(`/attendance/summary?period=${period}`).then((r) => r.data), [period], 30000);
  const records = useLoad(
    () => get<{ data: AttendanceRecordDTO[] }>(`/attendance?from=${from}&to=${to}${who ? `&userId=${who}` : ""}`).then((r) => r.data),
    [period, who],
    30000
  );
  const users = useLoad(() => get<{ data: UserPublicDTO[] }>("/auth/users").then((r) => r.data.filter((u) => u.role !== "customer" && u.status === "active")));

  const reloadAll = () => {
    void summary.reload(true);
    void records.reload(true);
  };

  return (
    <>
      <PageHead
        title="Asistencia"
        hint={
          summary.data
            ? `Jornada de ${summary.data.rules.dailyHours} h · lo que pase de eso es hora extra · falta = día laborable sin registro (lunes a sábado por defecto).`
            : "Resumen y corrección de las jornadas del personal."
        }
      >
        <button className="primary" onClick={() => setAdding(true)} disabled={!users.data}>
          + Jornada a mano
        </button>
      </PageHead>

      <div className="filters">
        <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Todo el personal</option>
          {users.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>
      </div>

      <State loading={summary.loading} error={summary.error} empty={summary.data?.rows.length === 0 && "Nadie ha checado en este mes."} onRetry={() => void summary.reload()} />
      {summary.data && summary.data.rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>Días</th>
                <th>Horas</th>
                <th>Horas extra</th>
                <th>Faltas</th>
                <th>Sin salida</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.rows.map((r) => (
                <tr key={r.userId}>
                  <td>{r.username}</td>
                  <td>{r.daysWorked}</td>
                  <td>{r.hoursWorked}</td>
                  <td>{r.overtimeHours > 0 ? <Badge tone="info">{r.overtimeHours}</Badge> : 0}</td>
                  <td title={r.absenceDates.join(", ")}>{r.absences > 0 ? <Badge tone="bad">{r.absences}</Badge> : 0}</td>
                  <td>{r.openShifts > 0 ? <Badge tone="warn">{r.openShifts}</Badge> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title">Jornadas</h3>
      <State loading={records.loading} error={records.error} empty={records.data?.length === 0 && "Sin jornadas en este filtro."} onRetry={() => void records.reload()} />
      {records.data && records.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Día</th>
                <th>Trabajador</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Tiempo</th>
                <th>Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {records.data.map((r) => (
                <tr key={r.id}>
                  <td>{dayLong(r.clockIn)}</td>
                  <td>{r.username}</td>
                  <td>{timeOnly(r.clockIn)}</td>
                  <td>{r.clockOut ? timeOnly(r.clockOut) : <Badge tone="warn">Abierta</Badge>}</td>
                  <td>{r.minutes !== null ? hm(r.minutes) : "—"}</td>
                  <td className="wrap-cell">
                    {r.source === "manual" && <Badge tone="info">Corregida</Badge>} {r.note ?? ""}
                  </td>
                  <td>
                    <button className="small-btn" onClick={() => setEditing(r)}>
                      Corregir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Correction
          record={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reloadAll();
          }}
        />
      )}
      {adding && users.data && (
        <ManualShift
          users={users.data}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            reloadAll();
          }}
        />
      )}
    </>
  );
}
