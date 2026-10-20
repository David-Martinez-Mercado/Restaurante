import { useState, type FormEvent } from "react";
import { get, post } from "../api";
import { useAuth } from "../auth";
import { PAYMENT_METHOD_LABEL, type TaxCalculationDTO, type TaxReportDTO } from "../types";
import { PageHead, State, dayLong, errorMessage, money, parsePesos, todayLocal, useLoad } from "../ui";

const RATES = [
  { percent: 16, label: "General · 16 %" },
  { percent: 8, label: "Región fronteriza · 8 %" },
  { percent: 0, label: "Tasa 0 %" },
];

function Calculator() {
  const [mode, setMode] = useState<"add" | "extract">("add");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState(16);
  const [result, setResult] = useState<TaxCalculationDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function calculate(e: FormEvent) {
    e.preventDefault();
    const cents = parsePesos(amount);
    if (cents === null || cents <= 0) {
      setResult(null);
      return setError("Escribe un monto mayor a cero, con máximo 2 decimales.");
    }
    setBusy(true);
    setError(null);
    try {
      setResult((await post<{ data: TaxCalculationDTO }>("/tax/calculate", { mode, amountCents: cents, ratePercent: rate })).data);
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card form">
      <h3>Calculadora de IVA</h3>
      <div className="seg" role="tablist">
        <button type="button" className={mode === "add" ? "on" : ""} onClick={() => (setMode("add"), setResult(null))}>
          Agregar IVA
        </button>
        <button type="button" className={mode === "extract" ? "on" : ""} onClick={() => (setMode("extract"), setResult(null))}>
          Desglosar IVA
        </button>
      </div>
      <p className="hint">
        {mode === "add" ? "El monto es el subtotal (sin IVA): se le suma el impuesto." : "El monto es el total con IVA incluido: se separa la base y el impuesto."}
      </p>
      <form className="form" onSubmit={calculate}>
        <div className="row">
          <label>
            {mode === "add" ? "Subtotal (MXN)" : "Total con IVA (MXN)"}
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1000.00" required />
          </label>
          <label>
            Tasa
            <select value={rate} onChange={(e) => (setRate(Number(e.target.value)), setResult(null))}>
              {RATES.map((r) => (
                <option key={r.percent} value={r.percent}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="error-box">{error}</p>}
        <div>
          <button className="primary" disabled={busy}>
            Calcular
          </button>
        </div>
      </form>
      {result && (
        <dl className="totals">
          <div>
            <dt>Base (sin IVA)</dt>
            <dd>{money(result.baseCents)}</dd>
          </div>
          <div>
            <dt>IVA {result.ratePercent} %</dt>
            <dd>{money(result.ivaCents)}</dd>
          </div>
          <div className="grand">
            <dt>Total</dt>
            <dd>{money(result.totalCents)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function Report() {
  const today = todayLocal();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [run, setRun] = useState(0);
  const report = useLoad(() => get<{ data: TaxReportDTO }>(`/tax/report?from=${from}&to=${to}`).then((r) => r.data), [run]);
  const r = report.data;

  return (
    <section className="card form">
      <h3>IVA trasladado (pedidos pagados)</h3>
      <p className="hint">Suma el IVA cobrado en los pedidos pagados dentro del rango, por fecha de pago. Sirve de base para la declaración.</p>
      <div className="filters">
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        <button className="primary" onClick={() => setRun((n) => n + 1)}>
          Consultar
        </button>
      </div>
      <State loading={report.loading} error={report.error} empty={r && r.orders === 0 && "No hay pedidos pagados en ese rango."} onRetry={() => void report.reload()} />
      {r && r.orders > 0 && (
        <>
          <div className="stats">
            <div className="card stat">
              <span className="muted small">Pedidos</span>
              <b>{r.orders}</b>
            </div>
            <div className="card stat">
              <span className="muted small">Subtotal</span>
              <b>{money(r.subtotalCents)}</b>
            </div>
            <div className="card stat stat-ok">
              <span className="muted small">IVA trasladado</span>
              <b>{money(r.ivaCents)}</b>
            </div>
            <div className="card stat">
              <span className="muted small">Total cobrado</span>
              <b>{money(r.totalCents)}</b>
            </div>
          </div>
          <div className="two-col">
            <div>
              <h4 className="section-title">Por método de pago</h4>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {r.byPaymentMethod.map((m) => (
                      <tr key={m.method}>
                        <td>{PAYMENT_METHOD_LABEL[m.method]}</td>
                        <td>{m.orders}</td>
                        <td>{money(m.ivaCents)}</td>
                        <td>{money(m.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="section-title">Por día</h4>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {r.byDay.map((d) => (
                      <tr key={d.date}>
                        <td>{dayLong(`${d.date}T12:00:00`)}</td>
                        <td>{d.orders}</td>
                        <td>{money(d.ivaCents)}</td>
                        <td>{money(d.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Calculadora de IVA y reporte de IVA trasladado. */
export function TaxView() {
  const { can } = useAuth();
  return (
    <>
      <PageHead title="IVA" hint="Los pedidos usan IVA de 16 %; aquí puedes calcular otros montos y ver cuánto IVA se cobró." />
      <div className="stack stack-wide">
        <Calculator />
        {can("tax:report") && <Report />}
      </div>
    </>
  );
}
