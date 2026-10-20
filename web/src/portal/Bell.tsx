import { useEffect, useRef, useState } from "react";
import { get, patch, post } from "../api";
import type { NotificationDTO } from "../types";
import { dateTime, errorMessage, useLoad, useToast } from "../ui";

/**
 * Campana de avisos del cliente. Consulta cada 5 s y, cuando llega un aviso nuevo
 * (por ejemplo "tu pedido está listo"), lo muestra como mensaje emergente.
 */
export function Bell() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);

  const list = useLoad(() => get<{ data: NotificationDTO[] }>("/notifications/mine?limit=30").then((r) => r.data), [], 5000);
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  // La primera carga solo "memoriza": no se avisa de lo que ya estaba antes de abrir la página.
  useEffect(() => {
    if (!list.data) return;
    if (seen.current === null) {
      seen.current = new Set(list.data.map((n) => n.id));
      return;
    }
    for (const n of list.data) {
      if (!seen.current.has(n.id)) {
        seen.current.add(n.id);
        if (!n.readAt) toast(`🔔 ${n.title}`);
      }
    }
  }, [list.data, toast]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function markRead(n: NotificationDTO) {
    if (n.readAt) return;
    try {
      await patch(`/notifications/${n.id}/read`, {});
      void list.reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function markAll() {
    try {
      await post("/notifications/mine/read-all");
      void list.reload(true);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <div className="bell" ref={box}>
      <button className="bell-btn" onClick={() => setOpen((o) => !o)} aria-label={`Avisos${unread ? `, ${unread} sin leer` : ""}`} aria-expanded={open}>
        🔔{unread > 0 && <span className="bell-count">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel card" role="dialog" aria-label="Avisos">
          <div className="bell-head">
            <strong>Avisos</strong>
            {unread > 0 && (
              <button className="link small" onClick={() => void markAll()}>
                Marcar todo como leído
              </button>
            )}
          </div>
          {items.length === 0 && <p className="muted small">Aún no tienes avisos. Aquí te diremos cuando tu pedido esté listo.</p>}
          <ul className="bell-list">
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? "" : "unread"}>
                <button onClick={() => void markRead(n)}>
                  <b>{n.title}</b>
                  <span className="bell-body">{n.body}</span>
                  <span className="muted small">{dateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
