/**
 * Write-side operations. Each takes a Scope so ownership and visibility rules are
 * enforced consistently: a viewer may only modify rows they can see. What a write returns
 * is read back through the same Scope, so it is exactly what a GET would show (null when
 * the written row is not visible, e.g. a private entry saved while private entries are hidden).
 */
import type { DB } from './db.ts';
import { nowIso } from './db.ts';
import { randomId } from './ids.ts';
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

/** Entries and sessions record what already happened; a few minutes of clock difference are tolerated. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;
function pastDate(input: string): string {
  const t = new Date(input).getTime();
  if (Number.isNaN(t)) throw new HttpError(400, 'Invalid date.', 'invalid');
  if (t > Date.now() + FUTURE_SLACK_MS) throw new HttpError(400, 'That date is still to come. Choose a date and time up to now.', 'invalid');
  return new Date(t).toISOString();
}

function assertOwner(scope: Scope, what = 'this') {
  if (!scope.isOwner) throw new HttpError(403, `Only the dreamer can change ${what}.`, 'forbidden');
}

/** A dream tag must be one of this dreamer's dreams. */
function assertOwnDream(db: DB, scope: Scope, dreamId: number | null | undefined) {
  if (dreamId == null) return;
  if (!db.prepare('SELECT 1 FROM dreams WHERE id = ? AND dreamer_id = ?').get(dreamId, scope.dreamerId)) throw new HttpError(400, 'Unknown dream.', 'invalid');
}

/**
 * "Achieved" is a fact about the shared history (DECISIONS #10): any shared progress entry at 100%, dated by the
 * earliest one. It is derived from the rows, never from the latest write, and it is a derived badge rather than
 * an edit of the dream, so it leaves updated_at alone and is written only when it changes. Hiding and re-sharing
 * an entry therefore leaves the dream exactly as it was.
 */
