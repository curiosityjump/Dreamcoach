import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.ts';
import * as m from '../metrics.ts';
import { nowIso } from '../db.ts';

export const coachRouter = Router();
coachRouter.use(requireRole('coach', 'director'));

/** The signed-in coach's (or director's own) caseload. */
coachRouter.get('/dashboard', (req, res) => {
  res.json(m.coachDashboard(req.db, req.viewer!, req.viewer!.user.id));
});

export const directorRouter = Router();
directorRouter.use(requireRole('director'));

directorRouter.get('/overview', (req, res) => {
  res.json(m.directorOverview(req.db, req.viewer!));
});

directorRouter.get('/dreamers', (req, res) => {
  res.json(m.directorDreamers(req.db, req.viewer!));
});

directorRouter.get('/coaches/:coachId', (req, res) => {
  const detail = m.coachDetail(req.db, req.viewer!, Number(req.params.coachId));
  if (!detail) return res.status(404).json({ error: 'Coach not found.', code: 'not_found' });
  res.json(detail);
});

directorRouter.get('/staff', (req, res) => {
  res.json(m.listStaff(req.db));
});

/** Reassign a dreamer to a different coach (or the Director). */
directorRouter.patch('/dreamers/:dreamerId', (req, res) => {
  const body = z.object({ coachUserId: z.number().int().nullable().optional(), status: z.enum(['active', 'paused', 'completed']).optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid input.', code: 'invalid' });
  const dreamer = req.db.prepare('SELECT id FROM dreamers WHERE id = ?').get(Number(req.params.dreamerId));
  if (!dreamer) return res.status(404).json({ error: 'Dreamer not found.', code: 'not_found' });
  if (body.data.coachUserId !== undefined && body.data.coachUserId !== null) {
    const coach = req.db.prepare(`SELECT 1 FROM users WHERE id = ? AND role IN ('coach','director')`).get(body.data.coachUserId);
    if (!coach) return res.status(400).json({ error: 'Unknown coach.', code: 'invalid' });
  }
  req.db
    .prepare(`UPDATE dreamers SET coach_user_id = CASE WHEN ? = 1 THEN ? ELSE coach_user_id END, status = COALESCE(?, status) WHERE id = ?`)
    .run(body.data.coachUserId !== undefined ? 1 : 0, body.data.coachUserId ?? null, body.data.status ?? null, Number(req.params.dreamerId));
  res.json({ ok: true, updatedAt: nowIso() });
});
