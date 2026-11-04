import { useEffect, useRef, useState } from "react";
import { get, post } from "../api";
import { InvoiceModal } from "../invoice/InvoiceModal";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  type CustomerDTO,
  type InvoiceDTO,
  type OrderDTO,
  type OrderStatus,
  type PaymentDTO,
  type PaymentStatus,
} from "../types";
import { Badge, Modal, PageHead, State, dateTime, errorMessage, money, useLoad, useToast } from "../ui";

const TONE: Record<OrderStatus, string> = {
  pending: "warn",
  preparing: "info",
  ready: "ok",
  served: "info",
  paid: "muted",
  cancelled: "bad",
};

const PAY_TONE: Record<PaymentStatus, string> = { pending: "warn", paid: "ok", failed: "bad", expired: "bad" };

/** Cuerpo que la pasarela debe enviar al restaurante cuando el cliente paga (ejemplo del contrato). */
function webhookExample(p: PaymentDTO) {
  return {
    eventId: "evt_0001",
    type: "payment.succeeded",
    reference: p.id,
    gatewayReference: "gw_0001",
    amountCents: p.amountCents,
    currency: "MXN",
    method: "card",
    paidAt: new Date().toISOString(),
  };
}

/**
 * Pago en línea. Cuando la pasarela está conectada, manda al cliente a su página de pago.
 * Mientras no lo esté, muestra el contrato de integración: qué se le enviará y qué se espera recibir.
 */
