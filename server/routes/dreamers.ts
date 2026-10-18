import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.ts';
import { resolveScope } from '../privacy.ts';
import * as q from '../queries.ts';
import * as cmd from '../commands.ts';
import { isRatingCategory, isCareCategory, RATING_CATEGORIES, CARE_CATEGORIES } from '../../shared/care.ts';
import type { DreamerOverview } from '../../shared/types.ts';

export const dreamersRouter = Router();
dreamersRouter.use(requireAuth);

const ratingCategory = z.enum(RATING_CATEGORIES);
const careCategory = z.enum(CARE_CATEGORIES);
const idParam = z.coerce.number().int().positive();

function bad(res: import('express').Response, err: z.ZodError) {
  return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input.', code: 'invalid', details: err.flatten() });
}

/* ---------- Overview & snapshot ---------- */

dreamersRouter.get('/:id/overview', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const dreamer = q.getDreamerProfile(req.db, scope.dreamerId)!;
  const out: DreamerOverview = {
    dreamer,
    snapshot: q.getSnapshot(req.db, scope),
    recentActivity: q.getTimeline(req.db, scope, { limit: 12 }),
  };
  res.json(out);
});

dreamersRouter.get('/:id/timeline', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  res.json(q.getTimeline(req.db, scope, { from, to, limit }));
});

/* ---------- Dreams ---------- */

dreamersRouter.get('/:id/dreams', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  res.json(q.listDreams(req.db, scope));
});

dreamersRouter.get('/:id/dreams/:dreamId/history', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const dreamId = idParam.safeParse(req.params.dreamId);
  if (!dreamId.success) return res.status(404).json({ error: 'Dream not found.', code: 'not_found' });
  const h = q.getDreamHistory(req.db, scope, dreamId.data);
  if (!h) return res.status(404).json({ error: 'Dream not found.', code: 'not_found' });
  res.json(h);
});

dreamersRouter.patch('/:id/dreams/:dreamId', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z.object({ title: z.string().max(200).optional(), description: z.string().max(4000).optional() }).safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.json(cmd.updateDream(req.db, scope, Number(req.params.dreamId), body.data));
});

/* ---------- Ratings & CARE history ---------- */

dreamersRouter.get('/:id/ratings', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const category = isRatingCategory(req.query.category) ? req.query.category : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json(q.listRatings(req.db, scope, { category, from, to }));
});

dreamersRouter.get('/:id/care/:category', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const cat = req.params.category;
  if (!isRatingCategory(cat)) return res.status(404).json({ error: 'Unknown category.', code: 'not_found' });
  res.json(q.getCategoryHistory(req.db, scope, cat));
});

dreamersRouter.get('/:id/progress', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const dreamId = req.query.dreamId ? Number(req.query.dreamId) : undefined;
  res.json(q.listProgress(req.db, scope, { dreamId }));
});

/* ---------- Self check-ins ---------- */

const checkInSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  ratings: z
    .array(z.object({ category: ratingCategory, value: z.number().min(0).max(10), isPrivate: z.boolean().optional(), note: z.string().max(4000).optional(), notePrivate: z.boolean().optional() }))
    .max(RATING_CATEGORIES.length)
    .optional(),
  progress: z
    .array(z.object({ dreamId: z.number().int(), value: z.number().min(0).max(100), isPrivate: z.boolean().optional(), note: z.string().max(4000).optional(), notePrivate: z.boolean().optional() }))
    .max(4)
    .optional(),
  reflection: z.object({ body: z.string().max(8000), isPrivate: z.boolean().optional() }).nullable().optional(),
});

dreamersRouter.get('/:id/check-ins', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  res.json(q.listCheckIns(req.db, scope));
});

dreamersRouter.post('/:id/check-ins', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = checkInSchema.safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.status(201).json(cmd.createCheckIn(req.db, scope, body.data));
});

/* ---------- Journal ---------- */

dreamersRouter.get('/:id/journal', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const category = isRatingCategory(req.query.category) ? req.query.category : undefined;
  const dreamId = req.query.dreamId ? Number(req.query.dreamId) : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const standaloneOnly = req.query.standalone === '1';
  res.json(q.listJournal(req.db, scope, { category, dreamId, from, to, standaloneOnly }));
});

dreamersRouter.post('/:id/journal', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z
    .object({
      body: z.string().max(8000),
      isPrivate: z.boolean().optional(),
      dreamId: z.number().int().nullable().optional(),
      category: ratingCategory.nullable().optional(),
      occurredAt: z.string().datetime().optional(),
      sessionId: z.number().int().nullable().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.status(201).json(cmd.createJournal(req.db, scope, body.data));
});

/* ---------- Actions ---------- */

dreamersRouter.get('/:id/actions', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const status = req.query.status;
  const s = status === 'active' || status === 'completed' || status === 'archived' ? status : 'all';
  res.json(q.listActions(req.db, scope, s));
});

