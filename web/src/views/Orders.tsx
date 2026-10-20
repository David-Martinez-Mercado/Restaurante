import { useMemo, useState } from "react";
import { get, patch, post } from "../api";
import { useAuth } from "../auth";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  TAX_RATE,
  type CustomerSummaryDTO,
  type DishDTO,
  type OrderDTO,
  type OrderStatus,
  type Permission,
  type TableDTO,
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

/** Mismo flujo que el Order Service: cada paso exige su permiso. */
const ACTIONS: Record<OrderStatus, { to: OrderStatus; label: string; permission: Permission; danger?: boolean }[]> = {
  pending: [
    { to: "preparing", label: "Preparar", permission: "orders:prepare" },
    { to: "cancelled", label: "Cancelar", permission: "orders:cancel", danger: true },
  ],
  preparing: [
    { to: "ready", label: "Marcar listo", permission: "orders:prepare" },
    { to: "cancelled", label: "Cancelar", permission: "orders:cancel", danger: true },
  ],
  ready: [{ to: "served", label: "Servir", permission: "orders:serve" }],
  served: [{ to: "paid", label: "Cobrar", permission: "orders:pay" }],
  paid: [],
  cancelled: [],
};

const ACTIVE: OrderStatus[] = ["pending", "preparing", "ready", "served"];
type Filter = "active" | "all" | OrderStatus;

