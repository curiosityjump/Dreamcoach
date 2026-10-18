/**
 * Write-side operations. Each takes a Scope so ownership and visibility rules are
 * enforced consistently: a viewer may only modify rows they can see.
 */
import type { DB } from './db.ts';
import { nowIso } from './db.ts';
import type { Scope } from './privacy.ts';
import { INC } from './privacy.ts';
import * as q from './queries.ts';
import type { ActionItem, CheckIn, CheckInInput, CoachingSession, Dream, JournalEntry, ProgressEntry, RatingEntry } from '../shared/types.ts';
import type { RatingCategory } from '../shared/care.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message);
  }
}

const clampRating = (v: number) => Math.max(0, Math.min(10, Math.round(v)));
const clampProgress = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

function assertOwner(scope: Scope, what = 'this') {
  if (!scope.isOwner) throw new HttpError(403, `Only the dreamer can change ${what}.`, 'forbidden');
}

function markAchieved(db: DB, dreamId: number, value: number, at: string) {
  const dream = db.prepare('SELECT achieved_at FROM dreams WHERE id = ?').get(dreamId) as { achieved_at: string | null };
  if (value >= 100 && !dream.achieved_at) db.prepare('UPDATE dreams SET achieved_at = ?, updated_at = ? WHERE id = ?').run(at, at, dreamId);
  if (value < 100 && dream.achieved_at) {
    // Only un-achieve if there is no other visible 100% entry.
    const other = db.prepare('SELECT 1 FROM dream_progress WHERE dream_id = ? AND value >= 100 AND is_private = 0 LIMIT 1').get(dreamId);
    if (!other) db.prepare('UPDATE dreams SET achieved_at = NULL, updated_at = ? WHERE id = ?').run(at, dreamId);
  }
}

/** Dreams reach "achieved" based on shared (non-private) progress so staff views stay consistent. */
function recomputeAchieved(db: DB, dreamId: number) {
  const at = nowIso();
  const latest = db
    .prepare('SELECT value, occurred_at FROM dream_progress WHERE dream_id = ? AND is_private = 0 ORDER BY occurred_at DESC, id DESC LIMIT 1')
    .get(dreamId) as { value: number; occurred_at: string } | undefined;
  if (latest) markAchieved(db, dreamId, latest.value, latest.occurred_at);
  else db.prepare('UPDATE dreams SET achieved_at = NULL, updated_at = ? WHERE id = ?').run(at, dreamId);
}

/* ---------- Dreams ---------- */

export function updateDream(db: DB, scope: Scope, dreamId: number, patch: { title?: string; description?: string }): Dream {
  const dream = q.getDream(db, scope, dreamId);
  if (!dream) throw new HttpError(404, 'Dream not found.', 'not_found');
  if (!scope.isOwner && !scope.isCoachFor) throw new HttpError(403, 'Not allowed.', 'forbidden');
  const title = patch.title?.trim();
  if (patch.title != null && !title) throw new HttpError(400, 'A dream needs a title.', 'invalid');
  db.prepare('UPDATE dreams SET title = COALESCE(?, title), description = COALESCE(?, description), updated_at = ? WHERE id = ?').run(
    title ?? null,
    patch.description?.trim() ?? null,
    nowIso(),
    dreamId,
  );
  return q.getDream(db, scope, dreamId)!;
}

/* ---------- Attached notes ---------- */

