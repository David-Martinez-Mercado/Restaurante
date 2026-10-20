import type { CustomerInternalDTO, TelegramLinkInput } from "@resto/contracts";
import { logger } from "@resto/http";
import { config } from "../config.js";

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${config.CUSTOMER_SERVICE_URL}/api/v1/internal${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-internal-key": config.INTERNAL_API_KEY, ...init.headers },
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    throw new UpstreamError(503, "El servicio de clientes no está disponible");
  }

  if (res.status === 404) return null;
  if (res.status === 401) logger.error("El Customer Service rechazó la llave interna: revisa INTERNAL_API_KEY");
  if (!res.ok) throw new UpstreamError(res.status, `El servicio de clientes respondió ${res.status}`);
  return ((await res.json()) as { data: T }).data;
}

/** Cliente HTTP interno del Customer Service: este servicio no toca su base de datos. */
export const customerClient = {
  /** null si el usuario no tiene perfil de cliente. */
  getByUser: (userId: string) => call<CustomerInternalDTO>(`/customers/by-user/${userId}`),

  /** null si ningún cliente tiene vinculado ese chat de Telegram. */
  getByChat: (chatId: string) => call<CustomerInternalDTO>(`/customers/by-chat/${chatId}`),

  /** Canjea el código de /start. null si el código no existe o venció. */
  linkTelegram: (input: TelegramLinkInput) =>
    call<CustomerInternalDTO>(`/telegram/link`, { method: "POST", body: JSON.stringify(input) }),
};
