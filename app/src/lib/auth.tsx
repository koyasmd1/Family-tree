import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { loadToken, saveToken } from "./storage";

interface Auth {
  ready: boolean;
  token: string | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadToken()
      .then(setToken)
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (t: string) => {
    await saveToken(t);
    setToken(t);
  }, []);

  const signOut = useCallback(async () => {
    if (token) await api(token).logout().catch(() => undefined);
    await saveToken(null);
    setToken(null);
  }, [token]);

  const value = useMemo(() => ({ ready, token, signIn, signOut }), [ready, token, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
