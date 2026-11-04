import { useState } from "react";
import { get, post } from "../api";
import { useAuth } from "../auth";
import { InvoiceModal, INVOICE_TONE } from "../invoice/InvoiceModal";
import {
  CANCEL_REASON_LABEL,
  INVOICE_STATUS_LABEL,
  type CancelReason,
  type InvoiceDTO,
  type InvoiceStatus,
  type OrderDTO,
} from "../types";
import { Badge, Modal, PageHead, State, dateTime, errorMessage, money, useLoad, useToast } from "../ui";

/** Cancelación ante el SAT. El motivo 01 exige elegir la factura vigente que sustituye a esta. */
function CancelModal({ invoice, candidates, onClose, onDone }: { invoice: InvoiceDTO; candidates: InvoiceDTO[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<CancelReason>("02");
  const [replacementId, setReplacementId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await post(`/invoices/${invoice.id}/cancel`, { reason, ...(reason === "01" ? { replacementInvoiceId: replacementId } : {}) });
      toast(`Factura ${invoice.serie}-${invoice.folio} cancelada`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Cancelar factura ${invoice.serie}-${invoice.folio}`} onClose={onClose}>
      <div className="form">
        <p className="hint">La cancelación se manda al SAT a través de Profact y no se puede deshacer. Para volver a facturar el consumo, el cliente genera una factura nueva.</p>
        <label>
          Motivo
          <select value={reason} onChange={(e) => setReason(e.target.value as CancelReason)}>
            {(Object.keys(CANCEL_REASON_LABEL) as CancelReason[]).map((r) => (
              <option key={r} value={r}>
                {CANCEL_REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {reason === "01" && (
          <label>
            Factura que la sustituye
            <select value={replacementId} onChange={(e) => setReplacementId(e.target.value)}>
              <option value="">Elige una factura vigente…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.serie}-{c.folio} · pedido {c.orderCode} · {money(c.totalCents)}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="error-box">{error}</p>}
        <div className="modal-foot">
          <button onClick={onClose}>Volver</button>
          <button className="danger" disabled={busy || (reason === "01" && !replacementId)} onClick={() => void submit()}>
            {busy ? "Cancelando…" : "Cancelar factura"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Facturar por un cliente registrado cuyo consumo ya está pagado y aún no tiene factura vigente. */
function IssueModal({ pending, onClose, onDone }: { pending: OrderDTO[]; onClose: () => void; onDone: (invoice: InvoiceDTO) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function issue(order: OrderDTO) {
    setBusy(order.id);
    try {
      const created = (await post<{ data: InvoiceDTO }>("/invoices", { orderId: order.id })).data;
      toast(`Factura ${created.serie}-${created.folio} emitida`);
      onDone(created);
      onClose();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Facturar un consumo" onClose={onClose} wide>
      <p className="hint">Consumos pagados de clientes registrados que aún no tienen factura vigente. Se factura con los datos fiscales que el cliente guardó.</p>
      {pending.length === 0 ? (
        <p className="muted">No hay consumos pendientes de facturar.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Pagado</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.id}>
                  <td>{o.code}</td>
                  <td>{o.customerName ?? "—"}</td>
                  <td>{o.paidAt ? dateTime(o.paidAt) : "—"}</td>
                  <td>{money(o.totalCents)}</td>
                  <td>
                    <button className="small-btn primary" disabled={busy !== null} onClick={() => void issue(o)}>
                      {busy === o.id ? "Timbrando…" : "Facturar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** Facturas CFDI 4.0 timbradas con Profact: consulta, XML, cancelación ante el SAT y facturación por el cliente. */
export function InvoicesView() {
  const { can } = useAuth();
  const [status, setStatus] = useState<InvoiceStatus | "">("");
  const list = useLoad(() => get<{ data: InvoiceDTO[] }>(`/invoices${status ? `?status=${status}` : ""}`).then((r) => r.data), [status], 15000);
  const all = useLoad(() => get<{ data: InvoiceDTO[] }>("/invoices").then((r) => r.data), [], 15000);
  const [viewing, setViewing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceDTO | null>(null);
  const [issuing, setIssuing] = useState(false);
  const paid = useLoad(() => (can("invoices:issue") ? get<{ data: OrderDTO[] }>("/orders?status=paid").then((r) => r.data) : Promise.resolve([])), []);

  const issuedOrderIds = new Set((all.data ?? []).filter((i) => i.status === "issued").map((i) => i.orderId));
  const pendingOrders = (paid.data ?? []).filter((o) => o.customerUserId && !issuedOrderIds.has(o.id));
  const vigentes = (all.data ?? []).filter((i) => i.status === "issued");

  const refresh = () => {
    void list.reload(true);
    void all.reload(true);
    void paid.reload(true);
  };

  return (
    <>
      <PageHead title="Facturas" hint="CFDI 4.0 timbrados con Profact. Se actualiza cada 15 s.">
        {can("invoices:issue") && (
          <button className="primary" onClick={() => setIssuing(true)}>
            Facturar un consumo{pendingOrders.length > 0 ? ` (${pendingOrders.length})` : ""}
          </button>
        )}
      </PageHead>

      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus | "")}>
          <option value="">Todos los estados</option>
          {(Object.keys(INVOICE_STATUS_LABEL) as InvoiceStatus[]).map((s) => (
            <option key={s} value={s}>
              {INVOICE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <State loading={list.loading} error={list.error} empty={list.data?.length === 0 && "Todavía no hay facturas."} onRetry={() => void list.reload()} />

      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Factura</th>
                <th>Pedido</th>
                <th>Receptor</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Folio fiscal</th>
                <th>Fecha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.serie}-{i.folio}
                  </td>
                  <td>{i.orderCode}</td>
                  <td>
                    {i.receptor.name}
                    <span className="muted small block">{i.receptor.rfc}</span>
                  </td>
                  <td>{money(i.totalCents)}</td>
                  <td>
                    <Badge tone={INVOICE_TONE[i.status]}>{INVOICE_STATUS_LABEL[i.status]}</Badge>
                    {i.errorMessage && <span className="muted small block wrap-cell">{i.errorMessage}</span>}
                  </td>
                  <td className="mono">{i.uuid ?? "—"}</td>
                  <td>{dateTime(i.stampedAt ?? i.createdAt)}</td>
                  <td className="cell-actions">
                    {(i.status === "issued" || i.status === "cancelled") && (
                      <button className="small-btn" onClick={() => setViewing(i.id)}>
                        Ver
                      </button>
                    )}
                    {i.status === "issued" && can("invoices:cancel") && (
                      <button className="small-btn danger" onClick={() => setCancelling(i)}>
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <InvoiceModal invoiceId={viewing} onClose={() => setViewing(null)} />}
      {cancelling && (
        <CancelModal
          invoice={cancelling}
          candidates={vigentes.filter((c) => c.id !== cancelling.id)}
          onClose={() => setCancelling(null)}
          onDone={refresh}
        />
      )}
      {issuing && (
        <IssueModal
          pending={pendingOrders}
          onClose={() => setIssuing(false)}
          onDone={(created) => {
            refresh();
            setViewing(created.id);
          }}
        />
      )}
    </>
  );
}
