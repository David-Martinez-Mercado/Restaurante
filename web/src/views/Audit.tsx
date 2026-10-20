import { useState } from "react";
import { get } from "../api";
import type { AuditLogDTO, AuditSummaryDTO } from "../types";
import { Badge, PageHead, State, dateTime, useLoad } from "../ui";

const OUTCOME_LABEL: Record<string, string> = { success: "Éxito", failure: "Fallo", denied: "Denegado" };
const OUTCOME_TONE: Record<string, string> = { success: "ok", failure: "warn", denied: "bad" };
const PAGE = 20;

interface AuditPage {
  data: AuditLogDTO[];
  total: number;
}

export function AuditView() {
  const [outcome, setOutcome] = useState("");
  const [username, setUsername] = useState("");
  const [offset, setOffset] = useState(0);

  const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (outcome) query.set("outcome", outcome);
  if (username.trim()) query.set("username", username.trim());

  const summary = useLoad(() => get<{ data: AuditSummaryDTO }>("/audit/summary").then((r) => r.data), [], 10000);
  const list = useLoad(() => get<AuditPage>(`/audit?${query}`), [outcome, username, offset], 10000);

  const total = list.data?.total ?? 0;
  const s = summary.data;

  return (
    <>
      <PageHead title="Auditoría" hint="Accounting: quién hizo qué, cuándo y con qué resultado. Se actualiza cada 10 s.">
        <button
          onClick={() => {
            void summary.reload(true);
            void list.reload(true);
          }}
        >
          Actualizar
        </button>
      </PageHead>

      <State loading={summary.loading} error={summary.error} onRetry={() => void summary.reload()} />

      {s && (
        <div className="stats">
          <div className="card stat">
            <span className="muted small">Eventos</span>
            <b>{s.total}</b>
          </div>
          {Object.entries(OUTCOME_LABEL).map(([key, label]) => (
            <div key={key} className={`card stat stat-${OUTCOME_TONE[key]}`}>
              <span className="muted small">{label}</span>
              <b>{s.byOutcome[key] ?? 0}</b>
            </div>
          ))}
        </div>
      )}

      {s && (
        <div className="two-col">
          <div className="card">
            <h3 className="section-title">Acciones más frecuentes</h3>
            <ul className="bars">
              {s.byAction.map((a) => (
                <li key={a.action}>
                  <span>{a.action}</span>
                  <span className="bar" style={{ width: `${(a.count / (s.byAction[0]?.count || 1)) * 100}%` }} />
                  <b>{a.count}</b>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3 className="section-title">Usuarios más activos</h3>
            <ul className="bars">
              {s.byUser.map((u) => (
                <li key={u.username}>
                  <span>{u.username}</span>
                  <span className="bar" style={{ width: `${(u.count / (s.byUser[0]?.count || 1)) * 100}%` }} />
                  <b>{u.count}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <h3 className="section-title">Bitácora</h3>
      <div className="filters">
        <select
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value);
            setOffset(0);
          }}
          aria-label="Filtrar por resultado"
        >
          <option value="">Todos los resultados</option>
          {Object.entries(OUTCOME_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          placeholder="Filtrar por usuario"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setOffset(0);
          }}
        />
      </div>

      <State loading={list.loading} error={list.error} empty={list.data && total === 0 && "Sin eventos para este filtro."} onRetry={() => void list.reload()} />

      {list.data && total > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Servicio</th>
                <th>Resultado</th>
                <th>HTTP</th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.occurredAt)}</td>
                  <td>
                    {e.username ?? <span className="muted">anónimo</span>}
                    {e.role && <span className="muted small"> · {e.role}</span>}
                  </td>
                  <td>
                    <code>{e.action}</code>
                  </td>
                  <td>{e.service}</td>
                  <td>
                    <Badge tone={OUTCOME_TONE[e.outcome] ?? "muted"}>{OUTCOME_LABEL[e.outcome] ?? e.outcome}</Badge>
                  </td>
                  <td>{e.statusCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE && (
        <div className="pager">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ← Anterior
          </button>
          <span className="muted small">
            {offset + 1}–{Math.min(offset + PAGE, total)} de {total}
          </span>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            Siguiente →
          </button>
        </div>
      )}
    </>
  );
}
