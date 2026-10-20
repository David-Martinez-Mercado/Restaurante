import { useMemo, useState } from "react";
import { get, post } from "../api";
import { CATEGORY_LABEL, TAX_RATE, type CustomerDTO, type DishCategory, type DishDTO } from "../types";
import { PageHead, State, errorMessage, money, useLoad, useToast } from "../ui";

const ORDER: DishCategory[] = ["starter", "main", "side", "dessert", "drink"];

export function OrderOnline({ profile, onDone }: { profile: CustomerDTO | null; onDone: () => void }) {
  const toast = useToast();
  const dishes = useLoad(() => get<{ data: DishDTO[] }>("/dishes?available=true").then((r) => r.data));
  const [qty, setQty] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const lines = useMemo(
    () => (dishes.data ?? []).filter((d) => (qty[d.id] ?? 0) > 0).map((d) => ({ dish: d, quantity: qty[d.id]! })),
    [dishes.data, qty]
  );
  const subtotal = lines.reduce((s, l) => s + l.dish.priceCents * l.quantity, 0);
  const tax = Math.round(subtotal * TAX_RATE);

  const grouped = useMemo(() => {
    const map = new Map<DishCategory, DishDTO[]>();
    for (const d of dishes.data ?? []) map.set(d.category, [...(map.get(d.category) ?? []), d]);
    return ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, dishes: map.get(c)! }));
  }, [dishes.data]);

  const change = (id: string, delta: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(50, (q[id] ?? 0) + delta)) }));

  async function submit() {
    setBusy(true);
    try {
      await post("/orders/online", {
        notes: notes || undefined,
        items: lines.map((l) => ({ dishId: l.dish.id, quantity: l.quantity })),
      });
      toast("Pedido enviado a la cocina. Te avisaremos cuando esté listo 🔔");
      setQty({});
      setNotes("");
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Pedir en línea" hint="Pide para recoger. Puedes pagar aquí mismo o al recoger en caja." />

      {!profile && (
        <p className="note-box">
          Antes de pedir necesitamos tu nombre y teléfono. <a href="#perfil">Completar mi perfil</a>
        </p>
      )}

      <State loading={dishes.loading} error={dishes.error} empty={dishes.data?.length === 0 && "Por ahora no hay platillos disponibles."} onRetry={() => void dishes.reload()} />

      <div className="shop">
        <div className="shop-menu">
          {grouped.map((g) => (
            <section key={g.category}>
              <h3 className="section-title">{CATEGORY_LABEL[g.category]}</h3>
              <div className="card picker-flat">
                {g.dishes.map((d) => (
                  <div key={d.id} className="pick-row">
                    <span>
                      <b>{d.name}</b>
                      {d.description && <span className="muted small block">{d.description}</span>}
                      <span className="price small">{money(d.priceCents)}</span>
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
            </section>
          ))}
        </div>

        <aside className="card cart">
          <h3>Tu pedido</h3>
          {lines.length === 0 ? (
            <p className="muted small">Agrega platillos con el botón +.</p>
          ) : (
            <ul className="lines">
              {lines.map((l) => (
                <li key={l.dish.id}>
                  <span>
                    {l.quantity} × {l.dish.name}
                  </span>
                  <span>{money(l.dish.priceCents * l.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
          <label>
            Notas
            <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Término del corte, alergias…" />
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
          <button className="primary" disabled={busy || !profile || lines.length === 0} onClick={() => void submit()}>
            {busy ? "Enviando…" : "Hacer pedido"}
          </button>
        </aside>
      </div>
    </>
  );
}
