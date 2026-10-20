import { useEffect, useState, type ReactElement } from "react";
import { AuthProvider, useAuth } from "./auth";
import { Portal } from "./portal/Portal";
import { ROLE_LABEL, type Permission } from "./types";
import { ToastProvider } from "./ui";
import { AttendanceAdminView } from "./views/AttendanceAdmin";
import { AuditView } from "./views/Audit";
import { ClockView } from "./views/Clock";
import { Login } from "./views/Login";
import { MenuView } from "./views/Menu";
import { NotificationsView } from "./views/Notifications";
import { OrdersView } from "./views/Orders";
import { PaymentsView } from "./views/Payments";
import { PayrollView } from "./views/Payroll";
import { ReservationsView } from "./views/Reservations";
import { TablesView } from "./views/Tables";
import { TaxView } from "./views/Tax";
import { UsersView } from "./views/Users";

interface Tab {
  id: string;
  label: string;
  permission: Permission;
  view: () => ReactElement;
}

// Cada pestaña solo aparece si el rol tiene el permiso. El backend vuelve a
// comprobarlo en cada petición: ocultar una pestaña es comodidad, no seguridad.
const TABS: Tab[] = [
  { id: "orders", label: "Pedidos", permission: "orders:read", view: () => <OrdersView /> },
  { id: "reservations", label: "Reservaciones", permission: "reservations:read-all", view: () => <ReservationsView /> },
  { id: "tables", label: "Mesas", permission: "tables:read", view: () => <TablesView /> },
  { id: "menu", label: "Menú", permission: "dishes:read", view: () => <MenuView /> },
  { id: "payments", label: "Pagos en línea", permission: "payments:read-all", view: () => <PaymentsView /> },
  { id: "notifications", label: "Avisos", permission: "notifications:read-all", view: () => <NotificationsView /> },
  { id: "clock", label: "Checador", permission: "attendance:clock", view: () => <ClockView /> },
  { id: "attendance", label: "Asistencia", permission: "attendance:read-all", view: () => <AttendanceAdminView /> },
  { id: "payroll", label: "Nómina", permission: "payroll:read-all", view: () => <PayrollView /> },
  { id: "tax", label: "IVA", permission: "tax:calculate", view: () => <TaxView /> },
  { id: "audit", label: "Auditoría", permission: "audit:read", view: () => <AuditView /> },
  { id: "users", label: "Usuarios", permission: "users:read", view: () => <UsersView /> },
];

/** Panel del personal (mesero, cocina, caja, gerencia y administración). */
function StaffShell() {
  const { user, permissions, can, logout } = useAuth();
  const tabs = TABS.filter((t) => can(t.permission));
  const [current, setCurrent] = useState(() => location.hash.slice(1));

  useEffect(() => {
    const onHash = () => setCurrent(location.hash.slice(1));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const active = tabs.find((t) => t.id === current) ?? tabs[0];

  return (
    <>
      <header className="topbar">
        <strong className="brand">🥩 Asador La Brasa</strong>
        <nav aria-label="Secciones">
          {tabs.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={t.id === active?.id ? "on" : ""}>
              {t.label}
            </a>
          ))}
        </nav>
        <div className="who" title={`Permisos: ${permissions.join(", ")}`}>
          <span>{user?.username}</span>
          <span className="role">{user ? ROLE_LABEL[user.role] : ""}</span>
          <button onClick={() => void logout()}>Salir</button>
        </div>
      </header>
      <main className="content">{active ? active.view() : <p className="muted">Tu rol no tiene secciones disponibles.</p>}</main>
    </>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">Cargando…</p>;
  if (!user) return <Login />;
  // Los clientes entran al portal en línea; el resto de los roles, al panel del personal.
  return user.role === "customer" ? <Portal /> : <StaffShell />;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AuthProvider>
  );
}
