import { Router } from "express";
import { asyncHandler, auditAction, requirePermission, validate } from "@resto/http";
import { cancelInvoiceSchema, issueInvoiceSchema } from "@resto/contracts";
import { invoiceController } from "../controllers/invoice.controller.js";

/**
 * CAPA 1 — ROUTES: facturas.
 * El cliente factura y consulta las SUYAS; el personal de caja y gerencia factura por un cliente
 * registrado y consulta todas; cancelar (ante el SAT) es solo de gerencia.
 */
export const invoiceRouter = Router();

invoiceRouter.post(
  "/",
  auditAction("billing-service", "invoices.issue", "invoice"),
  requirePermission("invoices:create", "invoices:issue"),
  validate(issueInvoiceSchema),
  asyncHandler(invoiceController.issue)
);

invoiceRouter.get("/", requirePermission("invoices:read-own", "invoices:read-all"), asyncHandler(invoiceController.list));

invoiceRouter.get("/:id/xml", requirePermission("invoices:read-own", "invoices:read-all"), asyncHandler(invoiceController.xml));

invoiceRouter.get("/:id", requirePermission("invoices:read-own", "invoices:read-all"), asyncHandler(invoiceController.get));

invoiceRouter.post(
  "/:id/cancel",
  auditAction("billing-service", "invoices.cancel", "invoice"),
  requirePermission("invoices:cancel"),
  validate(cancelInvoiceSchema),
  asyncHandler(invoiceController.cancel)
);
