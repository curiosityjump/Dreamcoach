import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, get, holdReads, post, UNAUTHENTICATED_EVENT } from '@/api/client';
import { useToast } from '@/components/toast';
import type { AuthState } from '@shared/types';

interface AuthApi {
  auth: AuthState | null;
  loading: boolean;
  /** The session ended without the person signing out here (it expired, or was signed out elsewhere). */
  sessionEnded: boolean;
  login: (email: string, password: string) => Promise<AuthState>;
  logout: () => Promise<void>;
  unlockPrivate: (password: string) => Promise<AuthState>;
  lockPrivate: () => Promise<AuthState>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthApi | null>(null);

/*
 * Every tab shares one session cookie, so signing in or out, or showing or hiding private entries, in one
 * tab changes what all of them may show. Tell the other tabs at once (BroadcastChannel, or a localStorage
 * 'storage' event where that is missing); each tab also re-checks the session whenever it comes back into view.
 * 'locking' goes out the moment Hide private is chosen, before the server has answered.
 */
type AuthSignal = 'login' | 'logout' | 'locking' | 'lock' | 'unlock';
const SIGNAL_KEY = 'dc-auth-signal';
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SIGNAL_KEY);

function broadcast(signal: AuthSignal) {
  if (channel) return channel.postMessage(signal);
  try { localStorage.setItem(SIGNAL_KEY, `${signal}:${Date.now()}`); } catch { /* no storage: tabs re-check when shown */ }
}