function PayModal({ order, onClose, onDone }: { order: OrderDTO; onClose: () => void; onDone: () => void }) {
  const [payment, setPayment] = useState<PaymentDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const p = (await post<{ data: PaymentDTO }>("/payments", { orderId: order.id })).data;
      setPayment(p);
      if (p.checkoutUrl) window.location.assign(p.checkoutUrl);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Pagar pedido ${order.code}`} onClose={onClose} wide>
      <div className="form">
        <dl className="totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(order.subtotalCents)}</dd>
          </div>
          <div>
            <dt>IVA</dt>
            <dd>{money(order.taxCents)}</dd>
          </div>
          <div className="grand">
            <dt>Total a pagar</dt>
            <dd>{money(order.totalCents)}</dd>
          </div>
        </dl>

        {!payment && (
          <>
            <p className="hint">Serás enviado a la página de pago segura. Aquí no se captura ningún dato de tu tarjeta.</p>
            {error && <p className="error-box">{error}</p>}
            <div className="modal-foot">
              <button onClick={onClose}>Cancelar</button>
              <button className="primary" disabled={busy} onClick={() => void start()}>
                {busy ? "Preparando…" : `Pagar ${money(order.totalCents)}`}
              </button>
            </div>
          </>
        )}

        {payment && !payment.checkoutUrl && (
          <>
            <p className="note-box">
              <b>Pasarela de pago pendiente de conectar.</b> El cobro quedó registrado como <i>pendiente</i> y esto es lo que el restaurante
              le enviará a la pasarela cuando se conecte (<code>POST /v1/charges</code>):
            </p>
            <pre className="json">{JSON.stringify(payment.gatewayRequest, null, 2)}</pre>
            <p className="hint">
              Y esto es lo que la pasarela debe responder al restaurante para confirmar el pago (<code>POST /api/v1/payments/webhook</code>, con el
              encabezado <code>x-signature</code>):
            </p>
            <pre className="json">{JSON.stringify(webhookExample(payment), null, 2)}</pre>
            <p className="hint">Detalle completo en docs/CONTRATO-PASARELA-DE-PAGO.md.</p>
            <div className="modal-foot">
              <button className="primary" onClick={onClose}>
                Entendido
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Resultado del pago al regresar de la pasarela (?payment=ID). Revisa cada 3 s mientras siga pendiente. */
function PaymentReturn({ paymentId, onDismiss, onSettled }: { paymentId: string; onDismiss: () => void; onSettled: () => void }) {
  const p = useLoad(() => get<{ data: PaymentDTO }>(`/payments/${paymentId}`).then((r) => r.data), [paymentId], 3000);
  const status = p.data?.status;
  const settled = useRef(onSettled);
  settled.current = onSettled;

  // Al dejar de estar pendiente, se refrescan los pedidos una sola vez.
  useEffect(() => {
    if (status && status !== "pending") settled.current();
  }, [status]);

  if (p.error) return <p className="error-box">{p.error}</p>;
  if (!p.data) return <p className="muted">Revisando tu pago…</p>;

  const text: Record<PaymentStatus, string> = {
    paid: `¡Pago recibido! Gracias. Pedido ${p.data.orderCode}.`,
    pending: `Estamos esperando la confirmación de tu pago del pedido ${p.data.orderCode}…`,
    failed: `El pago del pedido ${p.data.orderCode} no se completó${p.data.failureReason ? `: ${p.data.failureReason}` : ""}. Puedes intentarlo de nuevo.`,
    expired: `El cobro del pedido ${p.data.orderCode} venció. Puedes intentarlo de nuevo.`,
  };

  return (
    <div className={`banner banner-${p.data.status === "paid" ? "ok" : p.data.status === "pending" ? "warn" : "bad"}`}>
      <span>{text[p.data.status]}</span>
      <button className="link" onClick={onDismiss}>
        Cerrar
      </button>
    </div>
  );
}

export function MyOrders({
  profile,
  returnPaymentId,
  onDismissReturn,
  onGoProfile,
}: {
  profile: CustomerDTO | null;
  returnPaymentId: string | null;
  onDismissReturn: () => void;
  onGoProfile: () => void;
}) {
  const toast = useToast();
  const orders = useLoad(() => get<{ data: OrderDTO[] }>("/orders/mine").then((r) => r.data), [], 5000);
  const payments = useLoad(() => get<{ data: PaymentDTO[] }>("/payments/mine").then((r) => r.data), [], 5000);
  const invoices = useLoad(() => get<{ data: InvoiceDTO[] }>("/invoices").then((r) => r.data), [], 15000);
  const [paying, setPaying] = useState<OrderDTO | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [invoicing, setInvoicing] = useState<string | null>(null);

  const latestPayment = (orderId: string) => (payments.data ?? []).find((p) => p.orderId === orderId);
  // Una factura cancelada deja el pedido libre para facturarlo otra vez; una rechazada, también.
  const invoiceOf = (orderId: string) => (invoices.data ?? []).find((i) => i.orderId === orderId && i.status === "issued");

  async function issue(order: OrderDTO) {
    if (!profile?.billing) {
      toast("Primero guarda tus datos fiscales en Mi perfil", "error");
      onGoProfile();
      return;
    }
    setInvoicing(order.id);
    try {
      const created = (await post<{ data: InvoiceDTO }>("/invoices", { orderId: order.id })).data;
      toast(`Factura ${created.serie}-${created.folio} emitida`);
      await invoices.reload(true);
      setViewing(created.id);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setInvoicing(null);
    }
  }

  return (
    <>
      <PageHead title="Mis pedidos" hint="Se actualiza solo. Te avisamos con la campana 🔔 cuando tu pedido esté listo." />

      {returnPaymentId && (
        <PaymentReturn
          paymentId={returnPaymentId}
          onDismiss={onDismissReturn}
          onSettled={() => {
            void orders.reload(true);
            void payments.reload(true);
          }}
        />
      )}

      <State
        loading={orders.loading}
        error={orders.error}
        empty={orders.data?.length === 0 && "Todavía no has hecho pedidos. Ve a “Pedir en línea”."}
        onRetry={() => void orders.reload()}
      />

      <div className="grid">
        {orders.data?.map((o) => {
          const pay = latestPayment(o.id);
          const canPay = !o.paidAt && o.status !== "cancelled" && o.status !== "paid";
          const invoice = invoiceOf(o.id);
          return (
            <article key={o.id} className={`card order ${o.status === "ready" ? "order-ready" : ""}`}>
              <div className="order-top">
                <strong>Pedido {o.code}</strong>
                <Badge tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
              </div>
              <p className="muted small">
                {o.channel === "pickup" ? "Para recoger" : "En mesa"} · {dateTime(o.createdAt)}
              </p>
              {o.status === "ready" && <p className="ready-msg">🔔 ¡Tu pedido está listo!</p>}
              <ul className="lines">
                {o.items.map((i) => (
                  <li key={i.id}>
                    <span>
                      {i.quantity} × {i.dishName}
                    </span>
                    <span>{money(i.lineTotalCents)}</span>
                  </li>
                ))}
              </ul>
              {o.notes && <p className="note">“{o.notes}”</p>}
              <dl className="totals compact">
                <div className="grand">
                  <dt>Total</dt>
                  <dd>{money(o.totalCents)}</dd>
                </div>
              </dl>
              <div className="order-actions">
                {o.paidAt ? (
                  <Badge tone="ok">Pagado{o.paymentMethod ? ` · ${PAYMENT_METHOD_LABEL[o.paymentMethod]}` : ""}</Badge>
                ) : pay && pay.status === "pending" ? (
                  <Badge tone="warn">Pago {PAYMENT_STATUS_LABEL[pay.status].toLowerCase()}</Badge>
                ) : pay && pay.status !== "paid" ? (
                  <Badge tone={PAY_TONE[pay.status]}>Último intento: {PAYMENT_STATUS_LABEL[pay.status].toLowerCase()}</Badge>
                ) : null}
                {canPay && (
                  <button className="small-btn primary" onClick={() => setPaying(o)}>
                    Pagar en línea
                  </button>
                )}
                {o.status === "paid" && invoice && (
                  <>
                    <Badge tone="ok">Facturado {invoice.serie}-{invoice.folio}</Badge>
                    <button className="small-btn" onClick={() => setViewing(invoice.id)}>
                      Ver factura
                    </button>
                  </>
                )}
                {o.status === "paid" && !invoice && invoices.data && (
                  <button className="small-btn" disabled={invoicing === o.id} onClick={() => void issue(o)}>
                    {invoicing === o.id ? "Timbrando…" : "Facturar"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {viewing && <InvoiceModal invoiceId={viewing} onClose={() => setViewing(null)} />}

      {paying && (
        <PayModal
          order={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            toast("Cobro creado");
            void payments.reload(true);
          }}
        />
      )}
    </>
  );
}