dreamersRouter.post('/:id/actions', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z
    .object({
      title: z.string().max(300),
      details: z.string().max(4000).optional(),
      dreamId: z.number().int().nullable().optional(),
      category: careCategory.nullable().optional(),
      isPrivate: z.boolean().optional(),
      sessionId: z.number().int().nullable().optional(),
    })
    .safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.status(201).json(cmd.createAction(req.db, scope, body.data));
});

/* ---------- Coaching sessions ---------- */

dreamersRouter.get('/:id/sessions', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  res.json(q.listSessions(req.db, scope));
});

dreamersRouter.get('/:id/grid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  res.json(q.getGrid(req.db, scope));
});

dreamersRouter.post('/:id/sessions', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z.object({ occurredAt: z.string().datetime().optional() }).safeParse(req.body ?? {});
  if (!body.success) return bad(res, body.error);
  res.status(201).json(cmd.startSession(req.db, scope, body.data.occurredAt));
});

dreamersRouter.get('/:id/sessions/:sid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const s = q.getSession(req.db, scope, Number(req.params.sid));
  if (!s) return res.status(404).json({ error: 'Session not found.', code: 'not_found' });
  res.json(s);
});

dreamersRouter.patch('/:id/sessions/:sid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z
    .object({ notes: z.string().max(20000).optional(), focus: z.string().max(2000).optional(), occurredAt: z.string().datetime().optional(), status: z.enum(['in_progress', 'completed']).optional(), actionsReviewed: z.boolean().optional() })
    .safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.json(cmd.updateSession(req.db, scope, Number(req.params.sid), body.data));
});

dreamersRouter.delete('/:id/sessions/:sid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  cmd.deleteSession(req.db, scope, Number(req.params.sid));
  res.json({ ok: true });
});

dreamersRouter.put('/:id/sessions/:sid/ratings', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z.object({ category: ratingCategory, value: z.number().min(0).max(10).nullable() }).safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.json(cmd.setSessionRating(req.db, scope, Number(req.params.sid), body.data.category, body.data.value));
});

dreamersRouter.put('/:id/sessions/:sid/progress', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z.object({ dreamId: z.number().int(), value: z.number().min(0).max(100).nullable() }).safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.json(cmd.setSessionProgress(req.db, scope, Number(req.params.sid), body.data.dreamId, body.data.value));
});

/* ---------- Single entries (owned by the dreamer in :id) ---------- */

const entryPatch = z.object({
  value: z.number().optional(),
  isPrivate: z.boolean().optional(),
  note: z.string().max(4000).nullable().optional(),
  notePrivate: z.boolean().optional(),
  occurredAt: z.string().datetime().optional(),
});

dreamersRouter.patch('/:id/ratings/:rid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = entryPatch.safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.json(cmd.updateRating(req.db, scope, Number(req.params.rid), body.data));
});

dreamersRouter.delete('/:id/ratings/:rid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  cmd.deleteRating(req.db, scope, Number(req.params.rid));
  res.json({ ok: true });
});

dreamersRouter.patch('/:id/progress/:pid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = entryPatch.safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.json(cmd.updateProgress(req.db, scope, Number(req.params.pid), body.data));
});

dreamersRouter.delete('/:id/progress/:pid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  cmd.deleteProgress(req.db, scope, Number(req.params.pid));
  res.json({ ok: true });
});

dreamersRouter.patch('/:id/journal/:jid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z
    .object({ body: z.string().max(8000).optional(), isPrivate: z.boolean().optional(), dreamId: z.number().int().nullable().optional(), category: ratingCategory.nullable().optional(), occurredAt: z.string().datetime().optional() })
    .safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.json(cmd.updateJournal(req.db, scope, Number(req.params.jid), body.data));
});

dreamersRouter.delete('/:id/journal/:jid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  cmd.deleteJournal(req.db, scope, Number(req.params.jid));
  res.json({ ok: true });
});

dreamersRouter.patch('/:id/actions/:aid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  const body = z
    .object({
      title: z.string().max(300).optional(),
      details: z.string().max(4000).optional(),
      dreamId: z.number().int().nullable().optional(),
      category: careCategory.nullable().optional(),
      isPrivate: z.boolean().optional(),
      status: z.enum(['active', 'completed', 'archived']).optional(),
    })
    .safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  res.json(cmd.updateAction(req.db, scope, Number(req.params.aid), body.data));
});

dreamersRouter.delete('/:id/actions/:aid', (req, res) => {
  const scope = resolveScope(req, res, req.params.id as string);
  if (!scope) return;
  cmd.deleteAction(req.db, scope, Number(req.params.aid));
  res.json({ ok: true });
});

export { isCareCategory };
