// Solo tipos: se borran al compilar, así el front comparte contrato con el backend
// sin importar código de Node (zod, prisma...) en el navegador.
export type {
  AuditLogDTO,
  AttendanceRecordDTO,
  AttendanceStatusDTO,
  AttendanceSummaryDTO,
  AttendanceSummaryRowDTO,
  AuditSummaryDTO,
  CompensationDTO,
  CustomerDTO,
  CustomerSummaryDTO,
  DishDTO,
  GatewayChargeRequest,
  NotificationDTO,
  OrderDTO,
  OrderItemDTO,
  PayrollEngineStatusDTO,
  PayrollLineDTO,
  PayrollRunDTO,
  PayslipDTO,
  PaymentDTO,
  ReservationDTO,
  SlotDTO,
  TableDTO,
  TelegramInfoDTO,
  TaxCalculationDTO,
  TaxReportDTO,
  TelegramLinkCodeDTO,
  UserPublicDTO,
  BillingInput,
  DeliveryStatus,
  DishCategory,
  NotificationChannel,
  NotificationEventType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ReservationStatus,
  TableStatus,
} from "@resto/contracts";
export type { Permission, Role } from "@resto/core";

import type {
  DeliveryStatus,
  DishCategory,
  NotificationChannel,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ReservationStatus,
  TableStatus,
} from "@resto/contracts";
import type { Role } from "@resto/core";

/** Roles del personal: el administrador los crea (el registro público siempre es de cliente). */
export const STAFF_ROLES: Role[] = ["admin", "manager", "waiter", "cook", "cashier"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  manager: "Gerente",
  waiter: "Mesero",
  cook: "Cocinero",
  cashier: "Cajero",
  customer: "Cliente",
};

export const CATEGORY_LABEL: Record<DishCategory, string> = {
  starter: "Para empezar",
  main: "Cortes y parrilla",
  dessert: "Postres",
  drink: "Bebidas",
  side: "Guarniciones",
};

export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  free: "Libre",
  occupied: "Ocupada",
  reserved: "Reservada",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendiente",
  preparing: "En preparación",
  ready: "Listo",
  served: "Servido",
  paid: "Pagado",
  cancelled: "Cancelado",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  online: "Pago en línea",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Pendiente",
  paid: "Pagado",
  failed: "Fallido",
  expired: "Vencido",
};

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  confirmed: "Confirmada",
  arrived: "Ya llegó",
  completed: "Terminada",
  cancelled: "Cancelada",
  no_show: "No se presentó",
};

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: "En la app",
  telegram: "Telegram",
};

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  sent: "Enviado",
  simulated: "Simulado",
  failed: "Falló",
  skipped: "Omitido",
};

export const TAX_RATE = 0.16;
