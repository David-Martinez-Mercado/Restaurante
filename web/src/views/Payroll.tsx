import { useState, type FormEvent } from "react";
import { get, post, put } from "../api";
import { useAuth } from "../auth";
import type { CompensationDTO, PayrollEngineStatusDTO, PayrollRunDTO, UserPublicDTO } from "../types";
import { ROLE_LABEL } from "../types";
import { Badge, Modal, PageHead, State, dateTime, errorMessage, money, monthNow, parsePesos, todayLocal, useLoad, useToast } from "../ui";

function SalaryForm({
  user,
  current,
  onClose,
  onDone,
}: {
  user: UserPublicDTO;
  current: CompensationDTO | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [fullName, setFullName] = useState(current?.fullName ?? "");
  const [position, setPosition] = useState(current?.position ?? ROLE_LABEL[user.role]);
  const [salary, setSalary] = useState(current ? String(current.monthlySalaryCents / 100) : "");
  const [hireDate, setHireDate] = useState(current?.hireDate ?? todayLocal());
  const [active, setActive] = useState(current?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parsePesos(salary);
    if (cents === null) return setError("Escribe el sueldo mensual en pesos, por ejemplo 12000 o 12000.50");
    setBusy(true);
    setError(null);
    try {
      await put(`/payroll/compensations/${user.id}`, { fullName, position, monthlySalaryCents: cents, hireDate, active });
      toast("Sueldo guardado");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Sueldo · ${user.username}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Nombre completo
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} minLength={3} maxLength={120} required autoFocus />
        </label>
        <div className="row">
          <label>
            Puesto
            <input value={position} onChange={(e) => setPosition(e.target.value)} minLength={2} maxLength={80} required />
          </label>
          <label>
            Sueldo mensual bruto (MXN)
            <input value={salary} onChange={(e) => setSalary(e.target.value)} inputMode="decimal" placeholder="12000" required />
          </label>
        </div>
        <div className="row">
          <label>
            Fecha de ingreso
            <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
          </label>
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Activo (entra en la nómina)
          </label>
        </div>
        <p className="hint">Las faltas se cuentan desde la fecha de ingreso. Si ingresó a mitad de mes, este cálculo paga el mes completo.</p>
        {error && <p className="error-box">{error}</p>}
        <div className="modal-foot">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RunTable({ run }: { run: PayrollRunDTO }) {
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Trabajador</th>
              <th>Sueldo</th>
              <th>Horas extra</th>
              <th>Faltas</th>
              <th>Base gravable</th>
              <th>ISR</th>
              <th>IMSS</th>
              <th>Infonavit</th>
              <th>Subsidio</th>
              <th>Neto</th>
            </tr>
          </thead>
          <tbody>
            {run.lines.map((l) => (
              <tr key={l.userId}>
                <td>
                  {l.fullName}
                  <span className="muted small block">{l.position}</span>
                </td>
                <td>{money(l.baseSalaryCents)}</td>
                <td title={`${l.overtimeHours} h`}>{l.overtimePayCents ? `+ ${money(l.overtimePayCents)}` : "—"}</td>
                <td title={`${l.absenceDays} día(s)`}>{l.absenceDeductionCents ? `− ${money(l.absenceDeductionCents)}` : "—"}</td>
                <td>{money(l.taxableCents)}</td>
                <td>{money(l.isrCents)}</td>
                <td>{money(l.imssCents)}</td>
                <td>{money(l.infonavitCents)}</td>
                <td>{l.subsidioCents ? money(l.subsidioCents) : "—"}</td>
                <td>
                  <b>{money(l.netPayCents)}</b>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <b>Totales</b>
              </td>
              <td>
                <b>{money(run.totals.taxableCents)}</b>
              </td>
              <td colSpan={3}>
                <b>{money(run.totals.deductionsCents)}</b> en deducciones
              </td>
              <td />
              <td>
                <b>{money(run.totals.netCents)}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/** Nómina: sueldos, cálculo con el motor externo (SistemaNomina) y aprobación. */
export function PayrollView() {
  const { can, user } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(monthNow());
  const [editing, setEditing] = useState<UserPublicDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  const engine = useLoad(() => get<{ data: PayrollEngineStatusDTO }>("/payroll/engine").then((r) => r.data), [], 20000);
  const comps = useLoad(() => get<{ data: CompensationDTO[] }>("/payroll/compensations").then((r) => r.data));
  const staff = useLoad(() => get<{ data: UserPublicDTO[] }>("/auth/users").then((r) => r.data.filter((u) => u.role !== "customer" && u.status === "active")));
  const runs = useLoad(() => get<{ data: PayrollRunDTO[] }>("/payroll/runs").then((r) => r.data));
  const detail = useLoad(
    () => (shown ? get<{ data: PayrollRunDTO }>(`/payroll/runs/${shown}`).then((r) => r.data) : Promise.resolve(null)),
    [shown]
  );

  const byUser = new Map(comps.data?.map((c) => [c.userId, c] as const));

  async function calculate() {
    setBusy(true);
    try {
      const run = (await post<{ data: PayrollRunDTO }>("/payroll/runs", { period })).data;
      toast(`Nómina ${run.period} calculada`);
      setShown(run.period);
      await Promise.all([runs.reload(true), comps.reload(true), detail.reload(true)]);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function approve(p: string) {
    if (!confirm(`¿Aprobar la nómina ${p}? Después ya no se podrá recalcular.`)) return;
    try {
      await post(`/payroll/runs/${p}/approve`);
      toast(`Nómina ${p} aprobada`);
      await Promise.all([runs.reload(true), detail.reload(true)]);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const d = detail.data;

  return (
    <>
      <PageHead title="Nómina" hint="El checador aporta horas extra y faltas; el motor SistemaNomina calcula ISR, IMSS, Infonavit y el neto.">
        {engine.data && <Badge tone={engine.data.available ? "ok" : "bad"}>{engine.data.available ? "Motor de nómina activo" : "Motor de nómina apagado"}</Badge>}
      </PageHead>

      {engine.data && !engine.data.available && (
        <p className="banner banner-warn">
          El motor de nómina externo no responde. Levántalo con <code>iniciar.bat</code> (o <code>node integraciones/nomina-externo.cjs</code>). Sin él no se puede calcular.
        </p>
      )}

      <h3 className="section-title">Sueldos del personal</h3>
      <State loading={staff.loading || comps.loading} error={staff.error ?? comps.error} onRetry={() => (void staff.reload(), void comps.reload())} />
      {staff.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Sueldo mensual</th>
                <th>Ingreso</th>
                <th>Motor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.data.map((u) => {
                const c = byUser.get(u.id);
                return (
                  <tr key={u.id}>
                    <td>
                      {u.username}
                      {c && <span className="muted small block">{c.fullName}</span>}
                    </td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>{c ? money(c.monthlySalaryCents) : <span className="muted">Sin sueldo</span>}</td>
                    <td>{c?.hireDate ?? "—"}</td>
                    <td>{c ? c.active ? c.synced ? <Badge tone="ok">Dado de alta</Badge> : <Badge tone="muted">Pendiente</Badge> : <Badge tone="bad">Inactivo</Badge> : "—"}</td>
                    <td>
                      {can("payroll:manage") && (
                        <button className="small-btn" onClick={() => setEditing(u)}>
                          {c ? "Editar" : "Asignar sueldo"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="section-title">Calcular nómina</h3>
      <div className="filters">
        <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} max={monthNow()} />
        {can("payroll:calculate") && (
          <button className="primary" disabled={busy || !engine.data?.available} onClick={() => void calculate()}>
            {busy ? "Calculando…" : `Calcular ${period}`}
          </button>
        )}
      </div>

      <State loading={runs.loading} error={runs.error} empty={runs.data?.length === 0 && "Todavía no hay nóminas calculadas."} onRetry={() => void runs.reload()} />
      {runs.data && runs.data.length > 0 && (
        <div className="chips">
          {runs.data.map((r) => (
            <button key={r.id} className={`chip ${shown === r.period ? "on" : ""}`} onClick={() => setShown(r.period)}>
              {r.period} · {r.status === "approved" ? "aprobada" : "calculada"}
            </button>
          ))}
        </div>
      )}

      <State loading={!!shown && detail.loading} error={detail.error} />
      {d && (
        <>
          <div className="row-between">
            <p>
              <b>Nómina {d.period}</b> · <Badge tone={d.status === "approved" ? "ok" : "warn"}>{d.status === "approved" ? "Aprobada" : "Calculada"}</Badge>{" "}
              <span className="muted small">
                {d.status === "approved" && d.approvedAt ? `el ${dateTime(d.approvedAt)}` : "pendiente de aprobación"}
              </span>
            </p>
            {can("payroll:approve") && d.status === "calculated" && (
              <button className="primary" onClick={() => void approve(d.period)} disabled={d.generatedBy === user?.id} title={d.generatedBy === user?.id ? "Quien la calculó no puede aprobarla" : undefined}>
                Aprobar nómina
              </button>
            )}
          </div>
          <RunTable run={d} />
          <p className="hint">
            Impuestos según el motor SistemaNomina (cálculo simplificado de su autor). Las horas extra se pagan dobles y cada falta descuenta un día de sueldo (sueldo ÷ 30). Solo el
            administrador aprueba, y nunca quien calculó.
          </p>
        </>
      )}

      {editing && (
        <SalaryForm
          user={editing}
          current={byUser.get(editing.id)}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void comps.reload(true);
          }}
        />
      )}
    </>
  );
}
