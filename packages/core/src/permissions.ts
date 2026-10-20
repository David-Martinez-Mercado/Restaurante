import type { Role } from "./roles.js";

/**
 * AUTORIZACIÓN (segunda "A"): permisos granulares por acción.
 * Los endpoints exigen un permiso, no un rol; la matriz rol -> permisos
 * vive aquí, en un único lugar, para que todos los servicios coincidan.
 *
 * Los permisos "-own" / "-all" separan lo propio de lo ajeno: un cliente
 * solo ve sus pedidos, pagos, reservaciones y avisos.
 */
export const PERMISSIONS = [
  "users:read",
  "users:manage",
  "dishes:read",
  "dishes:write",
  "dishes:availability",
  "tables:read",
  "tables:write",
  "tables:update-status",
  "orders:read",
  "orders:create",
  "orders:prepare",
  "orders:serve",
  "orders:pay",
  "orders:cancel",
  "orders:create-online",
  "orders:read-own",
  "customers:read",
  "customers:self",
  "payments:create",
  "payments:read-own",
  "payments:read-all",
  "reservations:create",
  "reservations:read-own",
  "reservations:read-all",
  "reservations:manage",
  "notifications:read-own",
  "notifications:read-all",
  "attendance:clock",
  "attendance:read-all",
  "attendance:manage",
  "payroll:read-own",
  "payroll:read-all",
  "payroll:manage",
  "payroll:calculate",
  "payroll:approve",
  "tax:calculate",
  "tax:report",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  manager: [
    "users:read",
    "dishes:read",
    "dishes:write",
    "dishes:availability",
    "tables:read",
    "tables:write",
    "tables:update-status",
    "orders:read",
    "orders:create",
    "orders:prepare",
    "orders:serve",
    "orders:pay",
    "orders:cancel",
    "customers:read",
    "payments:read-all",
    "reservations:create",
    "reservations:read-all",
    "reservations:manage",
    "notifications:read-own",
    "notifications:read-all",
    "attendance:clock",
    "attendance:read-all",
    "attendance:manage",
    "payroll:read-own",
    "payroll:read-all",
    "payroll:manage",
    // Segregación de funciones: el gerente calcula la nómina, solo el administrador la aprueba.
    "payroll:calculate",
    "tax:calculate",
    "tax:report",
    "audit:read",
  ],
  waiter: [
    "dishes:read",
    "tables:read",
    "tables:update-status",
    "orders:read",
    "orders:create",
    "orders:serve",
    "orders:cancel",
    "customers:read",
    "reservations:create",
    "reservations:read-all",
    "reservations:manage",
    "notifications:read-own",
    "attendance:clock",
    "payroll:read-own",
  ],
  cook: [
    "dishes:read",
    "dishes:availability",
    "orders:read",
    "orders:prepare",
    "notifications:read-own",
    "attendance:clock",
    "payroll:read-own",
  ],
  cashier: [
    "dishes:read",
    "tables:read",
    "tables:update-status",
    "orders:read",
    "orders:pay",
    "payments:read-all",
    "notifications:read-own",
    "attendance:clock",
    "payroll:read-own",
    "tax:calculate",
    "tax:report",
  ],
  customer: [
    "dishes:read",
    "orders:create-online",
    "orders:read-own",
    "customers:self",
    "payments:create",
    "payments:read-own",
    "reservations:create",
    "reservations:read-own",
    "notifications:read-own",
  ],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
