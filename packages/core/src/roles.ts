/**
 * Roles del sistema, definidos en la sección "User" del modelo de datos
 * (Especificacion_Tecnica_Exhaustiva.docx, 6.1 Entidades Principales).
 *
 * `customer` es el cliente en línea y el rol sin privilegios: es el único
 * que se obtiene al registrarse públicamente. El resto de roles (personal)
 * los asigna un administrador.
 */
export const ROLES = ["admin", "manager", "waiter", "cook", "cashier", "customer"] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = "customer";

export const USER_STATUS = ["active", "inactive"] as const;
export type UserStatus = (typeof USER_STATUS)[number];