function recomputeAchieved(db: DB, dreamId: number) {
  const { at } = db.prepare('SELECT MIN(occurred_at) AS at FROM dream_progress WHERE dream_id = ? AND value >= 100 AND is_private = 0').get(dreamId) as { at: string | null };
  db.prepare('UPDATE dreams SET achieved_at = ? WHERE id = ? AND achieved_at IS NOT ?').run(at, dreamId, at);
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
    if (existing && isPrivate !== undefined) db.prepare('UPDATE journal_entries SET is_private = ? WHERE id = ?').run(isPrivate ? 1 : 0, existing.id);
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
      `INSERT INTO journal_entries (id, dreamer_id, body, occurred_at, is_private, source, session_id, check_in_id, ${col}, dream_id, category, author_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomId(),
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

/**
 * Keeps the note of a rating/progress row about to be deleted, as a standalone journal entry with the
 * same words, privacy, tags and author. Used for staff deletes (staff writes never destroy a
 * dreamer's note) and, with `onlyPrivate`, for the dreamer's deletes in hidden mode (a private note they
 * can't see is never removed blindly). It keeps the date it already counted on: a note on a session value
 * took the session's date but counted when it was written, so it now stands on that moment (created_at),
 * and clearing a value never moves the dreamer's activity back in time.
 */
function detachNote(db: DB, parent: { ratingId: number; category: RatingCategory } | { progressId: number; dreamId: number }, onlyPrivate = false) {
  const p = 'ratingId' in parent ? { col: 'rating_id', id: parent.ratingId, category: parent.category, dreamId: null } : { col: 'progress_id', id: parent.progressId, category: null, dreamId: parent.dreamId };
  const byDreamer = q.WRITTEN_BY_DREAMER('journal_entries');
  db.prepare(
    // The dreamer's own words now stand alone as one of their reflections, no longer part of the session.
    // (SQLite evaluates every SET expression against the row as it was, so ACTIVITY_AT reads it still attached.)
    `UPDATE journal_entries SET ${p.col} = NULL, check_in_id = NULL, category = COALESCE(category, ?), dream_id = COALESCE(dream_id, ?),
       occurred_at = ${q.ACTIVITY_AT('journal_entries')},
       source = CASE WHEN ${byDreamer} THEN 'self' ELSE source END,
       session_id = CASE WHEN ${byDreamer} THEN NULL ELSE session_id END
     WHERE ${p.col} = ?${onlyPrivate ? ' AND is_private = 1' : ''}`,
  ).run(p.category, p.dreamId, p.id);
}

/** A change that only flips privacy flags keeps the row's updated_at, so staff never see a row "touched" by it. */
const privacyOnly = (patch: object): number =>
  Object.entries(patch).every(([k, v]) => v === undefined || k === 'isPrivate' || k === 'notePrivate') ? 1 : 0;

/* ---------- Self check-ins ---------- */

export function createCheckIn(db: DB, scope: Scope, input: CheckInInput): CheckIn | null {
  assertOwner(scope, 'their own check-ins');
  const ratings = input.ratings ?? [];
  const progress = input.progress ?? [];
  const reflection = input.reflection?.body?.trim() ? input.reflection : null;
  if (!ratings.length && !progress.length && !reflection) throw new HttpError(400, 'Add at least one rating, progress update, or reflection.', 'invalid');
  const occurredAt = input.occurredAt ? pastDate(input.occurredAt) : nowIso();
  const now = nowIso();
  const run = db.transaction(() => {
    const checkInId = randomId();
    db.prepare('INSERT INTO check_ins (id, dreamer_id, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(checkInId, scope.dreamerId, occurredAt, scope.viewer.user.id, now);
    for (const r of ratings) {
      const ratingId = randomId();
      db.prepare(
        `INSERT INTO ratings (id, dreamer_id, category, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'self', NULL, ?, ?, ?, ?, ?)`,
      ).run(ratingId, scope.dreamerId, r.category, clampRating(r.value), occurredAt, checkInId, scope.viewer.user.id, r.isPrivate ? 1 : 0, now, now);
      upsertAttachedNote(db, scope, { ratingId, category: r.category, checkInId, sessionId: null, occurredAt, source: 'self' }, r.note, r.notePrivate);
    }
    for (const p of progress) {
      assertOwnDream(db, scope, p.dreamId);
      const progressId = randomId();
      db.prepare(
        `INSERT INTO dream_progress (id, dreamer_id, dream_id, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'self', NULL, ?, ?, ?, ?, ?)`,
      ).run(progressId, scope.dreamerId, p.dreamId, clampProgress(p.value), occurredAt, checkInId, scope.viewer.user.id, p.isPrivate ? 1 : 0, now, now);
      upsertAttachedNote(db, scope, { progressId, dreamId: p.dreamId, checkInId, sessionId: null, occurredAt, source: 'self' }, p.note, p.notePrivate);
      recomputeAchieved(db, p.dreamId);
    }
    if (reflection) {
      db.prepare(
        `INSERT INTO journal_entries (id, dreamer_id, body, occurred_at, is_private, source, session_id, check_in_id, author_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'self', NULL, ?, ?, ?, ?)`,
      ).run(randomId(), scope.dreamerId, reflection.body.trim(), occurredAt, reflection.isPrivate ? 1 : 0, checkInId, scope.viewer.user.id, now, now);
    }
    return checkInId;
  });
  return q.getCheckIn(db, scope, run());
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

/**
 * A private session value can be shared again only while its cell is free: each session cell holds one
 * shared value, and the coach may have recorded a new one after the dreamer hid this one. A value whose
 * session was deleted belongs to no cell any more, so it stays private.
 */
function assertCanShareBack(existing: { source: 'session' | 'self'; sessionId: number | null; isPrivate: boolean }, patch: { isPrivate?: boolean }, cellTaken: () => boolean) {
  if (patch.isPrivate !== false || !existing.isPrivate || existing.source !== 'session') return;
  if (existing.sessionId == null) throw new HttpError(409, 'This value came from a coaching session that was later removed, so it stays private. You can keep it or delete it.', 'conflict');
  if (cellTaken()) throw new HttpError(409, 'Your coach recorded a new value for this session after you hid this one, so it can’t be shared back. You can keep it private or delete it.', 'conflict');
}

/**
 * Who may delete a rating/progress entry: the dreamer their own self entries, the coach session values.
 * The dreamer may also remove a session value while it is private (staff can't see it, so nothing they
 * see changes) or once its session no longer exists.
 */
function assertEntryDelete(scope: Scope, existing: { source: 'session' | 'self'; sessionId: number | null; isPrivate: boolean }) {
  if (existing.source === 'self') return assertOwner(scope, 'their own entries');
  if (scope.isCoachFor || (scope.isOwner && (existing.isPrivate || existing.sessionId == null))) return;
  throw new HttpError(403, 'Session values are recorded by your coach. You can make this one private, then delete it.', 'forbidden');
}

export function updateRating(
  db: DB,
  scope: Scope,
  id: number,
  patch: { value?: number; isPrivate?: boolean; note?: string | null; notePrivate?: boolean; occurredAt?: string },
): RatingEntry | null {
  const existing = q.getRating(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  assertEntryEdit(scope, existing, patch);
  const occurredAt = patch.occurredAt ? pastDate(patch.occurredAt) : null;
  assertCanShareBack(existing, patch, () => !!db.prepare('SELECT 1 FROM ratings WHERE session_id = ? AND category = ? AND is_private = 0 AND id <> ?').get(existing.sessionId, existing.category, id));
  const now = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE ratings SET value = COALESCE(?, value), is_private = COALESCE(?, is_private), occurred_at = COALESCE(?, occurred_at), updated_at = CASE WHEN ? THEN updated_at ELSE ? END WHERE id = ?').run(
      patch.value !== undefined ? clampRating(patch.value) : null,
      patch.isPrivate === undefined ? null : patch.isPrivate ? 1 : 0,
      scope.isOwner && existing.source === 'self' ? occurredAt : null,
      privacyOnly({ ...patch, note: undefined }),
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
  return q.getRating(db, scope, id);
}

export function deleteRating(db: DB, scope: Scope, id: number): void {
  const existing = q.getRating(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  assertEntryDelete(scope, existing);
  db.transaction(() => {
    // A note goes with its entry only when the dreamer deletes it while able to see it.
    if (!scope.includePrivate) detachNote(db, { ratingId: id, category: existing.category }, scope.isOwner);
    db.prepare('DELETE FROM ratings WHERE id = ?').run(id);
    if (existing.checkInId != null) cleanupCheckIn(db, existing.checkInId);
  })();
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
): ProgressEntry | null {
  const existing = q.getProgressEntry(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  assertEntryEdit(scope, existing, patch);
  const occurredAt = patch.occurredAt ? pastDate(patch.occurredAt) : null;
  assertCanShareBack(existing, patch, () => !!db.prepare('SELECT 1 FROM dream_progress WHERE session_id = ? AND dream_id = ? AND is_private = 0 AND id <> ?').get(existing.sessionId, existing.dreamId, id));
  const now = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE dream_progress SET value = COALESCE(?, value), is_private = COALESCE(?, is_private), occurred_at = COALESCE(?, occurred_at), updated_at = CASE WHEN ? THEN updated_at ELSE ? END WHERE id = ?').run(
      patch.value !== undefined ? clampProgress(patch.value) : null,
      patch.isPrivate === undefined ? null : patch.isPrivate ? 1 : 0,
      scope.isOwner && existing.source === 'self' ? occurredAt : null,
      privacyOnly({ ...patch, note: undefined }),
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
  return q.getProgressEntry(db, scope, id);
}

export function deleteProgress(db: DB, scope: Scope, id: number): void {
  const existing = q.getProgressEntry(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  assertEntryDelete(scope, existing);
  db.transaction(() => {
    // A note goes with its entry only when the dreamer deletes it while able to see it.
    if (!scope.includePrivate) detachNote(db, { progressId: id, dreamId: existing.dreamId }, scope.isOwner);
    db.prepare('DELETE FROM dream_progress WHERE id = ?').run(id);
    recomputeAchieved(db, existing.dreamId);
    if (existing.checkInId != null) cleanupCheckIn(db, existing.checkInId);
  })();
}

/* ---------- Journal ---------- */

export function createJournal(
  db: DB,
  scope: Scope,
  input: { body: string; isPrivate?: boolean; dreamId?: number | null; category?: RatingCategory | null; occurredAt?: string; sessionId?: number | null },
): JournalEntry | null {
  const body = input.body?.trim();
  if (!body) throw new HttpError(400, 'Write something first.', 'invalid');
  // Coaches may add shared reflections only inside a session they run; dreamers write their own.
  if (!scope.isOwner) {
    if (!scope.isCoachFor || input.sessionId == null) throw new HttpError(403, 'Only the dreamer can write journal entries.', 'forbidden');
    if (input.isPrivate) throw new HttpError(403, 'Only the dreamer can mark entries private.', 'forbidden');
  }
  assertOwnDream(db, scope, input.dreamId);
  if (input.sessionId != null) {
    const sess = db.prepare('SELECT 1 FROM coaching_sessions WHERE id = ? AND dreamer_id = ?').get(input.sessionId, scope.dreamerId);
    if (!sess) throw new HttpError(400, 'Unknown session.', 'invalid');
  }
  const now = nowIso();
  const occurredAt = input.occurredAt ? pastDate(input.occurredAt) : now;
  const id = randomId();
  db.prepare(
    `INSERT INTO journal_entries (id, dreamer_id, body, occurred_at, is_private, source, session_id, dream_id, category, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, scope.dreamerId, body, occurredAt, input.isPrivate ? 1 : 0, input.sessionId != null ? 'session' : 'self', input.sessionId ?? null, input.dreamId ?? null, input.category ?? null, scope.viewer.user.id, now, now);
  return q.getJournalEntry(db, scope, id);
}

