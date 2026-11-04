import { AppError, hasPermission, type Role } from "@resto/core";
import {
  INVOICE_STATUSES,
  type CancelInvoiceInput,
  type InvoiceConceptDTO,
  type InvoiceDTO,
  type InvoiceDetailDTO,
  type InvoiceStatus,
} from "@resto/contracts";
import { emitEvent, logger } from "@resto/http";
import { config, emisor } from "../config.js";
import { customerClient } from "../clients/customer.client.js";
import { orderClient } from "../clients/order.client.js";
import { PacRejected, profactClient } from "../clients/profact.client.js";
import { buildCfdi, computeAmounts, normalizeName, parseTimbre, paymentFormOf, sameMonthInZone } from "../domain/cfdi.js";
import { invoiceRepository, type Invoice } from "../repositories/invoice.repository.js";

export interface Actor {
  userId: string;
  role: Role;
  requestId: string;
}

const folioLabel = (i: { serie: string; folio: number }) => `${i.serie}-${i.folio}`;

function toDTO(i: Invoice): InvoiceDTO {
  return {
    id: i.id,
    orderId: i.orderId,
    orderCode: i.orderCode,
    serie: i.serie,
    folio: i.folio,
    status: i.status,
    receptor: { rfc: i.receptorRfc, name: i.receptorName, postalCode: i.receptorPostalCode, taxRegime: i.receptorRegime, cfdiUse: i.receptorCfdiUse },
    concepts: i.concepts as unknown as InvoiceConceptDTO[],
    subtotalCents: i.subtotalCents,
    ivaCents: i.ivaCents,
    totalCents: i.totalCents,
    paymentForm: i.paymentForm,
    uuid: i.uuid,
    stampedAt: i.stampedAt?.toISOString() ?? null,
    errorMessage: i.errorMessage,
    cancelledAt: i.cancelledAt?.toISOString() ?? null,
    cancelReason: (i.cancelReason as InvoiceDTO["cancelReason"]) ?? null,
    cancelMessage: i.cancelMessage,
    createdAt: i.createdAt.toISOString(),
  };
}

function toDetail(i: Invoice): InvoiceDetailDTO {
  return {
    ...toDTO(i),
    emisor: { rfc: i.emisorRfc, name: i.emisorName, taxRegime: i.emisorRegime, postalCode: i.emisorPostalCode },
    selloCfd: i.selloCfd,
    selloSat: i.selloSat,
    noCertificadoSat: i.noCertificadoSat,
    cadenaOriginal: i.cadenaOriginal,
    qrBase64: i.qrBase64,
  };
}

/** Un cliente solo ve sus facturas; el personal con invoices:read-all ve todas. Lo ajeno "no existe" (404). */
function assertVisible(i: Invoice, actor: Actor): void {
  if (!hasPermission(actor.role, "invoices:read-all") && i.customerUserId !== actor.userId) throw AppError.notFound("Factura");
}

