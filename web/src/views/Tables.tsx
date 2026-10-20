import { useState, type FormEvent } from "react";
import { del, get, patch, post } from "../api";
import { useAuth } from "../auth";
import { TABLE_STATUS_LABEL, type TableDTO, type TableStatus } from "../types";
import { Badge, Modal, PageHead, State, errorMessage, useLoad, useToast } from "../ui";

const TONE: Record<TableStatus, string> = { free: "ok", occupied: "bad", reserved: "warn" };
const STATUSES = Object.keys(TABLE_STATUS_LABEL) as TableStatus[];

function NewTable({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const [number, setNumber] = useState("");
  const [capacity, setCapacity] = useState("4");

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await post("/tables", { number: Number(number), capacity: Number(capacity) });
      toast("Mesa creada");
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Modal title="Nueva mesa" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="row">
          <label>
            Número
            <input type="number" min="1" max="999" value={number} onChange={(e) => setNumber(e.target.value)} required autoFocus />
          </label>
          <label>
            Capacidad
            <input type="number" min="1" max="30" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
          </label>
        </div>
        <div className="modal-foot">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary">Crear</button>
        </div>
      </form>
    </Modal>
  );
}

export function TablesView() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get<{ data: TableDTO[] }>("/tables").then((r) => r.data), [], 8000);
  const [creating, setCreating] = useState(false);

  async function setStatus(t: TableDTO, status: TableStatus) {
    try {
      await patch(`/tables/${t.id}/status`, { status });
      void reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function remove(t: TableDTO) {
    if (!confirm(`¿Eliminar la mesa ${t.number}?`)) return;
    try {
      await del(`/tables/${t.id}`);
      toast("Mesa eliminada");
      void reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const canStatus = can("tables:update-status", "tables:write");

  return (
    <>
      <PageHead title="Mesas" hint="Una mesa pasa a ocupada al abrir un pedido y se libera al cobrar o cancelar.">
        {can("tables:write") && (
          <button className="primary" onClick={() => setCreating(true)}>
            + Nueva mesa
          </button>
        )}
      </PageHead>

      <State loading={loading} error={error} empty={data?.length === 0 && "Aún no hay mesas."} onRetry={() => void reload()} />

      <div className="grid grid-sm">
        {data?.map((t) => (
          <article key={t.id} className={`card table table-${t.status}`}>
            <div className="table-num">{t.number}</div>
            <p className="muted small">{t.capacity} personas</p>
            <Badge tone={TONE[t.status]}>{TABLE_STATUS_LABEL[t.status]}</Badge>
            {canStatus && (
              <select
                aria-label={`Estado de la mesa ${t.number}`}
                value={t.status}
                onChange={(e) => void setStatus(t, e.target.value as TableStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TABLE_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
            {can("tables:write") && (
              <button className="small-btn danger" onClick={() => void remove(t)}>
                Eliminar
              </button>
            )}
          </article>
        ))}
      </div>

      {creating && (
        <NewTable
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            void reload(true);
          }}
        />
      )}
    </>
  );
}