export function updateJournal(
  db: DB,
  scope: Scope,
  id: number,
  patch: { body?: string; isPrivate?: boolean; dreamId?: number | null; category?: RatingCategory | null; occurredAt?: string },
): JournalEntry | null {
  const existing = q.getJournalEntry(db, scope, id);
  if (!existing) throw new HttpError(404, 'Entry not found.', 'not_found');
  const isAuthor = existing.author.id === scope.viewer.user.id;
  if (!scope.isOwner && !(scope.isCoachFor && isAuthor)) throw new HttpError(403, 'Not allowed.', 'forbidden');
  if (patch.isPrivate !== undefined) assertOwner(scope, 'privacy');
  const body = patch.body?.trim();
  if (patch.body !== undefined && !body) throw new HttpError(400, 'An entry cannot be empty.', 'invalid');
  assertOwnDream(db, scope, patch.dreamId);
  const occurredAt = patch.occurredAt ? pastDate(patch.occurredAt) : null;
  db.prepare(
    `UPDATE journal_entries SET body = COALESCE(?, body), is_private = COALESCE(?, is_private),
       dream_id = CASE WHEN ? = 1 THEN ? ELSE dream_id END, category = CASE WHEN ? = 1 THEN ? ELSE category END,
       occurred_at = COALESCE(?, occurred_at), updated_at = CASE WHEN ? THEN updated_at ELSE ? END WHERE id = ?`,
  ).run(
    body ?? null,
    patch.isPrivate === undefined ? null : patch.isPrivate ? 1 : 0,
    patch.dreamId !== undefined ? 1 : 0,
    patch.dreamId ?? null,
    patch.category !== undefined ? 1 : 0,
    patch.category ?? null,
    scope.isOwner ? occurredAt : null,
    privacyOnly(patch),
    nowIso(),
    id,
  );
  return q.getJournalEntry(db, scope, id);
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
): ActionItem | null {
  const title = input.title?.trim();
  if (!title) throw new HttpError(400, 'Give the action a short title.', 'invalid');
  if (!scope.isOwner && !scope.isCoachFor) throw new HttpError(403, 'Not allowed.', 'forbidden');
  if (input.isPrivate && !scope.isOwner) throw new HttpError(403, 'Only the dreamer can mark actions private.', 'forbidden');
  assertOwnDream(db, scope, input.dreamId);
  if (input.sessionId != null) {
    const s = db.prepare('SELECT 1 FROM coaching_sessions WHERE id = ? AND dreamer_id = ?').get(input.sessionId, scope.dreamerId);
    if (!s) throw new HttpError(400, 'Unknown session.', 'invalid');
  }
  const now = nowIso();
  const id = randomId();
  db.prepare(
    `INSERT INTO actions (id, dreamer_id, title, details, status, dream_id, category, is_private, created_by, session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, scope.dreamerId, title, input.details?.trim() ?? '', input.dreamId ?? null, input.category ?? null, input.isPrivate ? 1 : 0, scope.viewer.user.id, input.sessionId ?? null, now, now);
  return q.getAction(db, scope, id);
}

export function updateAction(
  db: DB,
  scope: Scope,
  id: number,
  patch: { title?: string; details?: string; dreamId?: number | null; category?: ActionItem['category'] | null; isPrivate?: boolean; status?: ActionItem['status'] },
): ActionItem | null {
  const existing = q.getAction(db, scope, id);
  if (!existing) throw new HttpError(404, 'Action not found.', 'not_found');
  if (!scope.isOwner && !scope.isCoachFor) throw new HttpError(403, 'Not allowed.', 'forbidden');
  if (patch.isPrivate !== undefined) assertOwner(scope, 'privacy');
  const title = patch.title?.trim();
  if (patch.title !== undefined && !title) throw new HttpError(400, 'Give the action a short title.', 'invalid');
  assertOwnDream(db, scope, patch.dreamId);
  const now = nowIso();
  const status = patch.status ?? existing.status;
  const completedAt = status === 'completed' ? (existing.status === 'completed' ? existing.completedAt : now) : null;
  const archivedAt = status === 'archived' ? (existing.status === 'archived' ? existing.archivedAt : now) : null;
  db.prepare(
    `UPDATE actions SET title = COALESCE(?, title), details = COALESCE(?, details),
       dream_id = CASE WHEN ? = 1 THEN ? ELSE dream_id END, category = CASE WHEN ? = 1 THEN ? ELSE category END,
       is_private = COALESCE(?, is_private), status = ?, completed_at = ?, archived_at = ?, updated_at = CASE WHEN ? THEN updated_at ELSE ? END WHERE id = ?`,
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
    privacyOnly(patch),
    now,
    id,
  );
  return q.getAction(db, scope, id);
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
  const at = occurredAt ? pastDate(occurredAt) : now;
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
  if (status === 'in_progress' && s.status === 'completed') {
    // One open session per dreamer: reopening waits until the current one is finished or deleted.
    const open = db.prepare(`SELECT 1 FROM coaching_sessions WHERE dreamer_id = ? AND status = 'in_progress' AND id <> ?`).get(scope.dreamerId, sessionId);
    if (open) throw new HttpError(409, 'Finish or delete the open session first.', 'conflict');
  }
  const occurredAt = patch.occurredAt ? pastDate(patch.occurredAt) : null;
  db.transaction(() => {
    // Reopening keeps completed_at (it is only shown while completed), so completing again restores when the
    // session really ended. The first completion credits the session to whoever completes it, which may
    // differ from whoever started it (a reassignment, or the Director starting for another coach).
    db.prepare(
      `UPDATE coaching_sessions SET notes = COALESCE(?, notes), focus = COALESCE(?, focus), occurred_at = COALESCE(?, occurred_at), actions_reviewed = COALESCE(?, actions_reviewed),
         coach_user_id = CASE WHEN ? = 'completed' AND completed_at IS NULL THEN ? ELSE coach_user_id END,
         completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END,
         status = ?, updated_at = ? WHERE id = ?`,
    ).run(
      patch.notes ?? null,
      patch.focus ?? null,
      occurredAt,
      patch.actionsReviewed === undefined ? null : patch.actionsReviewed ? 1 : 0,
      status,
      scope.viewer.user.id,
      status,
      now,
      status,
      now,
      sessionId,
    );
    if (occurredAt) {
      // Keep the session's entries on the session's date so history stays coherent.
      db.prepare('UPDATE ratings SET occurred_at = ? WHERE session_id = ?').run(occurredAt, sessionId);
      db.prepare('UPDATE dream_progress SET occurred_at = ? WHERE session_id = ?').run(occurredAt, sessionId);
      db.prepare('UPDATE journal_entries SET occurred_at = ? WHERE session_id = ? AND (rating_id IS NOT NULL OR progress_id IS NOT NULL)').run(occurredAt, sessionId);
      // A dream achieved in this session is dated with it.
      const moved = db.prepare('SELECT DISTINCT dream_id FROM dream_progress WHERE session_id = ?').all(sessionId) as { dream_id: number }[];
      for (const { dream_id } of moved) recomputeAchieved(db, dream_id);
    }
  })();
  return q.getSession(db, scope, sessionId)!;
}

export function deleteSession(db: DB, scope: Scope, sessionId: number): void {
  const s = q.getSession(db, scope, sessionId);
  if (!s) throw new HttpError(404, 'Session not found.', 'not_found');
  if (!scope.isCoachFor) throw new HttpError(403, 'Not allowed.', 'forbidden');
  if (s.status !== 'in_progress') throw new HttpError(400, 'Completed sessions are part of the record and cannot be deleted.', 'invalid');
  // Emptiness is judged on what the coach can see in the session (shared rows); the response never reveals
  // private rows. Session content is its values, notes and focus, the actions chosen in it and the
  // reflections staff wrote in it; anything of the dreamer's survives the deletion, detached from it.
  const hasContent =
    Object.keys(s.ratings).length > 0 ||
    Object.keys(s.progress).length > 0 ||
    s.notes.trim() !== '' ||
    s.focus.trim() !== '' ||
    (db.prepare('SELECT 1 FROM actions WHERE session_id = ? AND is_private = 0 LIMIT 1').get(sessionId) != null) ||
    (db.prepare(`SELECT 1 FROM journal_entries j WHERE j.session_id = ? AND NOT ${q.WRITTEN_BY_DREAMER('j')} AND ${q.JOURNAL_VISIBLE('j')} LIMIT 1`).get(sessionId, 0, 0, 0) != null);
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
  // Clearing a cell keeps the dreamer's note on that value as a standalone entry.
  db.transaction(() => {
    if (value === null) {
      const row = db.prepare('SELECT id FROM ratings WHERE session_id = ? AND category = ? AND is_private = 0').get(sessionId, category) as { id: number } | undefined;
      if (row) {
        detachNote(db, { ratingId: row.id, category });
        db.prepare('DELETE FROM ratings WHERE id = ?').run(row.id);
      }
    } else {
      db.prepare(
        `INSERT INTO ratings (id, dreamer_id, category, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'session', ?, NULL, ?, 0, ?, ?)
         ON CONFLICT(session_id, category) WHERE session_id IS NOT NULL AND is_private = 0 DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(randomId(), scope.dreamerId, category, clampRating(value), s.occurredAt, sessionId, scope.viewer.user.id, now, now);
    }
  })();
  return q.getSession(db, scope, sessionId)!;
}