function onSignal(handler: (signal: AuthSignal) => void): () => void {
  if (channel) {
    const h = (e: MessageEvent<AuthSignal>) => handler(e.data);
    channel.addEventListener('message', h);
    return () => channel.removeEventListener('message', h);
  }
  const h = (e: StorageEvent) => { if (e.key === SIGNAL_KEY && e.newValue) handler(e.newValue.split(':')[0] as AuthSignal); };
  window.addEventListener('storage', h);
  return () => window.removeEventListener('storage', h);
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const authRef = useRef<AuthState | null>(null);
  // Bumped by every sign-in/out, show and hide here, so a re-check that started earlier cannot undo it.
  const epoch = useRef(0);
  // The Hide private in progress, until the server confirms it. stop() lets go of it once something newer
  // decides what may show instead (showing private entries again, the server locking from another tab,
  // signing in or out).
  const hiding = useRef<{ stop: () => void } | null>(null);
  const stopHiding = useCallback(() => hiding.current?.stop(), []);

  // Keep the same object when nothing changed, so a re-check does not re-render the whole app.
  const setAuth = useCallback((next: AuthState | null) => {
    if (JSON.stringify(next) === JSON.stringify(authRef.current)) return;
    authRef.current = next;
    setAuthState(next);
  }, []);

  /** Take the server's view of the session and bring cached data in line with it. */
  const adopt = useCallback((next: AuthState | null, expired: boolean) => {
    const prev = authRef.current;
    setAuth(next);
    if (!prev) return;
    if (!next || next.user.id !== prev.user.id) qc.clear();
    else if (prev.privateUnlocked && !next.privateUnlocked) {
      void qc.resetQueries({ queryKey: ['dreamer'] });
      if (expired) toast('Private entries are hidden again after 30 minutes without activity.', 'private');
    } else if (!prev.privateUnlocked && next.privateUnlocked) void qc.invalidateQueries({ queryKey: ['dreamer'] });
  }, [qc, setAuth, toast]);

  /** Re-read the session: it may have expired, or another tab may have changed it. */
  const check = useCallback(async (expired: boolean) => {
    const started = epoch.current;
    let next: AuthState | null;
    try {
      next = await get<AuthState>('/auth/me');
    } catch (e) {
      if (!(e instanceof ApiRequestError && e.status === 401)) return; // offline or server trouble: keep what we have
      next = null;
    }
    if (epoch.current === started) adopt(next, expired);
  }, [adopt]);

  const refresh = useCallback(() => check(true), [check]);

  useEffect(() => { void check(false).finally(() => setLoading(false)); }, [check]);

  // Any 401 from the API means the session ended (expired, signed out elsewhere): drop everything.
  useEffect(() => {
    const h = () => {
      epoch.current++;
      stopHiding();
      if (authRef.current) setSessionEnded(true);
      setAuth(null);
      qc.clear();
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, h);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, h);
  }, [qc, setAuth, stopHiding]);

  // Private unlock auto-expires server-side after 30 idle minutes; mirror that in the UI.
  useEffect(() => {
    if (!auth?.privateUnlocked || !auth.privateUnlockedUntil) return;
    const ms = new Date(auth.privateUnlockedUntil).getTime() - Date.now() + 500;
    const t = window.setTimeout(() => void refresh(), Math.max(1000, ms));
    return () => window.clearTimeout(t);
  }, [auth?.privateUnlocked, auth?.privateUnlockedUntil, refresh]);

  // Coming back to this tab: the session may have changed while it was in the background.
  useEffect(() => {
    let pending: Promise<void> | null = null;
    const h = () => {
      if (document.visibilityState !== 'visible' || !authRef.current || pending) return;
      pending = refresh().finally(() => { pending = null; });
    };
    window.addEventListener('focus', h);
    document.addEventListener('visibilitychange', h);
    return () => { window.removeEventListener('focus', h); document.removeEventListener('visibilitychange', h); };
  }, [refresh]);

  /**
   * Hide private entries in this tab at once, and keep them hidden. Pages drop their dreamer data and show
   * their loading state (resetQueries; removeQueries would leave mounted observers showing stale private
   * data), and every read waits until the server has locked — a read before that would bring the private
   * entries straight back. If the server can't be reached the screen stays that way and the lock is retried
   * in the background; it never falls back to showing. Resolves or rejects with the first attempt.
   */
  const hide = useCallback(() => {
    epoch.current++;
    stopHiding();
    const prev = authRef.current;
    if (prev) setAuth({ ...prev, privateUnlocked: false, privateUnlockedUntil: null });
    let stopped = false;
    let release = () => {};
    const released = new Promise<void>((r) => { release = r; });
    const run = { stop: () => { stopped = true; release(); } };
    hiding.current = run;
    const first = post<AuthState>('/auth/privacy/lock');
    const locked = (async () => {
      let attempt = first;
      for (let delay = 1000; ; delay = Math.min(delay * 2, 30_000)) {
        try {
          const a = await attempt;
          if (!stopped) setAuth(a);
          return;
        } catch (e) {
          // A 401 means the session is gone, and nothing private can show without one.
          if (stopped || (e instanceof ApiRequestError && e.status === 401)) return;
          await Promise.race([sleep(delay), released]);
          if (stopped) return;
          attempt = post<AuthState>('/auth/privacy/lock');
        }
      }
    })().finally(() => { if (hiding.current === run) hiding.current = null; });
    void holdReads(Promise.race([locked, released]));
    void qc.resetQueries({ queryKey: ['dreamer'] });
    return first;
  }, [qc, setAuth, stopHiding]);

  // Another tab changed the shared session. Its lock and sign-out have already reached the server; a tab
  // that is still locking leaves this one to hide too, and to make sure of the lock itself.
  useEffect(() => onSignal((signal) => {
    epoch.current++;
    const prev = authRef.current;
    if (signal === 'locking') { if (prev?.privateUnlocked) hide().catch(() => {}); return; }
    stopHiding();
    if (signal === 'logout') adopt(null, false);
    else if (signal === 'lock' && prev) adopt({ ...prev, privateUnlocked: false, privateUnlockedUntil: null }, false);
    else void check(false);
  }), [adopt, check, hide, stopHiding]);

  const login = useCallback(async (email: string, password: string) => {
    epoch.current++;
    stopHiding();
    qc.clear();
    const a = await post<AuthState>('/auth/login', { email, password });
    setSessionEnded(false);
    setAuth(a);
    broadcast('login');
    return a;
  }, [qc, setAuth, stopHiding]);

  const unlockPrivate = useCallback(async (password: string) => {
    epoch.current++;
    const a = await post<AuthState>('/auth/privacy/unlock', { password });
    stopHiding();
    setAuth(a);
    broadcast('unlock');
    await qc.invalidateQueries();
    return a;
  }, [qc, setAuth, stopHiding]);

  const lockPrivate = useCallback(async () => {
    broadcast('locking');
    const a = await hide();
    broadcast('lock');
    return a;
  }, [hide]);

  const logout = useCallback(async () => {
    // Only the server can end the session (the cookie is httpOnly), so never show a signed-out screen
    // before it confirms; a failure reaches the caller. Hide private entries first so they stay hidden
    // even if signing out does not go through.
    if (authRef.current?.privateUnlocked) await lockPrivate().catch(() => {});
    epoch.current++;
    await post('/auth/logout');
    stopHiding();
    setSessionEnded(false);
    setAuth(null);
    qc.clear();
    broadcast('logout');
  }, [lockPrivate, qc, setAuth, stopHiding]);

  const value = useMemo(() => ({ auth, loading, sessionEnded, login, logout, unlockPrivate, lockPrivate, refresh }), [auth, loading, sessionEnded, login, logout, unlockPrivate, lockPrivate, refresh]);
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
