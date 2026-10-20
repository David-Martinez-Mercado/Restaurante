import { useState, type FormEvent } from "react";
import { del, get, patch, post, put } from "../api";
import { useAuth } from "../auth";
import { CATEGORY_LABEL, type DishCategory, type DishDTO } from "../types";
import { Badge, Modal, PageHead, State, errorMessage, money, useLoad, useToast } from "../ui";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as DishCategory[];

interface Draft {
  name: string;
  description: string;
  price: string;
  category: DishCategory;
  available: boolean;
}

const emptyDraft: Draft = { name: "", description: "", price: "", category: "main", available: true };

function DishForm({ dish, onDone, onClose }: { dish: DishDTO | null; onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(
    dish
      ? {
          name: dish.name,
          description: dish.description ?? "",
          price: (dish.priceCents / 100).toString(),
          category: dish.category,
          available: dish.available,
        }
      : emptyDraft
  );
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      name: draft.name,
      description: draft.description || undefined,
      priceCents: Math.round(Number(draft.price) * 100),
      category: draft.category,
      available: draft.available,
    };
    try {
      if (dish) await put(`/dishes/${dish.id}`, body);
      else await post("/dishes", body);
      toast(dish ? "Platillo actualizado" : "Platillo creado");
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={dish ? "Editar platillo" : "Nuevo platillo"} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Nombre
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} required minLength={2} autoFocus />
        </label>
        <label>
          Descripción
          <textarea value={draft.description} onChange={(e) => set("description", e.target.value)} rows={2} />
        </label>
        <div className="row">
          <label>
            Precio (MXN, sin IVA)
            <input type="number" min="0.01" step="0.01" value={draft.price} onChange={(e) => set("price", e.target.value)} required />
          </label>
          <label>
            Categoría
            <select value={draft.category} onChange={(e) => set("category", e.target.value as DishCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.available} onChange={(e) => set("available", e.target.checked)} />
          Disponible
        </label>
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

export function MenuView() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get<{ data: DishDTO[] }>("/dishes").then((r) => r.data));
  const [editing, setEditing] = useState<DishDTO | "new" | null>(null);

  const canWrite = can("dishes:write");
  const canToggle = can("dishes:availability", "dishes:write");

  async function toggle(d: DishDTO) {
    try {
      await patch(`/dishes/${d.id}/availability`, { available: !d.available });
      toast(d.available ? `"${d.name}" marcado como agotado` : `"${d.name}" disponible de nuevo`);
      void reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function remove(d: DishDTO) {
    if (!confirm(`¿Eliminar "${d.name}"?`)) return;
    try {
      await del(`/dishes/${d.id}`);
      toast("Platillo eliminado");
      void reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <>
      <PageHead title="Menú" hint="Catálogo de platillos. Los precios no incluyen IVA.">
        {canWrite && (
          <button className="primary" onClick={() => setEditing("new")}>
            + Nuevo platillo
          </button>
        )}
      </PageHead>

      <State loading={loading} error={error} empty={data?.length === 0 && "Aún no hay platillos."} onRetry={() => void reload()} />

      {CATEGORIES.map((cat) => {
        const dishes = data?.filter((d) => d.category === cat) ?? [];
        if (!dishes.length) return null;
        return (
          <section key={cat}>
            <h3 className="section-title">{CATEGORY_LABEL[cat]}</h3>
            <div className="grid">
              {dishes.map((d) => (
                <article key={d.id} className={`card dish ${d.available ? "" : "dim"}`}>
                  <div className="dish-top">
                    <strong>{d.name}</strong>
                    <span className="price">{money(d.priceCents)}</span>
                  </div>
                  {d.description && <p className="muted small">{d.description}</p>}
                  <div className="dish-foot">
                    {d.available ? <Badge tone="ok">Disponible</Badge> : <Badge tone="bad">Agotado</Badge>}
                    <span className="spacer" />
                    {canToggle && (
                      <button className="small-btn" onClick={() => void toggle(d)}>
                        {d.available ? "Marcar agotado" : "Reponer"}
                      </button>
                    )}
                    {canWrite && (
                      <>
                        <button className="small-btn" onClick={() => setEditing(d)}>
                          Editar
                        </button>
                        <button className="small-btn danger" onClick={() => void remove(d)}>
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      {editing && (
        <DishForm
          dish={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void reload(true);
          }}
        />
      )}
    </>
  );
}
