import { AppError } from "@resto/core";
import type { TaxCalculateInput, TaxCalculationDTO, TaxReportDTO } from "@resto/contracts";
import { addIva, buildTaxReport, extractIva, startOfLocalDay } from "../domain/tax.js";
import { orderRepository } from "../repositories/order.repository.js";

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

/** CAPA 3 — SERVICE: calculadora de IVA e IVA trasladado de los pedidos pagados. */
export const taxService = {
  calculate(input: TaxCalculateInput): TaxCalculationDTO {
    return input.mode === "add" ? addIva(input.amountCents, input.ratePercent) : extractIva(input.amountCents, input.ratePercent);
  },

  /** Rango incluyente por fecha de pago, en hora local del servidor. */
  async report(from: string, to: string): Promise<TaxReportDTO> {
    const start = startOfLocalDay(from);
    const end = startOfLocalDay(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw AppError.validation("Fecha inválida", [{ field: "from", issue: "Use fechas reales AAAA-MM-DD" }]);
    }
    if (end < start) {
      throw AppError.validation("Rango inválido", [{ field: "to", issue: "La fecha final no puede ser anterior a la inicial" }]);
    }
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
    if (days > MAX_RANGE_DAYS) {
      throw AppError.validation("Rango demasiado largo", [{ field: "to", issue: `Máximo ${MAX_RANGE_DAYS} días por reporte` }]);
    }

    // `to` es incluyente: se consulta hasta el inicio del día siguiente.
    const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 0, 0, 0, 0);
    const rows = await orderRepository.findPaidBetween(start, endExclusive);
    return buildTaxReport(from, to, rows);
  },
};
