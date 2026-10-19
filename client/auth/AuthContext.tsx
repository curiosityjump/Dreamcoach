import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, get, holdReads, interactedSinceLastRequest, post, UNAUTHENTICATED_EVENT } from '@/api/client';
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

/** How long before private entries would hide again the browser checks whether to keep them showing. */
const KEEP_ALIVE_LEAD_MS = 60_000;
/** While private entries show, how often the browser re-reads the session (a check never keeps them showing). */
const UNLOCK_CHECK_EVERY_MS = 60_000;
/** Once the time is up, how long an answer saying they may still show has to arrive before they hide anyway. */
const UNLOCK_GRACE_MS = 5_000;
const EXPIRED_NOTICE = 'Private entries are hidden again after 30 minutes without activity.';

const hiddenState = (a: AuthState): AuthState => ({ ...a, privateUnlocked: false, privateUnlockedUntil: null, privateUnlockedForMs: null });
/** The time left differs in every answer and is only read to time the re-hide, so on its own it is no change. */
const sameAuth = (a: AuthState | null, b: AuthState | null) =>
  JSON.stringify(a && { ...a, privateUnlockedForMs: null }) === JSON.stringify(b && { ...b, privateUnlockedForMs: null });

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
  // When private entries hide again (Date.now() time), from the time left the server last gave; a new object for
  // every answer, so the timers below start again from each one.
  const [unlockedUntil, setUnlockedUntil] = useState<{ at: number } | null>(null);

  const setAuth = useCallback((next: AuthState | null) => {
    setUnlockedUntil(next?.privateUnlocked && next.privateUnlockedForMs != null ? { at: Date.now() + next.privateUnlockedForMs } : null);
    // Keep the same object when nothing changed, so a re-check does not re-render the whole app.
    if (sameAuth(next, authRef.current)) return;
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
      if (expired) toast(EXPIRED_NOTICE, 'private');
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
   * Hide private entries in this tab at once, and keep them hidden. Pages drop their dreamer data and load it
   * again (resetQueries; removeQueries would leave mounted observers showing stale private data) — keeping
   * their forms and drafts on screen meanwhile (DECISIONS #12) — and every read waits until the server has
   * locked: a read before that would bring the private entries straight back. If the server can't be reached
   * the screen stays that way and the lock is retried in the background; it never falls back to showing.
   * Resolves or rejects with the first attempt.
   */
  const hide = useCallback(() => {
    epoch.current++;
    stopHiding();
    const prev = authRef.current;
    if (prev) setAuth(hiddenState(prev));
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

  // Private entries hide again after 30 idle minutes: the server slides that window from the last interaction a
  // request reported, and relocks when a request arrives after it. Time it from the server's "time left" in each
  // answer (never its timestamp against this browser's clock, which may disagree), starting again from every one:
  //  - reading or typing sends no requests, so shortly before the window closes, tell the server about any
  //    interaction it hasn't heard of (that slides it);
  //  - check in about once a minute, so a window slid or closed elsewhere is picked up (a check never slides it);
  //  - once the time is up, ask; unless an answer soon says they may still show, hide them here anyway — and on
  //    the server too, as soon as it can be reached.
  useEffect(() => {
    if (!unlockedUntil) return;
    const { at } = unlockedUntil;
    const timers: number[] = [];
    const after = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
    let closing = false;
    const due = () => {
      void refresh();
      if (closing) return;
      closing = true;
      after(UNLOCK_GRACE_MS, () => {
        if (!authRef.current?.privateUnlocked) return;
        toast(EXPIRED_NOTICE, 'private');
        hide().catch(() => {});
      });
    };
    after(at - KEEP_ALIVE_LEAD_MS - Date.now(), () => { if (interactedSinceLastRequest()) void refresh(); });
    after(at + 500 - Date.now(), due);
    // Date.now() keeps counting while the computer sleeps, which timers may not.
    const poll = window.setInterval(() => (Date.now() > at ? due() : void refresh()), UNLOCK_CHECK_EVERY_MS);
    return () => { timers.forEach((t) => window.clearTimeout(t)); window.clearInterval(poll); };
  }, [unlockedUntil, refresh, hide, toast]);

  // Another tab changed the shared session. Its lock and sign-out have already reached the server; a tab
  // that is still locking leaves this one to hide too, and to make sure of the lock itself.
  useEffect(() => onSignal((signal) => {
    epoch.current++;
    const prev = authRef.current;
    if (signal === 'locking') { if (prev?.privateUnlocked) hide().catch(() => {}); return; }
    stopHiding();
    if (signal === 'logout') adopt(null, false);
    else if (signal === 'lock' && prev) adopt(hiddenState(prev), false);
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
