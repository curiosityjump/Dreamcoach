import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { get, post, UNAUTHENTICATED_EVENT } from '@/api/client';
import type { AuthState } from '@shared/types';

interface AuthApi {
  auth: AuthState | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthState>;
  logout: () => Promise<void>;
  unlockPrivate: (password: string) => Promise<AuthState>;
  lockPrivate: () => Promise<AuthState>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const a = await get<AuthState>('/auth/me');
      setAuth(a);
    } catch {
      setAuth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Any 401 from the API means the session ended (expired, signed out elsewhere): drop everything.
  useEffect(() => {
    const h = () => { setAuth(null); qc.clear(); };
    window.addEventListener(UNAUTHENTICATED_EVENT, h);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, h);
  }, [qc]);

  // Private unlock auto-expires server-side after 30 idle minutes; mirror that in the UI.
  useEffect(() => {
    if (!auth?.privateUnlocked || !auth.privateUnlockedUntil) return;
    const ms = new Date(auth.privateUnlockedUntil).getTime() - Date.now() + 500;
    const t = window.setTimeout(() => { void refresh().then(() => qc.invalidateQueries()); }, Math.max(1000, ms));
    return () => window.clearTimeout(t);
  }, [auth?.privateUnlocked, auth?.privateUnlockedUntil, refresh, qc]);

  const login = useCallback(async (email: string, password: string) => {
    qc.clear();
    const a = await post<AuthState>('/auth/login', { email, password });
    setAuth(a);
    return a;
  }, [qc]);

  const logout = useCallback(async () => {
    try { await post('/auth/logout'); } catch { /* ignore */ }
    setAuth(null);
    qc.clear();
  }, [qc]);

  const unlockPrivate = useCallback(async (password: string) => {
    const a = await post<AuthState>('/auth/privacy/unlock', { password });
    setAuth(a);
    await qc.invalidateQueries();
    return a;
  }, [qc]);

  const lockPrivate = useCallback(async () => {
    // Drop cached data immediately so nothing private lingers on screen while refetching.
    const a = await post<AuthState>('/auth/privacy/lock');
    qc.removeQueries({ queryKey: ['dreamer'] });
    setAuth(a);
    await qc.invalidateQueries();
    return a;
  }, [qc]);

  const value = useMemo(() => ({ auth, loading, login, logout, unlockPrivate, lockPrivate, refresh }), [auth, loading, login, logout, unlockPrivate, lockPrivate, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** The signed-in user, asserted present (use inside protected routes). */
export function useUser() {
  const { auth } = useAuth();
  if (!auth) throw new Error('No signed-in user');
  return auth;
}
