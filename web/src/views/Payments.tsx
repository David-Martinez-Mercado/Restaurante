import { useState } from "react";
import { get } from "../api";
import { PAYMENT_STATUS_LABEL, type PaymentDTO, type PaymentStatus } from "../types";
import { Badge, PageHead, State, dateTime, money, useLoad } from "../ui";

const TONE: Record<PaymentStatus, string> = { pending: "warn", paid: "ok", failed: "bad", expired: "bad" };

/** Cobros en línea (solo lectura): el estado lo fija únicamente la confirmación firmada de la pasarela. */
export function PaymentsView() {
  const [status, setStatus] = useState<PaymentStatus | "">("");
  const list = useLoad(() => get<{ data: PaymentDTO[] }>(`/payments${status ? `?status=${status}` : ""}`).then((r) => r.data), [status], 10000);

  return (
    <>
      <PageHead title="Pagos en línea" hint="Cobros pedidos por clientes desde el portal. Se actualiza cada 10 s." />

      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus | "")}>
          <option value="">Todos los estados</option>
          {(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((s) => (
            <option key={s} value={s}>
              {PAYMENT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {list.data && list.data.length > 0 && !list.data[0]!.gatewayConfigured && (
        <p className="banner banner-warn">
          La pasarela de pago aún no está conectada (<code>PAYMENT_GATEWAY_URL</code> vacío): los cobros quedan pendientes hasta recibir la confirmación firmada.
        </p>
      )}

      <State loading={list.loading} error={list.error} empty={list.data?.length === 0 && "Todavía no hay pagos en línea."} onRetry={() => void list.reload()} />

      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Pedido</th>
                <th>Importe</th>
                <th>Estado</th>
                <th>Método</th>
                <th>Referencia de la pasarela</th>
                <th>Pagado</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td>{dateTime(p.createdAt)}</td>
                  <td>{p.orderCode}</td>
                  <td>{money(p.amountCents)}</td>
                  <td>
                    <Badge tone={TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                    {p.failureReason && <span className="muted small block">{p.failureReason}</span>}
                  </td>
                  <td>{p.method ?? "—"}</td>
                  <td>{p.gatewayReference ?? "—"}</td>
                  <td>{p.paidAt ? dateTime(p.paidAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
