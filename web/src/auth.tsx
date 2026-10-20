import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, getRefreshToken, hasTokens, post, setAuthLostHandler, setTokens } from "./api";
import type { Permission, UserPublicDTO } from "./types";

interface AuthState {
  user: UserPublicDTO | null;
  permissions: Permission[];
  loading: boolean;
  can: (...p: Permission[]) => boolean;
  login: (username: string, password: string) => Promise<void>;
  /** El registro público siempre crea una cuenta de cliente. */
  register: (input: { username: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

interface AuthResponse {
  user: UserPublicDTO;
  accessToken: string;
  refreshToken: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublicDTO | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(hasTokens());

  const loadProfile = useCallback(async () => {
    const me = await get<{ user: UserPublicDTO; permissions: Permission[] }>("/auth/me");
    setUser(me.user);
    setPermissions(me.permissions);
  }, []);

  const clear = useCallback(() => {
    setTokens(null);
    setUser(null);
    setPermissions([]);
  }, []);

  useEffect(() => {
    setAuthLostHandler(clear);
    if (!hasTokens()) return;
    loadProfile()
      .catch(clear)
      .finally(() => setLoading(false));
  }, [clear, loadProfile]);

  const startSession = useCallback(
    async (res: AuthResponse) => {
      setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      await loadProfile();
    },
    [loadProfile]
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      permissions,
      loading,
      can: (...p) => p.some((x) => permissions.includes(x)),
      login: async (username, password) => {
        await startSession(await post<AuthResponse>("/auth/login", { username, password }));
      },
      register: async (input) => {
        await startSession(await post<AuthResponse>("/auth/register", input));
      },
      logout: async () => {
        const refreshToken = getRefreshToken();
        if (refreshToken) await post("/auth/logout", { refreshToken }).catch(() => {});
        clear();
      },
    }),
    [user, permissions, loading, startSession, clear]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