/** CAPA 3 — SERVICE: facturación electrónica CFDI 4.0 de pedidos pagados, timbrada por Profact. */
export const invoiceService = {
  /**
   * Factura un pedido pagado.
   *  - El cliente factura SUS pedidos; el personal (invoices:issue) puede facturar el de un cliente registrado.
   *  - Los datos fiscales salen del perfil del cliente; los importes, del pedido (nunca de quien pide).
   *  - Solo dentro del mes del consumo; una factura timbrada por pedido.
   */
  async issue(orderId: string, actor: Actor, now = new Date()): Promise<InvoiceDetailDTO> {
    const order = await orderClient.get(orderId, actor.requestId);
    if (!order) throw AppError.notFound("Pedido");
    if (!order.customerUserId) {
      throw AppError.conflict("Este pedido no está ligado a un cliente registrado: no hay datos fiscales con los que facturar");
    }
    const staff = hasPermission(actor.role, "invoices:issue");
    if (!staff && order.customerUserId !== actor.userId) throw AppError.notFound("Pedido");

    if (order.status !== "paid" || !order.paidAt) throw AppError.conflict("Solo se puede facturar un consumo que ya esté pagado");
    if (!sameMonthInZone(new Date(order.paidAt), now, config.BILLING_TIMEZONE)) {
      throw AppError.conflict("Ya pasó el plazo para facturar este consumo: solo se factura dentro del mes en que se hizo");
    }

    const customer = await customerClient.getByUser(order.customerUserId, actor.requestId);
    const billing = customer?.billing;
    if (!billing) {
      throw AppError.conflict("Faltan los datos fiscales: guarda tu RFC, razón social, código postal, régimen y uso de CFDI en Mi perfil");
    }
    if (!profactClient.configured) throw new AppError("SERVICE_UNAVAILABLE", "La facturación no está configurada en el servidor", 503);

    let paymentForm: string;
    try {
      paymentForm = paymentFormOf(order.paymentMethod);
    } catch (err) {
      throw AppError.conflict(err instanceof Error ? err.message : "Pedido sin método de pago");
    }

    const lines = order.items.map((i) => ({ description: i.dishName, quantity: i.quantity, unitPriceCents: i.unitPriceCents }));
    const amounts = computeAmounts(lines, order.taxCents);
    const receptor = {
      rfc: billing.rfc,
      name: normalizeName(billing.businessName),
      postalCode: billing.postalCode,
      taxRegime: billing.taxRegime,
      cfdiUse: billing.cfdiUse,
    };

    // 1. se reserva el folio y la factura queda "en proceso" (con candado: un pedido, una factura)
    const created = await invoiceRepository.createPendingIfNone(
      {
        orderId: order.id,
        orderCode: order.code,
        customerUserId: order.customerUserId,
        requestedBy: actor.userId,
        serie: config.BILLING_SERIE,
        emisorRfc: emisor.rfc,
        emisorName: normalizeName(emisor.name),
        emisorRegime: emisor.taxRegime,
        emisorPostalCode: emisor.postalCode,
        receptorRfc: receptor.rfc,
        receptorName: receptor.name,
        receptorPostalCode: receptor.postalCode,
        receptorRegime: receptor.taxRegime,
        receptorCfdiUse: receptor.cfdiUse,
        concepts: amounts.concepts as never,
        subtotalCents: amounts.subtotalCents,
        ivaCents: order.taxCents,
        totalCents: amounts.totalCents,
        paymentForm,
      },
      now
    );
    if (!created.ok) {
      throw AppError.conflict(
        created.reason === "issued"
          ? `Este pedido ya tiene la factura ${folioLabel(created.invoice)}`
          : "Ya se está facturando este pedido: espera unos segundos"
      );
    }
    const pending = created.invoice;

    // 2. se arma el XML con el folio asignado y se manda a timbrar (el PAC lo sella)
    const built = buildCfdi({
      serie: pending.serie,
      folio: pending.folio,
      now,
      timeZone: config.BILLING_TIMEZONE,
      paymentForm,
      emisor,
      receptor,
      lines,
      taxCents: order.taxCents,
    });

    let stamped;
    try {
      stamped = await profactClient.timbrar(built.xml, pending.id);
    } catch (err) {
      const message = err instanceof PacRejected ? err.message : err instanceof AppError ? err.message : "Error inesperado al timbrar";
      await invoiceRepository.markRejected(pending.id, message).catch((e: unknown) => logger.error({ err: e }, "No se pudo marcar la factura como rechazada"));
      // El rechazo del SAT/PAC (RFC, nombre, régimen...) se explica tal cual al usuario para que pueda corregirlo.
      if (err instanceof PacRejected) throw new AppError("VALIDATION_ERROR", `No se pudo timbrar: ${err.message}`, 422);
      throw err;
    }

    // Ya existe en el SAT. Si guardarla falla, NO se marca como rechazada: se deja constancia para recuperarla.
    const timbre = parseTimbre(stamped.xml);
    const issued = await invoiceRepository
      .markIssued(pending.id, {
        uuid: stamped.uuid,
        xml: stamped.xml,
        stampedAt: now,
        selloCfd: timbre.selloCfd,
        selloSat: timbre.selloSat,
        noCertificadoSat: timbre.noCertificadoSat,
        cadenaOriginal: stamped.cadenaOriginal,
        qrBase64: stamped.qrBase64,
      })
      .catch((err: unknown) => {
        logger.error({ invoiceId: pending.id, uuid: stamped.uuid, xml: stamped.xml }, "FACTURA TIMBRADA PERO NO SE PUDO GUARDAR: recupérala con este UUID");
        throw err;
      });

    emitEvent("invoice.issued", {
      invoiceId: issued.id,
      orderId: issued.orderId,
      orderCode: issued.orderCode,
      customerUserId: issued.customerUserId,
      folio: folioLabel(issued),
      uuid: stamped.uuid,
      totalCents: issued.totalCents,
    });
    return toDetail(issued);
  },

  /** El bot de Telegram factura por el cliente cuyo chat está vinculado. */
  async issueFromTelegram(chatId: string, orderId: string, requestId: string, now = new Date()): Promise<InvoiceDetailDTO> {
    const customer = await customerClient.getByChat(chatId, requestId);
    if (!customer) throw AppError.notFound("Cliente");
    return invoiceService.issue(orderId, { userId: customer.userId, role: "customer", requestId }, now);
  },

  async list(filter: { status?: string; orderId?: string }, actor: Actor): Promise<InvoiceDTO[]> {
    if (filter.status && !INVOICE_STATUSES.includes(filter.status as InvoiceStatus)) {
      throw AppError.validation("Estado inválido", [{ field: "status", issue: `Valores permitidos: ${INVOICE_STATUSES.join(", ")}` }]);
    }
    const all = hasPermission(actor.role, "invoices:read-all");
    const rows = await invoiceRepository.findMany({
      customerUserId: all ? undefined : actor.userId,
      status: filter.status as InvoiceStatus | undefined,
      orderId: filter.orderId,
      limit: 200,
    });
    return rows.map(toDTO);
  },

  async get(id: string, actor: Actor): Promise<InvoiceDetailDTO> {
    const invoice = await invoiceRepository.findById(id);
    if (!invoice) throw AppError.notFound("Factura");
    assertVisible(invoice, actor);
    return toDetail(invoice);
  },

  /** El XML timbrado: es el comprobante fiscal. Solo existe si la factura se llegó a timbrar. */
  async xml(id: string, actor: Actor): Promise<{ xml: string; filename: string }> {
    const invoice = await invoiceRepository.findById(id);
    if (!invoice) throw AppError.notFound("Factura");
    assertVisible(invoice, actor);
    if (!invoice.xml) throw AppError.conflict("Esta factura no se timbró, así que no tiene XML");
    return { xml: invoice.xml, filename: `${folioLabel(invoice)}_${invoice.uuid ?? invoice.id}.xml` };
  },

  /** Cancela una factura ante el SAT (a través del PAC). Solo gerencia. */
  async cancel(id: string, input: CancelInvoiceInput, actor: Actor, now = new Date()): Promise<InvoiceDTO> {
    const invoice = await invoiceRepository.findById(id);
    if (!invoice) throw AppError.notFound("Factura");
    if (invoice.status !== "issued" || !invoice.uuid) throw AppError.conflict("Solo se puede cancelar una factura timbrada y vigente");

    let replacementUuid: string | undefined;
    if (input.reason === "01") {
      const replacement = input.replacementInvoiceId ? await invoiceRepository.findById(input.replacementInvoiceId) : null;
      if (!replacement || replacement.id === invoice.id || replacement.status !== "issued" || !replacement.uuid) {
        throw AppError.validation("Factura sustituta inválida", [
          { field: "replacementInvoiceId", issue: "Debe ser otra factura ya timbrada y vigente" },
        ]);
      }
      replacementUuid = replacement.uuid;
    }
    if (!profactClient.configured) throw new AppError("SERVICE_UNAVAILABLE", "La facturación no está configurada en el servidor", 503);

    let result;
    try {
      result = await profactClient.cancelar({ rfcEmisor: invoice.emisorRfc, uuid: invoice.uuid, reason: input.reason, replacementUuid });
    } catch (err) {
      // El SAT tarda unos minutos en registrar un comprobante recién timbrado: hasta entonces no se puede cancelar.
      if (err instanceof PacRejected && /sin acuse de timbrado/i.test(err.message)) {
        throw AppError.conflict("El SAT aún está registrando esta factura recién timbrada. Intenta cancelarla de nuevo en unos minutos");
      }
      if (err instanceof PacRejected) throw new AppError("VALIDATION_ERROR", `No se pudo cancelar: ${err.message}`, 422);
      throw err;
    }

    const cancelled = await invoiceRepository.markCancelled(id, { reason: input.reason, message: result.message, by: actor.userId, at: now });
    if (!cancelled) throw AppError.conflict("Esa factura ya había sido cancelada");

    emitEvent("invoice.cancelled", {
      invoiceId: cancelled.id,
      orderId: cancelled.orderId,
      orderCode: cancelled.orderCode,
      customerUserId: cancelled.customerUserId,
      folio: folioLabel(cancelled),
      uuid: cancelled.uuid,
    });
    return toDTO(cancelled);
  },
};
