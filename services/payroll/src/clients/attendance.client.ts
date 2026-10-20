import { AppError } from "@resto/core";
import type { AttendanceSummaryRowDTO } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

/** Cliente HTTP interno del Attendance Service (checador): este servicio no toca su base de datos. */
export const attendanceClient = {
  /** Resumen de asistencia de UNA persona; las faltas cuentan desde `since` (su fecha de ingreso). */
  async summary(input: { userId: string; username: string; period: string; since: string }, requestId: string): Promise<AttendanceSummaryRowDTO> {
    const qs = new URLSearchParams({ period: input.period, userId: input.userId, username: input.username, since: input.since });
    let res: Response;
    try {
      res = await fetch(`${config.ATTENDANCE_SERVICE_URL}/api/v1/internal/summary?${qs}`, {
        headers: { "x-internal-key": config.INTERNAL_API_KEY, "x-request-id": requestId },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw AppError.serviceUnavailable("Attendance Service");
    }
    if (res.status === 401) logger.error("El Attendance Service rechazó la llave interna: revisa INTERNAL_API_KEY");
    if (!res.ok) throw AppError.serviceUnavailable("Attendance Service");
    return ((await res.json()) as { data: AttendanceSummaryRowDTO }).data;
  },
};
