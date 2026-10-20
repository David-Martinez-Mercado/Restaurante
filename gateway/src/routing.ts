/**
 * Tabla de enrutamiento del gateway. Es pura (sin Nest) para poder probarla.
 * El gateway no conoce la lógica de los servicios: solo a cuál reenviar.
 */
export type ServiceName =
  | "user"
  | "menu"
  | "order"
  | "audit"
  | "customer"
  | "reservation"
  | "notification"
  | "payment"
  | "attendance"
  | "payroll";

export interface UpstreamRule {
  prefix: string;
  service: ServiceName;
  /** Si se define, solo estos métodos se reenvían (el resto recibe 405). */
  methods?: string[];
}

/**
 * Nota: ningún prefijo apunta a /api/v1/internal. Las rutas internas (eventos, llaves entre
 * servicios, confirmación de pagos) no existen para el exterior: el gateway responde 404.
 */
export const ROUTES: UpstreamRule[] = [
  { prefix: "/api/v1/auth", service: "user" },
  { prefix: "/api/v1/dishes", service: "menu" },
  { prefix: "/api/v1/tables", service: "menu" },
  { prefix: "/api/v1/orders", service: "order" },
  { prefix: "/api/v1/customers", service: "customer" },
  { prefix: "/api/v1/reservations", service: "reservation" },
  { prefix: "/api/v1/notifications", service: "notification" },
  { prefix: "/api/v1/payments", service: "payment" },
  // El IVA vive en el Order Service (es el dueño de los pedidos y sus importes).
  { prefix: "/api/v1/tax", service: "order" },
  { prefix: "/api/v1/attendance", service: "attendance" },
  { prefix: "/api/v1/payroll", service: "payroll" },
  // La ingesta de auditoría es solo interna: desde afuera solo se consulta.
  { prefix: "/api/v1/audit", service: "audit", methods: ["GET"] },
];

export function matchRoute(path: string): UpstreamRule | null {
  return (
    ROUTES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`)) ?? null
  );
}

/** Webhook de la pasarela de pago: no lleva JWT, se autentica con la firma HMAC del cuerpo. */
export const PAYMENT_WEBHOOK_PATH = "/api/v1/payments/webhook";

/** Endpoints que no requieren token: el flujo de login, el webhook de pagos y las sondas de salud. */
const PUBLIC: { method: string; path: string }[] = [
  { method: "POST", path: "/api/v1/auth/register" },
  { method: "POST", path: "/api/v1/auth/login" },
  { method: "POST", path: "/api/v1/auth/refresh-token" },
  { method: "POST", path: "/api/v1/auth/logout" },
  { method: "POST", path: PAYMENT_WEBHOOK_PATH },
  { method: "GET", path: "/healthz" },
  { method: "GET", path: "/api/v1/gateway/health" },
];

function clean(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function isPublic(method: string, path: string): boolean {
  const p = clean(path);
  return PUBLIC.some((r) => r.method === method.toUpperCase() && r.path === p);
}

/**
 * Encabezados extra que cruzan el gateway solo en rutas concretas.
 * La firma del webhook debe llegar intacta al Payment Service, que es quien la verifica.
 */
export function extraForwardedHeaders(path: string): string[] {
  return clean(path) === PAYMENT_WEBHOOK_PATH ? ["x-signature"] : [];
}
