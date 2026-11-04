import "./invoice.css";
import { downloadFile, get } from "../api";
import { Badge, Modal, State, dateTime, errorMessage, money, useLoad, useToast } from "../ui";
import { INVOICE_STATUS_LABEL, type InvoiceDetailDTO, type InvoiceStatus } from "../types";

export const INVOICE_TONE: Record<InvoiceStatus, string> = { pending: "warn", issued: "ok", cancelled: "bad", rejected: "bad" };

const PAYMENT_FORM: Record<string, string> = { "01": "01 · Efectivo", "04": "04 · Tarjeta de crédito" };

/**
 * Representación impresa del CFDI (la factura "bonita"): emisor, receptor, conceptos, IVA, sellos y QR.
 * Es una vista del XML timbrado por el SAT; el documento fiscal es el XML, que también se descarga aquí.
 */
export function InvoiceModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const toast = useToast();
  const detail = useLoad(() => get<{ data: InvoiceDetailDTO }>(`/invoices/${invoiceId}`).then((r) => r.data), [invoiceId]);
  const inv = detail.data;

  async function xml() {
    try {
      await downloadFile(`/invoices/${invoiceId}/xml`, "factura.xml");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Modal title={inv ? `Factura ${inv.serie}-${inv.folio}` : "Factura"} onClose={onClose} wide>
      <State loading={detail.loading} error={detail.error} onRetry={() => void detail.reload()} />
      {inv && (
        <>
          <div className="invoice-sheet">
            <div className="row-between">
              <div>
                <strong>{inv.emisor.name}</strong>
                <p className="muted small">
                  RFC {inv.emisor.rfc} · Régimen {inv.emisor.taxRegime} · CP {inv.emisor.postalCode}
                </p>
              </div>
              <Badge tone={INVOICE_TONE[inv.status]}>{INVOICE_STATUS_LABEL[inv.status]}</Badge>
            </div>

            <dl className="inv-meta">
              <div>
                <dt>Factura</dt>
                <dd>
                  {inv.serie}-{inv.folio}
                </dd>
              </div>
              <div>
                <dt>Pedido</dt>
                <dd>{inv.orderCode}</dd>
              </div>
              <div>
                <dt>Folio fiscal (UUID)</dt>
                <dd className="mono">{inv.uuid ?? "—"}</dd>
              </div>
              <div>
                <dt>Fecha de timbrado</dt>
                <dd>{inv.stampedAt ? dateTime(inv.stampedAt) : "—"}</dd>
              </div>
              <div>
                <dt>Forma de pago</dt>
                <dd>{PAYMENT_FORM[inv.paymentForm] ?? inv.paymentForm} · PUE</dd>
              </div>
            </dl>

            <p className="inv-title">Receptor</p>
            <p className="small">
              <b>{inv.receptor.name}</b> · RFC {inv.receptor.rfc}
              <br />
              CP {inv.receptor.postalCode} · Régimen {inv.receptor.taxRegime} · Uso CFDI {inv.receptor.cfdiUse}
            </p>

            <table className="inv-table">
              <thead>
                <tr>
                  <th>Cant.</th>
                  <th>Concepto</th>
                  <th>P. unitario</th>
                  <th>Importe</th>
                  <th>IVA 16%</th>
                </tr>
              </thead>
              <tbody>
                {inv.concepts.map((c, i) => (
                  <tr key={i}>
                    <td>{c.quantity}</td>
                    <td>{c.description}</td>
                    <td>{money(c.unitPriceCents)}</td>
                    <td>{money(c.amountCents)}</td>
                    <td>{money(c.taxCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(inv.subtotalCents)}</dd>
              </div>
              <div>
                <dt>IVA trasladado 16%</dt>
                <dd>{money(inv.ivaCents)}</dd>
              </div>
              <div className="grand">
                <dt>Total</dt>
                <dd>{money(inv.totalCents)}</dd>
              </div>
            </dl>

            {inv.cancelledAt && (
              <p className="error-box">
                Cancelada el {dateTime(inv.cancelledAt)} (motivo {inv.cancelReason}).{inv.cancelMessage ? ` ${inv.cancelMessage}` : ""}
              </p>
            )}

            {inv.qrBase64 && (
              <div className="inv-seals">
                <img src={`data:image/jpeg;base64,${inv.qrBase64}`} alt="Código QR de verificación del SAT" width={110} height={110} />
                <div>
                  {inv.selloCfd && (
                    <>
                      <p className="inv-title">Sello digital del CFDI</p>
                      <p className="seal">{inv.selloCfd}</p>
                    </>
                  )}
                  {inv.selloSat && (
                    <>
                      <p className="inv-title">Sello del SAT{inv.noCertificadoSat ? ` · certificado ${inv.noCertificadoSat}` : ""}</p>
                      <p className="seal">{inv.selloSat}</p>
                    </>
                  )}
                </div>
              </div>
            )}
            <p className="muted small">Esta es una representación impresa de un CFDI 4.0. El comprobante fiscal es el archivo XML.</p>
          </div>

          <div className="modal-foot no-print">
            <button onClick={() => window.print()}>Imprimir</button>
            <button className="primary" disabled={inv.status === "rejected" || inv.status === "pending"} onClick={() => void xml()}>
              Descargar XML
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