function upsertAttachedNote(
  db: DB,
  scope: Scope,
  parent: { ratingId?: number; progressId?: number; dreamId?: number | null; category?: RatingCategory | null; checkInId: number | null; sessionId: number | null; occurredAt: string; source: 'session' | 'self' },
  body: string | undefined | null,
  isPrivate: boolean | undefined,
) {
  const col = parent.ratingId != null ? 'rating_id' : 'progress_id';
  const pid = parent.ratingId ?? parent.progressId!;
  const existing = db.prepare(`SELECT id, is_private FROM journal_entries WHERE ${col} = ?`).get(pid) as { id: number; is_private: number } | undefined;
  const text = body?.trim();
  const now = nowIso();
  if (existing?.is_private && !scope.includePrivate) {
    // A private note the owner cannot see right now (private entries hidden) is never changed or
    // removed blindly: clearing or re-flagging it is a no-op, and writing over it asks them to unlock.
    if (text) throw new HttpError(409, 'This entry already has a note that is hidden right now. Show private entries to edit it.', 'conflict');
    return;
  }
  if (body === undefined) {
    if (existing && isPrivate !== undefined) db.prepare('UPDATE journal_entries SET is_private = ?, updated_at = ? WHERE id = ?').run(isPrivate ? 1 : 0, now, existing.id);
    return;
  }
  if (!text) {
    if (existing) db.prepare('DELETE FROM journal_entries WHERE id = ?').run(existing.id);
    return;
  }
  if (existing) {
    db.prepare('UPDATE journal_entries SET body = ?, is_private = ?, updated_at = ? WHERE id = ?').run(
      text,
      isPrivate === undefined ? existing.is_private : isPrivate ? 1 : 0,
      now,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO journal_entries (dreamer_id, body, occurred_at, is_private, source, session_id, check_in_id, ${col}, dream_id, category, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      scope.dreamerId,
      text,
      parent.occurredAt,
      isPrivate ? 1 : 0,
      parent.source,
      parent.sessionId,
      parent.checkInId,
      pid,
      parent.dreamId ?? null,
      parent.category ?? null,
      scope.viewer.user.id,
      now,
      now,
    );
  }
}

/* ---------- Self check-ins ---------- */

export function createCheckIn(db: DB, scope: Scope, input: CheckInInput): CheckIn {
  assertOwner(scope, 'their own check-ins');
  const ratings = input.ratings ?? [];
  const progress = input.progress ?? [];
  const reflection = input.reflection?.body?.trim() ? input.reflection : null;
  if (!ratings.length && !progress.length && !reflection) throw new HttpError(400, 'Add at least one rating, progress update, or reflection.', 'invalid');
  const occurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : nowIso();
  if (Number.isNaN(new Date(occurredAt).getTime())) throw new HttpError(400, 'Invalid date.', 'invalid');
  const now = nowIso();
  const run = db.transaction(() => {
    const ci = db
      .prepare('INSERT INTO check_ins (dreamer_id, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(scope.dreamerId, occurredAt, scope.viewer.user.id, now);
    const checkInId = Number(ci.lastInsertRowid);
    for (const r of ratings) {
      const res = db
        .prepare(
          `INSERT INTO ratings (dreamer_id, category, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'self', NULL, ?, ?, ?, ?, ?)`,
        )
        .run(scope.dreamerId, r.category, clampRating(r.value), occurredAt, checkInId, scope.viewer.user.id, r.isPrivate ? 1 : 0, now, now);
      upsertAttachedNote(db, scope, { ratingId: Number(res.lastInsertRowid), category: r.category, checkInId, sessionId: null, occurredAt, source: 'self' }, r.note, r.notePrivate);
    }
    for (const p of progress) {
      const dream = db.prepare('SELECT id FROM dreams WHERE id = ? AND dreamer_id = ?').get(p.dreamId, scope.dreamerId);
      if (!dream) throw new HttpError(400, 'Unknown dream.', 'invalid');
      const res = db
        .prepare(
          `INSERT INTO dream_progress (dreamer_id, dream_id, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'self', NULL, ?, ?, ?, ?, ?)`,
        )
        .run(scope.dreamerId, p.dreamId, clampProgress(p.value), occurredAt, checkInId, scope.viewer.user.id, p.isPrivate ? 1 : 0, now, now);
      upsertAttachedNote(db, scope, { progressId: Number(res.lastInsertRowid), dreamId: p.dreamId, checkInId, sessionId: null, occurredAt, source: 'self' }, p.note, p.notePrivate);
      recomputeAchieved(db, p.dreamId);
    }
    if (reflection) {
      db.prepare(
        `INSERT INTO journal_entries (dreamer_id, body, occurred_at, is_private, source, session_id, check_in_id, author_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'self', NULL, ?, ?, ?, ?)`,
      ).run(scope.dreamerId, reflection.body.trim(), occurredAt, reflection.isPrivate ? 1 : 0, checkInId, scope.viewer.user.id, now, now);
    }
    return checkInId;
  });
  const id = run();
  // Return with full visibility for the owner (they just wrote it), regardless of hidden mode.
  return q.getCheckIn(db, { ...scope, includePrivate: true }, id)!;
}

/* ---------- Ratings ---------- */

/**
 * Who may change what on a rating/progress entry. Values: the dreamer edits their own self entries,
 * the coach edits session entries. Notes and privacy belong to the dreamer on every entry, including
 * session-recorded ones (DECISIONS #2), so a staff write can never touch a dreamer's private note.
 */
function assertEntryEdit(scope: Scope, existing: { source: 'session' | 'self' }, patch: { value?: number; isPrivate?: boolean; note?: string | null; notePrivate?: boolean }) {
  if (patch.isPrivate !== undefined || patch.notePrivate !== undefined) assertOwner(scope, 'privacy');
  if (patch.note !== undefined) assertOwner(scope, 'notes on their entries');
  const canEditValue = (scope.isOwner && existing.source === 'self') || (scope.isCoachFor && existing.source === 'session');
  if (patch.value !== undefined && !canEditValue) {
    throw new HttpError(403, existing.source === 'session' ? 'Session values are recorded by your coach. You can still add a note or make this entry private.' : 'Not allowed.', 'forbidden');
  }
}

export function updateRating(
  db: DB,
  scope: Scope,
  id: number,
  patch: { value?: number; isPrivate?: boolean; note?: string | null; notePrivate?: boolean; occurredAt?: string },
): RatingEntry {
  const existing = q.getRating(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  assertEntryEdit(scope, existing, patch);
  const now = nowIso();
  if (patch.isPrivate !== undefined && existing.sessionId != null && patch.isPrivate !== existing.isPrivate) {
    const clash = db.prepare('SELECT 1 FROM ratings WHERE session_id = ? AND category = ? AND is_private = ? AND id <> ?').get(existing.sessionId, existing.category, patch.isPrivate ? 1 : 0, id);
    if (clash) throw new HttpError(409, 'That session already has another entry for this area with that privacy setting.', 'conflict');
  }
  db.transaction(() => {
    db.prepare('UPDATE ratings SET value = COALESCE(?, value), is_private = COALESCE(?, is_private), occurred_at = COALESCE(?, occurred_at), updated_at = ? WHERE id = ?').run(
      patch.value !== undefined ? clampRating(patch.value) : null,
      patch.isPrivate === undefined ? null : patch.isPrivate ? 1 : 0,
      patch.occurredAt && scope.isOwner && existing.source === 'self' ? new Date(patch.occurredAt).toISOString() : null,
      now,
      id,
    );
    upsertAttachedNote(
      db,
      scope,
      { ratingId: id, category: existing.category, checkInId: existing.checkInId, sessionId: existing.sessionId, occurredAt: existing.occurredAt, source: existing.source },
      patch.note,
      patch.notePrivate,
    );
  })();
  return q.getRating(db, { ...scope, includePrivate: scope.isOwner ? true : scope.includePrivate }, id)!;
}

export function deleteRating(db: DB, scope: Scope, id: number): void {
  const existing = q.getRating(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  if (existing.source === 'session') {
    if (!scope.isCoachFor) throw new HttpError(403, 'Session ratings are removed from the coaching workspace.', 'forbidden');
  } else assertOwner(scope, 'their own entries');
  db.prepare('DELETE FROM ratings WHERE id = ?').run(id);
  if (existing.checkInId != null) cleanupCheckIn(db, existing.checkInId);
}

function cleanupCheckIn(db: DB, checkInId: number) {
  const n = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM ratings WHERE check_in_id = ?) + (SELECT COUNT(*) FROM dream_progress WHERE check_in_id = ?) + (SELECT COUNT(*) FROM journal_entries WHERE check_in_id = ?) AS n`,
    )
    .get(checkInId, checkInId, checkInId) as { n: number };
  if (n.n === 0) db.prepare('DELETE FROM check_ins WHERE id = ?').run(checkInId);
}

/* ---------- Progress ---------- */

export function updateProgress(
  db: DB,
  scope: Scope,
  id: number,
  patch: { value?: number; isPrivate?: boolean; note?: string | null; notePrivate?: boolean; occurredAt?: string },
): ProgressEntry {
  const existing = q.getProgressEntry(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  assertEntryEdit(scope, existing, patch);
  const now = nowIso();
  if (patch.isPrivate !== undefined && existing.sessionId != null && patch.isPrivate !== existing.isPrivate) {
    const clash = db.prepare('SELECT 1 FROM dream_progress WHERE session_id = ? AND dream_id = ? AND is_private = ? AND id <> ?').get(existing.sessionId, existing.dreamId, patch.isPrivate ? 1 : 0, id);
    if (clash) throw new HttpError(409, 'That session already has another progress entry for this dream with that privacy setting.', 'conflict');
  }
  db.transaction(() => {
    db.prepare('UPDATE dream_progress SET value = COALESCE(?, value), is_private = COALESCE(?, is_private), occurred_at = COALESCE(?, occurred_at), updated_at = ? WHERE id = ?').run(
      patch.value !== undefined ? clampProgress(patch.value) : null,
      patch.isPrivate === undefined ? null : patch.isPrivate ? 1 : 0,
      patch.occurredAt && scope.isOwner && existing.source === 'self' ? new Date(patch.occurredAt).toISOString() : null,
      now,
      id,
    );
    upsertAttachedNote(
      db,
      scope,
      { progressId: id, dreamId: existing.dreamId, checkInId: existing.checkInId, sessionId: existing.sessionId, occurredAt: existing.occurredAt, source: existing.source },
      patch.note,
      patch.notePrivate,
    );
    recomputeAchieved(db, existing.dreamId);
  })();
  return q.getProgressEntry(db, { ...scope, includePrivate: scope.isOwner ? true : scope.includePrivate }, id)!;
}

export function deleteProgress(db: DB, scope: Scope, id: number): void {
  const existing = q.getProgressEntry(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  if (existing.source === 'session') {
    if (!scope.isCoachFor) throw new HttpError(403, 'Session entries are removed from the coaching workspace.', 'forbidden');
  } else assertOwner(scope, 'their own entries');
  db.prepare('DELETE FROM dream_progress WHERE id = ?').run(id);
  recomputeAchieved(db, existing.dreamId);
  if (existing.checkInId != null) cleanupCheckIn(db, existing.checkInId);
}

/* ---------- Journal ---------- */

export function createJournal(
  db: DB,
  scope: Scope,
  input: { body: string; isPrivate?: boolean; dreamId?: number | null; category?: RatingCategory | null; occurredAt?: string; sessionId?: number | null },
): JournalEntry {
  const body = input.body?.trim();
  if (!body) throw new HttpError(400, 'Write something first.', 'invalid');
  // Coaches may add shared reflections only inside a session they run; dreamers write their own.
  if (!scope.isOwner) {
    if (!scope.isCoachFor || input.sessionId == null) throw new HttpError(403, 'Only the dreamer can write journal entries.', 'forbidden');
    if (input.isPrivate) throw new HttpError(403, 'Only the dreamer can mark entries private.', 'forbidden');
  }
  if (input.dreamId != null) {
    const d = db.prepare('SELECT 1 FROM dreams WHERE id = ? AND dreamer_id = ?').get(input.dreamId, scope.dreamerId);
    if (!d) throw new HttpError(400, 'Unknown dream.', 'invalid');
  }
  if (input.sessionId != null) {
    const sess = db.prepare('SELECT 1 FROM coaching_sessions WHERE id = ? AND dreamer_id = ?').get(input.sessionId, scope.dreamerId);
    if (!sess) throw new HttpError(400, 'Unknown session.', 'invalid');
  }
  const now = nowIso();
  const occurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : now;
  const res = db
    .prepare(
      `INSERT INTO journal_entries (dreamer_id, body, occurred_at, is_private, source, session_id, dream_id, category, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(scope.dreamerId, body, occurredAt, input.isPrivate ? 1 : 0, input.sessionId != null ? 'session' : 'self', input.sessionId ?? null, input.dreamId ?? null, input.category ?? null, scope.viewer.user.id, now, now);
  return q.getJournalEntry(db, { ...scope, includePrivate: true }, Number(res.lastInsertRowid))!;
}

export function updateJournal(
  db: DB,
  scope: Scope,
  id: number,
  patch: { body?: string; isPrivate?: boolean; dreamId?: number | null; category?: RatingCategory | null; occurredAt?: string },
): JournalEntry {
  const existing = q.getJournalEntry(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  const isAuthor = existing.author.id === scope.viewer.user.id;
  if (!scope.isOwner && !(scope.isCoachFor && isAuthor)) throw new HttpError(403, 'Not allowed.', 'forbidden');
  if (patch.isPrivate !== undefined) assertOwner(scope, 'privacy');
  const body = patch.body?.trim();
  if (patch.body !== undefined && !body) throw new HttpError(400, 'An entry cannot be empty.', 'invalid');
  db.prepare(
    `UPDATE journal_entries SET body = COALESCE(?, body), is_private = COALESCE(?, is_private),
       dream_id = CASE WHEN ? = 1 THEN ? ELSE dream_id END, category = CASE WHEN ? = 1 THEN ? ELSE category END,
       occurred_at = COALESCE(?, occurred_at), updated_at = ? WHERE id = ?`,
  ).run(
    body ?? null,
    patch.isPrivate === undefined ? null : patch.isPrivate ? 1 : 0,
    patch.dreamId !== undefined ? 1 : 0,
    patch.dreamId ?? null,
    patch.category !== undefined ? 1 : 0,
    patch.category ?? null,
    patch.occurredAt && scope.isOwner ? new Date(patch.occurredAt).toISOString() : null,
    nowIso(),
    id,
  );
  return q.getJournalEntry(db, { ...scope, includePrivate: true }, id)!;
}

export function deleteJournal(db: DB, scope: Scope, id: number): void {
  const existing = q.getJournalEntry(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  const isAuthor = existing.author.id === scope.viewer.user.id;
  if (!scope.isOwner && !(scope.isCoachFor && isAuthor)) throw new HttpError(403, 'Not allowed.', 'forbidden');
  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
  if (existing.checkInId != null) cleanupCheckIn(db, existing.checkInId);
}

/* ---------- Actions ---------- */

export function createAction(
  db: DB,
  scope: Scope,
  input: { title: string; details?: string; dreamId?: number | null; category?: ActionItem['category']; isPrivate?: boolean; sessionId?: number | null },
): ActionItem {
  const title = input.title?.trim();
  if (!title) throw new HttpError(400, 'Give the action a short title.', 'invalid');
  if (!scope.isOwner && !scope.isCoachFor) throw new HttpError(403, 'Not allowed.', 'forbidden');
  if (input.isPrivate && !scope.isOwner) throw new HttpError(403, 'Only the dreamer can mark actions private.', 'forbidden');
  if (input.dreamId != null) {
    const d = db.prepare('SELECT 1 FROM dreams WHERE id = ? AND dreamer_id = ?').get(input.dreamId, scope.dreamerId);
    if (!d) throw new HttpError(400, 'Unknown dream.', 'invalid');
  }
  if (input.sessionId != null) {
    const s = db.prepare('SELECT 1 FROM coaching_sessions WHERE id = ? AND dreamer_id = ?').get(input.sessionId, scope.dreamerId);
    if (!s) throw new HttpError(400, 'Unknown session.', 'invalid');
  }
  const now = nowIso();
  const res = db
    .prepare(
      `INSERT INTO actions (dreamer_id, title, details, status, dream_id, category, is_private, created_by, session_id, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(scope.dreamerId, title, input.details?.trim() ?? '', input.dreamId ?? null, input.category ?? null, input.isPrivate ? 1 : 0, scope.viewer.user.id, input.sessionId ?? null, now, now);
  return q.getAction(db, { ...scope, includePrivate: true }, Number(res.lastInsertRowid))!;
}

export function updateAction(
  db: DB,
  scope: Scope,
  id: number,
  patch: { title?: string; details?: string; dreamId?: number | null; category?: ActionItem['category'] | null; isPrivate?: boolean; status?: ActionItem['status'] },
): ActionItem {
  const existing = q.getAction(db, scope, id);
  if (!existing) throw new HttpError(404, 'Action not found.', 'not_found');
  if (!scope.isOwner && !scope.isCoachFor) throw new HttpError(403, 'Not allowed.', 'forbidden');
  if (patch.isPrivate !== undefined) assertOwner(scope, 'privacy');
  const title = patch.title?.trim();
  if (patch.title !== undefined && !title) throw new HttpError(400, 'Give the action a short title.', 'invalid');
  if (patch.dreamId != null) {
    const d = db.prepare('SELECT 1 FROM dreams WHERE id = ? AND dreamer_id = ?').get(patch.dreamId, scope.dreamerId);
    if (!d) throw new HttpError(400, 'Unknown dream.', 'invalid');
  }
  const now = nowIso();
  const status = patch.status ?? existing.status;
  const completedAt = status === 'completed' ? (existing.status === 'completed' ? existing.completedAt : now) : null;
  const archivedAt = status === 'archived' ? (existing.status === 'archived' ? existing.archivedAt : now) : null;
  db.prepare(
    `UPDATE actions SET title = COALESCE(?, title), details = COALESCE(?, details),
       dream_id = CASE WHEN ? = 1 THEN ? ELSE dream_id END, category = CASE WHEN ? = 1 THEN ? ELSE category END,
       is_private = COALESCE(?, is_private), status = ?, completed_at = ?, archived_at = ?, updated_at = ? WHERE id = ?`,
  ).run(
    title ?? null,
    patch.details?.trim() ?? null,
    patch.dreamId !== undefined ? 1 : 0,
    patch.dreamId ?? null,
    patch.category !== undefined ? 1 : 0,
    patch.category ?? null,
    patch.isPrivate === undefined ? null : patch.isPrivate ? 1 : 0,
    status,
    completedAt,
    archivedAt,
    now,
    id,
  );
  return q.getAction(db, { ...scope, includePrivate: true }, id)!;
}

export function deleteAction(db: DB, scope: Scope, id: number): void {
  const existing = q.getAction(db, scope, id);
  if (!existing) throw new HttpError(404, 'Action not found.', 'not_found');
  // Deleting is reserved for the dreamer (archive is the normal path for everyone).
  assertOwner(scope, 'their own actions');
  db.prepare('DELETE FROM actions WHERE id = ?').run(id);
}

/* ---------- Coaching sessions ---------- */

export function startSession(db: DB, scope: Scope, occurredAt?: string): CoachingSession {
  if (!scope.isCoachFor) throw new HttpError(403, 'Only the assigned coach or the Director can run a session.', 'forbidden');
  const open = db.prepare(`SELECT id FROM coaching_sessions WHERE dreamer_id = ? AND status = 'in_progress'`).get(scope.dreamerId) as { id: number } | undefined;
  if (open) return q.getSession(db, scope, open.id)!;
  const now = nowIso();
  const at = occurredAt ? new Date(occurredAt).toISOString() : now;
  const res = db
    .prepare(`INSERT INTO coaching_sessions (dreamer_id, coach_user_id, status, occurred_at, notes, focus, created_at, updated_at) VALUES (?, ?, 'in_progress', ?, '', '', ?, ?)`)
    .run(scope.dreamerId, scope.viewer.user.id, at, now, now);
  return q.getSession(db, scope, Number(res.lastInsertRowid))!;
}

export function updateSession(
  db: DB,
  scope: Scope,
  sessionId: number,
  patch: { notes?: string; focus?: string; occurredAt?: string; status?: 'in_progress' | 'completed'; actionsReviewed?: boolean },
): CoachingSession {
  const s = q.getSession(db, scope, sessionId);
  if (!s) throw new HttpError(404, 'Session not found.', 'not_found');
  if (!scope.isCoachFor) throw new HttpError(403, 'Only the coach can edit a session.', 'forbidden');
  const now = nowIso();
  const status = patch.status ?? s.status;
  const completedAt = status === 'completed' ? (s.completedAt ?? now) : null;
  const occurredAt = patch.occurredAt ? new Date(patch.occurredAt).toISOString() : null;
  db.transaction(() => {
    db.prepare('UPDATE coaching_sessions SET notes = COALESCE(?, notes), focus = COALESCE(?, focus), occurred_at = COALESCE(?, occurred_at), actions_reviewed = COALESCE(?, actions_reviewed), status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
      patch.notes ?? null,
      patch.focus ?? null,
      occurredAt,
      patch.actionsReviewed === undefined ? null : patch.actionsReviewed ? 1 : 0,
      status,
      completedAt,
      now,
      sessionId,
    );
    if (occurredAt) {
      // Keep the session's entries on the session's date so history stays coherent.
      db.prepare('UPDATE ratings SET occurred_at = ? WHERE session_id = ?').run(occurredAt, sessionId);
      db.prepare('UPDATE dream_progress SET occurred_at = ? WHERE session_id = ?').run(occurredAt, sessionId);
      db.prepare('UPDATE journal_entries SET occurred_at = ? WHERE session_id = ? AND (rating_id IS NOT NULL OR progress_id IS NOT NULL)').run(occurredAt, sessionId);
    }
  })();
  return q.getSession(db, scope, sessionId)!;
}

export function deleteSession(db: DB, scope: Scope, sessionId: number): void {
  const s = q.getSession(db, scope, sessionId);
  if (!s) throw new HttpError(404, 'Session not found.', 'not_found');
  if (!scope.isCoachFor) throw new HttpError(403, 'Not allowed.', 'forbidden');
  if (s.status !== 'in_progress') throw new HttpError(400, 'Completed sessions are part of the record and cannot be deleted.', 'invalid');
  // Emptiness is judged on what the coach can see (shared rows); the response never reveals private rows.
  const hasContent =
    Object.keys(s.ratings).length > 0 ||
    Object.keys(s.progress).length > 0 ||
    s.notes.trim() !== '' ||
    s.focus.trim() !== '' ||
    (db.prepare('SELECT 1 FROM actions WHERE session_id = ? AND is_private = 0 LIMIT 1').get(sessionId) != null) ||
    (db.prepare(`SELECT 1 FROM journal_entries j WHERE j.session_id = ? AND ${q.JOURNAL_VISIBLE('j')} LIMIT 1`).get(sessionId, 0, 0, 0) != null);
  if (hasContent) throw new HttpError(400, 'This session already has entries. Complete it instead of deleting it.', 'invalid');
  db.transaction(() => {
    // Anything the dreamer kept private survives as part of their own history (no longer tied to the session).
    db.prepare('UPDATE ratings SET session_id = NULL WHERE session_id = ? AND is_private = 1').run(sessionId);
    db.prepare('UPDATE dream_progress SET session_id = NULL WHERE session_id = ? AND is_private = 1').run(sessionId);
    db.prepare('UPDATE actions SET session_id = NULL WHERE session_id = ?').run(sessionId);
    db.prepare('UPDATE journal_entries SET session_id = NULL WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM coaching_sessions WHERE id = ?').run(sessionId);
  })();
}

/** Upsert a rating recorded during a session; `value: null` clears it. */
export function setSessionRating(db: DB, scope: Scope, sessionId: number, category: RatingCategory, value: number | null): CoachingSession {
  const s = q.getSession(db, scope, sessionId);
  if (!s) throw new HttpError(404, 'Session not found.', 'not_found');
  if (!scope.isCoachFor) throw new HttpError(403, 'Only the coach can record session ratings.', 'forbidden');
  const now = nowIso();
  // Staff writes only ever touch SHARED rows. If the dreamer has made this cell's value private,
  // that row is invisible to the coach and must be neither updated nor deleted: the coach's value
  // becomes a separate shared row, so an empty cell behaves exactly like a never-recorded one.
  if (value === null) {
    db.prepare('DELETE FROM ratings WHERE session_id = ? AND category = ? AND is_private = 0').run(sessionId, category);
  } else {
    db.prepare(
      `INSERT INTO ratings (dreamer_id, category, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'session', ?, NULL, ?, 0, ?, ?)
       ON CONFLICT(session_id, category, is_private) WHERE session_id IS NOT NULL DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(scope.dreamerId, category, clampRating(value), s.occurredAt, sessionId, scope.viewer.user.id, now, now);
  }
  return q.getSession(db, scope, sessionId)!;
}

export function setSessionProgress(db: DB, scope: Scope, sessionId: number, dreamId: number, value: number | null): CoachingSession {
  const s = q.getSession(db, scope, sessionId);
  if (!s) throw new HttpError(404, 'Session not found.', 'not_found');
  if (!scope.isCoachFor) throw new HttpError(403, 'Only the coach can record session progress.', 'forbidden');
  const dream = db.prepare('SELECT 1 FROM dreams WHERE id = ? AND dreamer_id = ?').get(dreamId, scope.dreamerId);
  if (!dream) throw new HttpError(400, 'Unknown dream.', 'invalid');
  const now = nowIso();
  if (value === null) {
    db.prepare('DELETE FROM dream_progress WHERE session_id = ? AND dream_id = ? AND is_private = 0').run(sessionId, dreamId);
  } else {
    db.prepare(
      `INSERT INTO dream_progress (dreamer_id, dream_id, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'session', ?, NULL, ?, 0, ?, ?)
       ON CONFLICT(session_id, dream_id, is_private) WHERE session_id IS NOT NULL DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(scope.dreamerId, dreamId, clampProgress(value), s.occurredAt, sessionId, scope.viewer.user.id, now, now);
  }
  recomputeAchieved(db, dreamId);
  return q.getSession(db, scope, sessionId)!;
}

export const _inc = INC;
