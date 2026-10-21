import { useState } from "react";
import { get, post } from "../api";
import { useAuth } from "../auth";
import type { EngineSnapshotDTO, EngineTransactionDTO, PayrollEngineStatusDTO } from "../types";
import { Badge, PageHead, State, errorMessage, monthNow, useLoad, useToast } from "../ui";

const TARGET_LABEL: Record<EngineTransactionDTO["target"], string> = {
  employees: "Empleados :3102",
  incidents: "Incidencias :3104",
  payroll: "Nómina :3103",
};

const METHOD_TONE: Record<string, string> = { POST: "info", DELETE: "warn", GET: "muted" };

const time = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const json = (v: unknown) => JSON.stringify(v, null, 2);

function Transaction({ t }: { t: EngineTransactionDTO }) {
  return (
    <li className={`tx ${t.ok ? "" : "tx-bad"}`}>
      <details>
        <summary>
          <span className="tx-time">{time(t.at)}</span>
          <Badge tone={METHOD_TONE[t.method] ?? "muted"}>{t.method}</Badge>
          <code>{t.path}</code>
          <span className="tx-summary">{t.summary}</span>
          <Badge tone={t.ok ? "ok" : "bad"}>{t.status ?? "sin respuesta"}</Badge>
          <span className="muted small">{t.durationMs} ms</span>
        </summary>
        <div className="tx-detail">
          <p className="muted small">
            Restaurante (Payroll :3010) → {TARGET_LABEL[t.target]}
            {t.error ? ` · ${t.error}` : ""}
          </p>
          <div className="two-col">
            <div>
              <b className="small">Lo que se envió</b>
              <pre className="json">{t.requestBody === null ? "(sin cuerpo)" : json(t.requestBody)}</pre>
            </div>
            <div>
              <b className="small">Lo que respondió el motor</b>
              <pre className="json">{t.responseBody === null ? "(sin cuerpo)" : json(t.responseBody)}</pre>
            </div>
          </div>
        </div>
      </details>
    </li>
  );
}

/** Lo que pasa entre el restaurante y el motor de nómina externo (SistemaNomina), en vivo. */
export function EngineView() {
  const { can } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(monthNow());
  const [busy, setBusy] = useState(false);

  const status = useLoad(() => get<{ data: PayrollEngineStatusDTO }>("/payroll/engine").then((r) => r.data), [], 5000);
  const txs = useLoad(() => get<{ data: EngineTransactionDTO[] }>("/payroll/engine/transactions?limit=100").then((r) => r.data), [], 3000);
  const snap = useLoad(() => get<{ data: EngineSnapshotDTO }>("/payroll/engine/data").then((r) => r.data), [], 5000);

  async function calculate() {
    setBusy(true);
    try {
      await post("/payroll/runs", { period });
      toast(`Nómina ${period} calculada: mira las transacciones de abajo`);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
      void txs.reload(true);
      void snap.reload(true);
    }
  }

  const name = new Map(snap.data?.employees.map((e) => [e.id, e.name] as const));

  return (
    <>
      <PageHead title="Motor de nómina" hint="Transacciones entre el restaurante y SistemaNomina (repo de otro autor, sin modificar). Se actualiza cada 3 s.">
        {status.data && <Badge tone={status.data.available ? "ok" : "bad"}>{status.data.available ? "Motor activo" : "Motor apagado"}</Badge>}
      </PageHead>

      <pre className="flow">{`Restaurante                                        SistemaNomina (127.0.0.1)
  Attendance :3009 ──horas extra y faltas──┐
                                           ▼
  Payroll :3010 ── 1 alta de empleados ───► Empleados :3102
                ── 2 incidencias ─────────► Incidencias :3104
                ── 3 calcular periodo ────► Nómina :3103  (ISR, IMSS, Infonavit, neto)
                ◄── resultado ─────────────┘`}</pre>

      <div className="filters">
        <input type="month" value={period} max={monthNow()} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        {can("payroll:calculate") && (
          <button className="primary" disabled={busy || !status.data?.available} onClick={() => void calculate()}>
            {busy ? "Calculando…" : `Calcular ${period} y ver las transacciones`}
          </button>
        )}
        <a className="link-btn" href="http://127.0.0.1:3102/employees" target="_blank" rel="noreferrer">
          Abrir /employees del motor ↗
        </a>
        <a className="link-btn" href="http://127.0.0.1:3104/incidents" target="_blank" rel="noreferrer">
          Abrir /incidents del motor ↗
        </a>
      </div>

      {status.data && !status.data.available && (
        <p className="banner banner-warn">
          El motor no responde. Levántalo con <code>iniciar.bat</code> o <code>node integraciones/nomina-externo.cjs</code>.
        </p>
      )}

      <h3 className="section-title">Transacciones (la más reciente arriba)</h3>
      <State
        loading={txs.loading}
        error={txs.error}
        empty={txs.data?.length === 0 && "Aún no hay transacciones. Pulsa “Calcular” para generar algunas."}
        onRetry={() => void txs.reload()}
      />
      {txs.data && txs.data.length > 0 && <ul className="tx-list">{txs.data.map((t) => <Transaction key={t.id} t={t} />)}</ul>}

      <h3 className="section-title">Lo que tiene guardado el motor ahora</h3>
      <State loading={snap.loading} error={snap.error} onRetry={() => void snap.reload()} />
      {snap.data && (
        <div className="two-col">
          <div>
            <h4 className="section-title">Empleados ({snap.data.employees.length})</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Nombre</th>
                    <th>Puesto</th>
                    <th>Sueldo</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.data.employees.map((e) => (
                    <tr key={e.id}>
                      <td>{e.id}</td>
                      <td>{e.name}</td>
                      <td>{e.position}</td>
                      <td>{e.baseSalary.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="section-title">Incidencias ({snap.data.incidents.length})</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Empleado</th>
                    <th>Periodo</th>
                    <th>Tipo</th>
                    <th>Cant.</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {[...snap.data.incidents].reverse().map((i) => (
                    <tr key={i.id}>
                      <td>{i.id}</td>
                      <td>{name.get(i.employeeId) ?? `#${i.employeeId}`}</td>
                      <td>{i.period}</td>
                      <td>{i.type === "OVERTIME" ? "Hora extra" : i.type === "ABSENCE" ? "Falta" : i.type}</td>
                      <td>{i.hoursOrDays}</td>
                      <td>{i.amount.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
