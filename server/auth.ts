import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DB } from './db.ts';
import { nowIso } from './db.ts';
import type { Role, User } from '../shared/types.ts';

export const SESSION_COOKIE = 'dc_session';
/** Signed-in sessions expire after this much inactivity. */
export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
/** "Show Private" lasts this long without activity before private entries hide again. */
export const PRIVATE_UNLOCK_MS = 30 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60 * 1000;

/* ---------- Passwords (scrypt, no native deps) ---------- */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* ---------- Lockout after repeated failures ---------- */

export function checkLockout(db: DB, key: string): { locked: boolean; retryAfterSec: number } {
  const row = db.prepare('SELECT failures, locked_until FROM login_attempts WHERE key = ?').get(key) as
    | { failures: number; locked_until: string | null }
    | undefined;
  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

export function recordFailure(db: DB, key: string): void {
  const row = db.prepare('SELECT failures FROM login_attempts WHERE key = ?').get(key) as { failures: number } | undefined;
  const failures = (row?.failures ?? 0) + 1;
  const lockedUntil = failures >= MAX_FAILURES ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
  db.prepare(
    `INSERT INTO login_attempts (key, failures, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`,
  ).run(key, failures >= MAX_FAILURES ? 0 : failures, lockedUntil);
}

export function clearFailures(db: DB, key: string): void {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
}

/* ---------- Auth sessions ---------- */

export interface AuthSessionRow {
  token: string;
  user_id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  private_unlocked_until: string | null;
}

export function createAuthSession(db: DB, userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_IDLE_MS).toISOString();
  db.prepare(
    'INSERT INTO auth_sessions (token, user_id, created_at, last_seen_at, expires_at, private_unlocked_until) VALUES (?, ?, ?, ?, ?, NULL)',
  ).run(token, userId, now, now, expires);
  return token;
}

export function destroyAuthSession(db: DB, token: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

/** Loads a session, applying idle expiry and the private-unlock timeout. Returns null if invalid. */
export function touchAuthSession(db: DB, token: string): AuthSessionRow | null {
  const row = db.prepare('SELECT * FROM auth_sessions WHERE token = ?').get(token) as AuthSessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    destroyAuthSession(db, token);
    return null;
  }
  let unlockedUntil = row.private_unlocked_until;
  if (unlockedUntil && new Date(unlockedUntil).getTime() <= now) {
    unlockedUntil = null; // timed out — relock
  } else if (unlockedUntil) {
    unlockedUntil = new Date(now + PRIVATE_UNLOCK_MS).toISOString(); // sliding window while active
  }
  const nowS = new Date(now).toISOString();
  const expires = new Date(now + SESSION_IDLE_MS).toISOString();
  db.prepare('UPDATE auth_sessions SET last_seen_at = ?, expires_at = ?, private_unlocked_until = ? WHERE token = ?').run(
    nowS,
    expires,
    unlockedUntil,
    token,
  );
  return { ...row, last_seen_at: nowS, expires_at: expires, private_unlocked_until: unlockedUntil };
}

export function setPrivateUnlocked(db: DB, token: string, unlocked: boolean): string | null {
  const until = unlocked ? new Date(Date.now() + PRIVATE_UNLOCK_MS).toISOString() : null;
  db.prepare('UPDATE auth_sessions SET private_unlocked_until = ? WHERE token = ?').run(until, token);
  return until;
}

/* ---------- Request context ---------- */

export interface Viewer {
  user: User;
  token: string;
  /** Dreamer profile id when the user is a dreamer. */
  dreamerId: number | null;
  /** True only for dreamers whose session currently has private entries unlocked. */
  privateUnlocked: boolean;
  privateUnlockedUntil: string | null;
}

declare global {
  namespace Express {
    interface Request {
      viewer?: Viewer;
      db: DB;
    }
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function toUser(row: { id: number; email: string; name: string; role: string; created_at?: string }): User {
  return { id: row.id, email: row.email, name: row.name, role: row.role as Role, initials: initials(row.name), createdAt: row.created_at };
}

export function loadViewer(db: DB, token: string | undefined): Viewer | null {
  if (!token) return null;
  const sess = touchAuthSession(db, token);
  if (!sess) return null;
  const user = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(sess.user_id) as
    | { id: number; email: string; name: string; role: string; created_at: string }
    | undefined;
  if (!user) return null;
  const dreamer = db.prepare('SELECT id FROM dreamers WHERE user_id = ?').get(user.id) as { id: number } | undefined;
  const unlocked = user.role === 'dreamer' && !!sess.private_unlocked_until;
  return {
    user: toUser(user),
    token,
    dreamerId: dreamer?.id ?? null,
    privateUnlocked: unlocked,
    privateUnlockedUntil: unlocked ? sess.private_unlocked_until : null,
  };
}

export function attachViewer(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  req.viewer = loadViewer(req.db, token) ?? undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.viewer) {
    res.status(401).json({ error: 'Please sign in.', code: 'unauthenticated' });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.viewer) {
      res.status(401).json({ error: 'Please sign in.', code: 'unauthenticated' });
      return;
    }
    if (!roles.includes(req.viewer.user.role)) {
      res.status(403).json({ error: 'You do not have access to this.', code: 'forbidden' });
      return;
    }
    next();
  };
}
