import { useCallback, useEffect, useState } from "react";
import { ApiError, get } from "../api";
import { useAuth } from "../auth";
import type { CustomerDTO } from "../types";
import { State, useLoad } from "../ui";
import { Bell } from "./Bell";
import { MyOrders } from "./MyOrders";
import { MyReservations } from "./MyReservations";
import { OrderOnline } from "./OrderOnline";
import { Profile } from "./Profile";

const TABS = [
  { id: "pedir", label: "Pedir en línea" },
  { id: "pedidos", label: "Mis pedidos" },
  { id: "reservaciones", label: "Reservaciones" },
  { id: "perfil", label: "Mi perfil" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const isTab = (v: string): v is TabId => TABS.some((t) => t.id === v);

/** Al volver de la pasarela la URL trae ?payment=ID: se toma una vez y se limpia la dirección. */
function takeReturnedPayment(): string | null {
  const id = new URLSearchParams(location.search).get("payment");
  if (id) history.replaceState(null, "", "/#pedidos");
  return id;
}

/** Portal del cliente en línea: pedir, pagar, reservar y administrar su perfil. */
export function Portal() {
  const { user, logout } = useAuth();
  const [returnedPayment, setReturnedPayment] = useState<string | null>(takeReturnedPayment);
  const [current, setCurrent] = useState<TabId>(() => {
    const h = location.hash.slice(1);
    return isTab(h) ? h : "pedir";
  });

  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1);
      if (isTab(h)) setCurrent(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Sin perfil el API responde 404: eso no es un error, es "falta completarlo".
  const profile = useLoad(async (): Promise<CustomerDTO | null> => {
    try {
      return (await get<{ data: CustomerDTO }>("/customers/me")).data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  });

  const goTo = useCallback((tab: TabId) => {
    location.hash = tab;
    setCurrent(tab);
  }, []);

  const ready = !profile.loading && !profile.error;
  const me = profile.data ?? null;

  return (
    <>
      <header className="topbar">
        <strong className="brand">🥩 Asador La Brasa</strong>
        <nav aria-label="Secciones">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={t.id === current ? "on" : ""}>
              {t.label}
            </a>
          ))}
        </nav>
        <div className="who">
          <Bell />
          <span>{me?.fullName ?? user?.username}</span>
          <button onClick={() => void logout()}>Salir</button>
        </div>
      </header>

      <main className="content">
        <State loading={profile.loading} error={profile.error} onRetry={() => void profile.reload()} />
        {ready && current === "pedir" && <OrderOnline profile={me} onDone={() => goTo("pedidos")} />}
        {ready && current === "pedidos" && <MyOrders returnPaymentId={returnedPayment} onDismissReturn={() => setReturnedPayment(null)} />}
        {ready && current === "reservaciones" && <MyReservations profile={me} />}
        {ready && current === "perfil" && <Profile key={me?.id ?? "nuevo"} profile={me} reload={() => void profile.reload(true)} />}
      </main>
    </>
  );
}
