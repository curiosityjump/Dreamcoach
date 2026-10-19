import { Router } from 'express';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  checkLockout,
  clearFailures,
  createAuthSession,
  destroyAuthSession,
  recordFailure,
  setPrivateUnlocked,
  toUser,
  verifyPassword,
  loadViewer,
  requireAuth,
} from '../auth.ts';
import type { AuthState } from '../../shared/types.ts';
import type { Viewer } from '../auth.ts';
import type { DB } from '../db.ts';

export const authRouter = Router();

function authState(db: DB, v: Viewer): AuthState {
  const coaches = db.prepare('SELECT 1 FROM dreamers WHERE coach_user_id = ? LIMIT 1').get(v.user.id);
  return {
    user: v.user,
    privateUnlocked: v.privateUnlocked,
    privateUnlockedUntil: v.privateUnlockedUntil,
    // Relative, so the browser can time the re-hide without trusting its own clock to agree with ours.
    privateUnlockedForMs: v.privateUnlockedUntil ? Math.max(0, Date.parse(v.privateUnlockedUntil) - Date.now()) : null,
    dreamerId: v.dreamerId,
    coachesDreamers: !!coaches,
  };
}

const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.DC_SECURE_COOKIES === '1' };

authRouter.post('/login', (req, res) => {
  const parsed = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your email and password.', code: 'invalid' });
  const { email, password } = parsed.data;
  const key = `login:${email.toLowerCase()}`;
  const lock = checkLockout(req.db, key);
  if (lock.locked) return res.status(429).json({ error: `Too many attempts. Try again in ${lock.retryAfterSec}s.`, code: 'locked' });
  const row = req.db.prepare('SELECT id, email, name, role, password_hash, created_at FROM users WHERE email = ?').get(email) as
    | { id: number; email: string; name: string; role: string; password_hash: string; created_at: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    recordFailure(req.db, key);
    return res.status(401).json({ error: 'That email and password don’t match.', code: 'bad_credentials' });
  }
  clearFailures(req.db, key);
  // Signing in always starts a fresh session with private entries hidden.
  if (req.cookies?.[SESSION_COOKIE]) destroyAuthSession(req.db, req.cookies[SESSION_COOKIE]);
  const token = createAuthSession(req.db, row.id);
  res.cookie(SESSION_COOKIE, token, cookieOpts);
  const viewer = loadViewer(req.db, token)!;
  res.json(authState(req.db, viewer));
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) destroyAuthSession(req.db, token);
  res.clearCookie(SESSION_COOKIE, cookieOpts);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(authState(req.db, req.viewer!));
});

/** Reveal private entries for this session — requires the account password again. */
authRouter.post('/privacy/unlock', requireAuth, (req, res) => {
  const v = req.viewer!;
  if (v.user.role !== 'dreamer') return res.status(403).json({ error: 'Only dreamers have private entries.', code: 'forbidden' });
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your password.', code: 'invalid' });
  const key = `unlock:${v.user.id}`;
  const lock = checkLockout(req.db, key);
  if (lock.locked) return res.status(429).json({ error: `Too many attempts. Try again in ${lock.retryAfterSec}s.`, code: 'locked' });
  const row = req.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(v.user.id) as { password_hash: string };
  if (!verifyPassword(parsed.data.password, row.password_hash)) {
    recordFailure(req.db, key);
    return res.status(401).json({ error: 'That password isn’t right.', code: 'bad_credentials' });
  }
  clearFailures(req.db, key);
  setPrivateUnlocked(req.db, v.token, true);
  res.json(authState(req.db, loadViewer(req.db, v.token)!));
});

/** Hide private entries immediately — no confirmation needed. */
authRouter.post('/privacy/lock', requireAuth, (req, res) => {
  const v = req.viewer!;
  setPrivateUnlocked(req.db, v.token, false);
  res.json(authState(req.db, loadViewer(req.db, v.token)!));
});

/** Demo helper: list the demo accounts (names + emails only; never password hashes). */
authRouter.get('/demo-accounts', (req, res) => {
  const rows = req.db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, c.name AS coach_name,
              (SELECT COUNT(*) FROM dreamers d2 WHERE d2.coach_user_id = u.id) AS caseload
       FROM users u LEFT JOIN dreamers d ON d.user_id = u.id LEFT JOIN users c ON c.id = d.coach_user_id
       ORDER BY CASE u.role WHEN 'director' THEN 0 WHEN 'coach' THEN 1 ELSE 2 END, u.name`,
    )
    .all() as { id: number; email: string; name: string; role: string; coach_name: string | null; caseload: number }[];
  res.json(rows.map((r) => ({ ...toUser(r), coachName: r.coach_name, caseload: r.caseload })));
});