export function setSessionProgress(db: DB, scope: Scope, sessionId: number, dreamId: number, value: number | null): CoachingSession {
  const s = q.getSession(db, scope, sessionId);
  if (!s) throw new HttpError(404, 'Session not found.', 'not_found');
  if (!scope.isCoachFor) throw new HttpError(403, 'Only the coach can record session progress.', 'forbidden');
  const dream = db.prepare('SELECT 1 FROM dreams WHERE id = ? AND dreamer_id = ?').get(dreamId, scope.dreamerId);
  if (!dream) throw new HttpError(400, 'Unknown dream.', 'invalid');
  const now = nowIso();
  db.transaction(() => {
    if (value === null) {
      const row = db.prepare('SELECT id FROM dream_progress WHERE session_id = ? AND dream_id = ? AND is_private = 0').get(sessionId, dreamId) as { id: number } | undefined;
      if (row) {
        detachNote(db, { progressId: row.id, dreamId });
        db.prepare('DELETE FROM dream_progress WHERE id = ?').run(row.id);
      }
    } else {
      db.prepare(
        `INSERT INTO dream_progress (id, dreamer_id, dream_id, value, occurred_at, source, session_id, check_in_id, recorded_by, is_private, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'session', ?, NULL, ?, 0, ?, ?)
         ON CONFLICT(session_id, dream_id) WHERE session_id IS NOT NULL AND is_private = 0 DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(randomId(), scope.dreamerId, dreamId, clampProgress(value), s.occurredAt, sessionId, scope.viewer.user.id, now, now);
    }
    recomputeAchieved(db, dreamId);
  })();
  return q.getSession(db, scope, sessionId)!;
}

export const _inc = INC;
