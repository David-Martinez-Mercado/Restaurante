import { AppError } from "@resto/core";
import type { TableDTO } from "@resto/contracts";
import { config } from "../config.js";

/** Cliente HTTP del Menu Service con el JWT de quien registra la llegada. */
export const menuClient = {
  /** null si la mesa no existe. */
  async getTable(id: string, token: string, requestId: string): Promise<TableDTO | null> {
    let res: Response;
    try {
      res = await fetch(`${config.MENU_SERVICE_URL}/api/v1/tables/${id}`, {
        headers: { authorization: `Bearer ${token}`, "x-request-id": requestId },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw AppError.serviceUnavailable("Menu Service");
    }

    if (res.status === 404) return null;
    if (res.status === 401) throw AppError.unauthorized();
    if (res.status === 403) throw AppError.forbidden();
    if (!res.ok) throw AppError.serviceUnavailable("Menu Service");

    return ((await res.json()) as { data: TableDTO }).data;
  },
};
