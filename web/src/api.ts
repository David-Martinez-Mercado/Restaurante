const BASE = "/api/v1";
const STORAGE_KEY = "resto.tokens";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; issue: string }[]
  ) {
    super(message);
  }

  /** Mensaje listo para mostrar, con el detalle de validación si existe. */
  get friendly(): string {
    if (!this.details?.length) return this.message;
    return `${this.message}: ${this.details.map((d) => `${d.field} — ${d.issue}`).join("; ")}`;
  }
}

let tokens: Tokens | null = load();
let onAuthLost: () => void = () => {};

function load(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function setTokens(next: Tokens | null): void {
  tokens = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* almacenamiento no disponible: la sesión vive solo en memoria */
  }
}

export const hasTokens = () => tokens !== null;
export const getRefreshToken = () => tokens?.refreshToken ?? null;
export function setAuthLostHandler(fn: () => void): void {
  onAuthLost = fn;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "No se pudo conectar con el servidor");
  }
}

// Una sola renovación a la vez, aunque varias peticiones expiren juntas.
let refreshing: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    if (!tokens) return false;
    try {
      const res = await fetch(`${BASE}/auth/refresh-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as Tokens;
      setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function toError(res: Response): Promise<ApiError> {
  const json = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: { field: string; issue: string }[] };
  } | null;
  return new ApiError(
    res.status,
    json?.error?.code ?? "ERROR",
    json?.error?.message ?? `Error ${res.status}`,
    json?.error?.details
  );
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body);

  if (res.status === 401 && tokens) {
    const err = await toError(res.clone());
    if (err.code === "TOKEN_EXPIRED" && (await refreshAccessToken())) {
      res = await send(method, path, body);
    } else if (err.code === "TOKEN_EXPIRED" || err.code === "TOKEN_INVALID") {
      setTokens(null);
      onAuthLost();
    }
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const put = <T>(path: string, body: unknown) => api<T>("PUT", path, body);
export const patch = <T>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const del = <T = void>(path: string) => api<T>("DELETE", path);
