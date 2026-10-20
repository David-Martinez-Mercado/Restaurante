import { useEffect, useState } from "react";
import { get, post } from "../api";
import type { AttendanceRecordDTO, AttendanceStatusDTO, AttendanceSummaryRowDTO, PayslipDTO } from "../types";
import { Badge, PageHead, State, dayLong, errorMessage, hm, money, monthNow, timeOnly, useLoad, useToast } from "../ui";

/** Reloj en vivo: la hora que ve el trabajador al checar. */
function useNow(everyMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function Payslip({ p }: { p: PayslipDTO }) {
  const rows: [string, number, boolean?][] = [
    ["Sueldo mensual", p.baseSalaryCents],
    ["Horas extra", p.overtimePayCents],
    ["Faltas", -p.absenceDeductionCents],
    ["ISR", -p.isrCents],
    ["IMSS", -p.imssCents],
    ["Infonavit", -p.infonavitCents],
    ["Subsidio al empleo", p.subsidioCents],
  ];
  return (
    <article className="card order">
      <div className="order-top">
        <strong>Recibo {p.period}</strong>
        <Badge tone="ok">Aprobado</Badge>
      </div>
      <p className="muted small">
        {p.hoursWorked} h trabajadas · {p.overtimeHours} h extra · {p.absenceDays} falta(s)
      </p>
      <ul className="lines">
        {rows
          .filter(([, v]) => v !== 0)
          .map(([label, v]) => (
            <li key={label}>
              <span>{label}</span>
              <span>{v < 0 ? `− ${money(-v)}` : money(v)}</span>
            </li>
          ))}
      </ul>
      <dl className="totals compact">
        <div className="grand">
          <dt>Neto a pagar</dt>
          <dd>{money(p.netPayCents)}</dd>
        </div>
      </dl>
    </article>
  );
}

/** Checador del trabajador: marcar entrada/salida, ver sus horas del mes y sus recibos de nómina. */
export function ClockView() {
  const toast = useToast();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const period = monthNow();

  const status = useLoad(() => get<{ data: AttendanceStatusDTO }>("/attendance/me/status").then((r) => r.data), [], 15000);
  const history = useLoad(() => get<{ data: AttendanceRecordDTO[] }>("/attendance/me").then((r) => r.data));
  const summary = useLoad(() => get<{ data: AttendanceSummaryRowDTO }>(`/attendance/me/summary?period=${period}`).then((r) => r.data));
  const slips = useLoad(() => get<{ data: PayslipDTO[] }>("/payroll/me").then((r) => r.data));

  const open = status.data?.open ?? null;
  // El servidor calcula los minutos de hoy (incluida la jornada abierta); se refresca cada 15 s.
  const todayMinutes = status.data?.todayMinutes ?? 0;

  async function punch() {
    setBusy(true);
    try {
      await post(open ? "/attendance/clock-out" : "/attendance/clock-in");
      toast(open ? "Salida registrada. ¡Buen descanso!" : "Entrada registrada. ¡Buen turno!");
      await Promise.all([status.reload(true), history.reload(true), summary.reload(true)]);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  const s = summary.data;

  return (
    <>
      <PageHead title="Checador" hint="Marca tu entrada y tu salida. La hora la pone el servidor, no tu equipo." />

      <section className="card clock">
        <div className="clock-time">{now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })}</div>
        <p className="muted">{dayLong(now.toISOString())}</p>

        <State loading={status.loading} error={status.error} onRetry={() => void status.reload()} />

        {status.data && (
          <>
            {status.data.stale && open && (
              <p className="error-box">
                Tu entrada del {dayLong(open.clockIn)} ({timeOnly(open.clockIn)}) quedó abierta. Pide a tu gerente que la corrija antes de checar de nuevo.
              </p>
            )}
            {open && !status.data.stale && (
              <p>
                <Badge tone="ok">En turno</Badge> desde las <b>{timeOnly(open.clockIn)}</b> · hoy llevas <b>{hm(todayMinutes)}</b>
              </p>
            )}
            {!open && (
              <p className="muted">
                Fuera de turno · hoy acumulas <b>{hm(status.data.todayMinutes)}</b>
              </p>
            )}
            <button className={`punch ${open ? "punch-out" : "punch-in"}`} disabled={busy || (status.data.stale && !!open)} onClick={() => void punch()}>
              {busy ? "Registrando…" : open ? "Checar SALIDA" : "Checar ENTRADA"}
            </button>
          </>
        )}
      </section>

      <h3 className="section-title">Mi mes ({period})</h3>
      <State loading={summary.loading} error={summary.error} onRetry={() => void summary.reload()} />
      {s && (
        <div className="stats">
          <div className="card stat">
            <span className="muted small">Días trabajados</span>
            <b>{s.daysWorked}</b>
          </div>
          <div className="card stat">
            <span className="muted small">Horas</span>
            <b>{s.hoursWorked}</b>
          </div>
          <div className="card stat stat-ok">
            <span className="muted small">Horas extra</span>
            <b>{s.overtimeHours}</b>
          </div>
          <div className={`card stat ${s.absences > 0 ? "stat-bad" : ""}`}>
            <span className="muted small">Faltas</span>
            <b>{s.absences}</b>
          </div>
        </div>
      )}
      {s && s.absenceDates.length > 0 && <p className="hint">Faltas: {s.absenceDates.join(", ")}. Si hay un error, avisa a tu gerente para que lo corrija.</p>}
      {s && s.openShifts > 0 && <p className="hint">Tienes {s.openShifts} jornada(s) sin salida: no suman horas hasta que se corrijan.</p>}

      <h3 className="section-title">Mis jornadas (últimos 31 días)</h3>
      <State loading={history.loading} error={history.error} empty={history.data?.length === 0 && "Aún no has checado."} onRetry={() => void history.reload()} />
      {history.data && history.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Día</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Tiempo</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((r) => (
                <tr key={r.id}>
                  <td>{dayLong(r.clockIn)}</td>
                  <td>{timeOnly(r.clockIn)}</td>
                  <td>{r.clockOut ? timeOnly(r.clockOut) : <Badge tone="warn">Abierta</Badge>}</td>
                  <td>{r.minutes !== null ? hm(r.minutes) : "—"}</td>
                  <td className="wrap-cell">
                    {r.source === "manual" && <Badge tone="info">Corregida</Badge>} {r.note ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title">Mis recibos de nómina</h3>
      <State loading={slips.loading} error={slips.error} empty={slips.data?.length === 0 && "Todavía no hay recibos aprobados."} onRetry={() => void slips.reload()} />
      <div className="grid">{slips.data?.map((p) => <Payslip key={p.period} p={p} />)}</div>
    </>
  );
}
