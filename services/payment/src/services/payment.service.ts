import { AppError, hasPermission, type Role } from "@resto/core";
import {
  PAYMENT_STATUSES,
  type CreatePaymentInput,
  type GatewayChargeRequest,
  type GatewayMethod,
  type GatewayWebhookInput,
  type PaymentDTO,
  type PaymentStatus,
} from "@resto/contracts";
import { emitAudit, emitEvent, logger } from "@resto/http";
import { config } from "../config.js";
import { gatewayClient, GatewayError } from "../clients/gateway.client.js";
import { orderClient } from "../clients/order.client.js";
import { buildChargeRequest, nextStatus } from "../domain/payment.js";
import { paymentRepository, type Payment } from "../repositories/payment.repository.js";

export interface Actor {
  userId: string;
  role: Role;
  requestId: string;
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

function toDTO(p: Payment): PaymentDTO {
  const configured = gatewayClient.configured;
  return {
    id: p.id,
    orderId: p.orderId,
    orderCode: p.orderCode,
    amountCents: p.amountCents,
    currency: "MXN",
    status: p.status,
    method: (p.method as GatewayMethod | null) ?? null,
    gatewayReference: p.gatewayReference,
    checkoutUrl: p.checkoutUrl,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    failureReason: p.failureReason,
    paidAt: p.paidAt?.toISOString() ?? null,
    gatewayConfigured: configured,
    // Con la pasarela sin conectar, el cliente de integración puede ver qué se le enviaría.
    gatewayRequest: configured ? null : ((p.requestSnapshot as unknown as GatewayChargeRequest | null) ?? null),
    createdAt: p.createdAt.toISOString(),
  };
}

async function getOrThrow(id: string): Promise<Payment> {
  const payment = await paymentRepository.findById(id);
  if (!payment) throw AppError.notFound("Pago");
  return payment;
}

/** CAPA 3 — SERVICE: cobros en línea. Pide el cobro a la pasarela y aplica su confirmación firmada. */
export const paymentService = {
  /**
   * El cliente paga SU pedido. El importe sale siempre del pedido (nunca del cliente) y,
   * si ya hay un cobro pendiente vigente, se devuelve ese mismo en lugar de duplicarlo.
   */
  async create(input: CreatePaymentInput, actor: Actor, now = new Date()): Promise<PaymentDTO> {
    const order = await orderClient.get(input.orderId, actor.requestId);
    // 404 también si es de otra persona: no se revela que existe.
    if (!order || order.customerUserId !== actor.userId) throw AppError.notFound("Pedido");
    if (order.paidAt || order.status === "paid") throw AppError.conflict("Este pedido ya está pagado");
    if (order.status === "cancelled") throw AppError.conflict("El pedido está cancelado");
    if (order.totalCents <= 0) throw AppError.conflict("El pedido no tiene importe por cobrar");

    const { payment, created } = await paymentRepository.getOrCreatePending(
      { orderId: order.id, orderCode: order.code, customerUserId: actor.userId, amountCents: order.totalCents },
      now
    );
    if (!created) return toDTO(payment);

    const request = buildChargeRequest(payment.id, order, actor.userId, {
      publicApiUrl: config.PUBLIC_API_URL,
      webUrl: config.WEB_URL,
    });

    if (!gatewayClient.configured) {
      return toDTO(await paymentRepository.update(payment.id, { requestSnapshot: request as never }));
    }

    try {
      const charge = await gatewayClient.charge(request);
      return toDTO(
        await paymentRepository.update(payment.id, {
          gatewayReference: charge.gatewayReference,
          checkoutUrl: charge.checkoutUrl,
          expiresAt: charge.expiresAt ? new Date(charge.expiresAt) : null,
          requestSnapshot: request as never,
        })
      );
    } catch (err) {
      // El cobro no se pudo abrir: se cierra para que el cliente pueda reintentar con uno nuevo.
      await paymentRepository.update(payment.id, {
        status: "failed",
        failureReason: err instanceof GatewayError ? err.message.slice(0, 200) : "Error al contactar la pasarela",
        requestSnapshot: request as never,
      });
      throw AppError.serviceUnavailable("de pago");
    }
  },

  async get(id: string, actor: Actor): Promise<PaymentDTO> {
    const payment = await getOrThrow(id);
    if (!hasPermission(actor.role, "payments:read-all") && payment.customerUserId !== actor.userId) {
      throw AppError.notFound("Pago");
    }
    return toDTO(payment);
  },

  async listMine(userId: string, filter: { orderId?: string }): Promise<PaymentDTO[]> {
    return (await paymentRepository.findMany({ customerUserId: userId, orderId: filter.orderId })).map(toDTO);
  },

  async listAll(filter: { status?: string; orderId?: string }): Promise<PaymentDTO[]> {
    if (filter.status && !PAYMENT_STATUSES.includes(filter.status as PaymentStatus)) {
      throw AppError.validation("Estado inválido", [
        { field: "status", issue: `Valores permitidos: ${PAYMENT_STATUSES.join(", ")}` },
      ]);
    }
    return (
      await paymentRepository.findMany({ status: filter.status as PaymentStatus | undefined, orderId: filter.orderId })
    ).map(toDTO);
  },

  /**
   * Aplica un aviso de la pasarela (ya con la firma verificada). Reglas:
   *  - Idempotente por eventId: el mismo aviso nunca se procesa dos veces.
   *  - El importe debe coincidir con el cobro (si no, se rechaza y se deja constancia).
   *  - Si avisar al Order Service falla, se responde error SIN registrar el aviso, para que la
   *    pasarela reintente y el pedido no se quede sin marcar como pagado.
   */
  async applyWebhook(input: GatewayWebhookInput, requestId: string, now = new Date()): Promise<WebhookOutcome> {
    if (await paymentRepository.eventSeen(input.eventId)) return "duplicate";

    const payment = await getOrThrow(input.reference);

    if (input.amountCents !== payment.amountCents) {
      logger.error(
        { paymentId: payment.id, expected: payment.amountCents, received: input.amountCents },
        "La pasarela reportó un importe distinto al del cobro"
      );
      emitAudit({
        service: "payment-service",
        action: "payments.webhook-amount-mismatch",
        resource: "payment",
        resourceId: payment.id,
        outcome: "denied",
        requestId,
        metadata: { eventId: input.eventId, expected: payment.amountCents, received: input.amountCents },
      });
      throw AppError.validation("El importe no coincide con el cobro", [{ field: "amountCents", issue: "No coincide" }]);
    }

    let outcome: WebhookOutcome = "processed";
    let becamePaid = false;

    if (input.type === "payment.succeeded") {
      let current = payment;
      if (payment.status !== "paid") {
        current =
          (await paymentRepository.transition(payment.id, ["pending", "failed", "expired"], {
            status: "paid",
            paidAt: input.paidAt ?? now,
            method: input.method ?? null,
            gatewayReference: input.gatewayReference,
            failureReason: null,
          })) ?? (await getOrThrow(payment.id));
      }
      becamePaid = true;

      try {
        // Se sincroniza siempre (es idempotente): cubre el reintento tras una caída del Order Service.
        await orderClient.confirmPayment(current.orderId, { paymentId: current.id, paidAt: current.paidAt ?? now }, requestId);
      } catch (err) {
        if (!(err instanceof AppError && err.code === "CONFLICT")) throw err;
        logger.error({ paymentId: current.id, orderId: current.orderId }, "Pago recibido de un pedido cancelado: requiere reembolso");
        emitAudit({
          service: "payment-service",
          action: "payments.refund-required",
          resource: "payment",
          resourceId: current.id,
          outcome: "failure",
          requestId,
          metadata: { orderId: current.orderId, amountCents: current.amountCents },
        });
      }
    } else {
      const target = nextStatus(payment.status, input.type);
      if (target === null) {
        outcome = "ignored";
      } else {
        await paymentRepository.transition(payment.id, ["pending"], {
          status: target,
          failureReason:
            input.failureReason ?? (target === "expired" ? "El cobro venció sin pagarse" : "La pasarela rechazó el pago"),
          ...(input.method ? { method: input.method } : {}),
        });
      }
    }

    const first = await paymentRepository.recordEvent(input.eventId, payment.id, input.type);

    if (becamePaid && first) {
      emitEvent("payment.confirmed", {
        orderId: payment.orderId,
        orderCode: payment.orderCode,
        customerUserId: payment.customerUserId,
        amountCents: payment.amountCents,
      });
    }
    emitAudit({
      service: "payment-service",
      action: "payments.webhook",
      resource: "payment",
      resourceId: payment.id,
      outcome: "success",
      requestId,
      metadata: { eventId: input.eventId, type: input.type, outcome },
    });

    return outcome;
  },
};