/** El cajero indica cómo pagó el cliente en el mostrador; el pago en línea no pasa por aquí. */
function CounterPayment({ order, onClose, onPay }: { order: OrderDTO; onClose: () => void; onPay: (m: "cash" | "card") => void }) {
  return (
    <Modal title={`Cobrar pedido ${order.code}`} onClose={onClose}>
      <div className="form">
        <dl className="totals">
          <div className="grand">
            <dt>Total a cobrar</dt>
            <dd>{money(order.totalCents)}</dd>
          </div>
        </dl>
        <p className="hint">¿Cómo pagó el cliente?</p>
        <div className="row">
          <button className="primary" onClick={() => onPay("cash")}>
            {PAYMENT_METHOD_LABEL.cash}
          </button>
          <button className="primary" onClick={() => onPay("card")}>
            {PAYMENT_METHOD_LABEL.card}
          </button>
        </div>
        {order.customerName && (
          <p className="hint">Al cobrar, {order.customerName} recibirá el resumen de su consumo y la pregunta de si va a facturar.</p>
        )}
        <div className="modal-foot">
          <button onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

function NewOrder({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const tables = useLoad(() => get<{ data: TableDTO[] }>("/tables?status=free").then((r) => r.data));
  const dishes = useLoad(() => get<{ data: DishDTO[] }>("/dishes?available=true").then((r) => r.data));
  const [search, setSearch] = useState("");
  const customers = useLoad(
    () =>
      can("customers:read") && search.trim().length >= 2
        ? get<{ data: CustomerSummaryDTO[] }>(`/customers?search=${encodeURIComponent(search.trim())}`).then((r) => r.data)
        : Promise.resolve([] as CustomerSummaryDTO[]),
    [search]
  );
  const [customerUserId, setCustomerUserId] = useState("");
  const [tableId, setTableId] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const lines = useMemo(
    () => (dishes.data ?? []).filter((d) => (qty[d.id] ?? 0) > 0).map((d) => ({ dish: d, quantity: qty[d.id]! })),
    [dishes.data, qty]
  );
  const subtotal = lines.reduce((s, l) => s + l.dish.priceCents * l.quantity, 0);
  const tax = Math.round(subtotal * TAX_RATE);

  const change = (id: string, delta: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(50, (q[id] ?? 0) + delta)) }));

  async function submit() {
    setBusy(true);
    try {
      await post("/orders", {
        tableId,
        notes: notes || undefined,
        customerUserId: customerUserId || undefined,
        items: lines.map((l) => ({ dishId: l.dish.id, quantity: l.quantity })),
      });
      toast("Pedido creado");
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo pedido" onClose={onClose} wide>
      <div className="form">
        <label>
          Mesa libre
          <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">Selecciona una mesa…</option>
            {tables.data?.map((t) => (
              <option key={t.id} value={t.id}>
                Mesa {t.number} ({t.capacity} personas)
              </option>
            ))}
          </select>
        </label>
        {tables.data?.length === 0 && <p className="hint">No hay mesas libres.</p>}

        {can("customers:read") && (
          <div className="row">
            <label>
              Cliente registrado (opcional)
              <input value={search} onChange={(e) => (setSearch(e.target.value), setCustomerUserId(""))} placeholder="Buscar por nombre o teléfono…" />
            </label>
            <label>
              Cliente
              <select value={customerUserId} onChange={(e) => setCustomerUserId(e.target.value)} disabled={!customers.data?.length}>
                <option value="">{customers.data?.length ? "Selecciona…" : "Sin cliente"}</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.userId}>
                    {c.fullName} · {c.phone}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {customerUserId && <p className="hint">Al pagar, este cliente recibirá su consumo por la app y por Telegram (si lo vinculó).</p>}

        <State loading={dishes.loading} error={dishes.error} empty={dishes.data?.length === 0 && "No hay platillos disponibles."} />
        <div className="picker">
          {dishes.data?.map((d) => (
            <div key={d.id} className="pick-row">
              <span>
                {d.name} <span className="muted small">{money(d.priceCents)}</span>
              </span>
              <span className="stepper">
                <button type="button" onClick={() => change(d.id, -1)} aria-label={`Quitar ${d.name}`}>
                  −
                </button>
                <b>{qty[d.id] ?? 0}</b>
                <button type="button" onClick={() => change(d.id, 1)} aria-label={`Agregar ${d.name}`}>
                  +
                </button>
              </span>
            </div>
          ))}
        </div>

        <label>
          Notas
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Sin cebolla, alergias…" />
        </label>

        <dl className="totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(subtotal)}</dd>
          </div>
          <div>
            <dt>IVA 16 %</dt>
            <dd>{money(tax)}</dd>
          </div>
          <div className="grand">
            <dt>Total</dt>
            <dd>{money(subtotal + tax)}</dd>
          </div>
        </dl>

        <div className="modal-foot">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !tableId || lines.length === 0} onClick={() => void submit()}>
            Crear pedido
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function OrdersView() {
  const { can } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("active");
  const [creating, setCreating] = useState(false);

  const orders = useLoad(() => get<{ data: OrderDTO[] }>("/orders").then((r) => r.data), [], 5000);
  // El cocinero no tiene tables:read: en ese caso se muestra un identificador corto.
  const tables = useLoad(
    () => (can("tables:read") ? get<{ data: TableDTO[] }>("/tables").then((r) => r.data) : Promise.resolve([] as TableDTO[])),
    [can("tables:read")],
    15000
  );
  const tableNumber = useMemo(() => new Map(tables.data?.map((t) => [t.id, t.number] as const)), [tables.data]);

  const visible = useMemo(() => {
    const all = orders.data ?? [];
    if (filter === "all") return all;
    if (filter === "active") return all.filter((o) => ACTIVE.includes(o.status));
    return all.filter((o) => o.status === filter);
  }, [orders.data, filter]);

  const [charging, setCharging] = useState<OrderDTO | null>(null);

  async function move(o: OrderDTO, to: OrderStatus, paymentMethod?: "cash" | "card") {
    try {
      await patch(`/orders/${o.id}/status`, { status: to, paymentMethod });
      toast(`Pedido: ${ORDER_STATUS_LABEL[to].toLowerCase()}`);
      void orders.reload(true);
      void tables.reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  /** Cobrar pide el método de pago; el resto de los pasos se aplican directo. */
  function act(o: OrderDTO, to: OrderStatus) {
    if (to === "paid") setCharging(o);
    else void move(o, to);
  }

  const filters: { value: Filter; label: string }[] = [
    { value: "active", label: "Activos" },
    { value: "all", label: "Todos" },
    ...(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((s) => ({ value: s as Filter, label: ORDER_STATUS_LABEL[s] })),
  ];

  return (
    <>
      <PageHead title="Pedidos" hint="Se actualiza solo cada 5 segundos.">
        {can("orders:create") && (
          <button className="primary" onClick={() => setCreating(true)}>
            + Nuevo pedido
          </button>
        )}
      </PageHead>

      <div className="chips">
        {filters.map((f) => (
          <button key={f.value} className={`chip ${filter === f.value ? "on" : ""}`} onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      <State
        loading={orders.loading}
        error={orders.error}
        empty={orders.data && visible.length === 0 && "No hay pedidos en esta vista."}
        onRetry={() => void orders.reload()}
      />

      <div className="grid">
        {visible.map((o) => {
          const actions = ACTIONS[o.status].filter((a) => can(a.permission));
          const num = o.tableId ? tableNumber.get(o.tableId) : undefined;
          const title = !o.tableId ? `En línea · ${o.code}` : num !== undefined ? `Mesa ${num}` : `Mesa ${o.tableId.slice(0, 4)}`;
          return (
            <article key={o.id} className="card order">
              <div className="order-top">
                <strong>{title}</strong>
                <Badge tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
              </div>
              <p className="muted small">
                {dateTime(o.createdAt)}
                {o.customerName ? ` · ${o.customerName}` : ""}
              </p>
              {o.channel === "pickup" && <p className="small">🛍 Para recoger</p>}
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
                <div>
                  <dt>Subtotal</dt>
                  <dd>{money(o.subtotalCents)}</dd>
                </div>
                <div>
                  <dt>IVA</dt>
                  <dd>{money(o.taxCents)}</dd>
                </div>
                <div className="grand">
                  <dt>Total</dt>
                  <dd>{money(o.totalCents)}</dd>
                </div>
              </dl>
              {o.paidAt && (
                <p className="small">
                  <Badge tone="ok">Pagado{o.paymentMethod ? ` · ${PAYMENT_METHOD_LABEL[o.paymentMethod]}` : ""}</Badge>
                </p>
              )}
              {actions.length > 0 && (
                <div className="order-actions">
                  {actions.map((a) => (
                    <button key={a.to} className={a.danger ? "small-btn danger" : "small-btn primary"} onClick={() => act(o, a.to)}>
                      {a.to === "served" && o.channel === "pickup" ? "Entregar al cliente" : a.label}
                    </button>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {charging && (
        <CounterPayment
          order={charging}
          onClose={() => setCharging(null)}
          onPay={(method) => {
            const o = charging;
            setCharging(null);
            void move(o, "paid", method);
          }}
        />
      )}

      {creating && (
        <NewOrder
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void orders.reload(true);
            void tables.reload(true);
          }}
        />
      )}
    </>
  );
}
