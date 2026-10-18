/**
 * Read-side data access. Every function takes a Scope and applies the
 * `is_private = 0 OR include` filter in SQL, so private rows never load for a
 * viewer who may not see them.
 */
import type { DB } from './db.ts';
import { initials } from './auth.ts';
import { INC, type Scope } from './privacy.ts';
import { CARE_CATEGORIES, RATING_CATEGORIES, type RatingCategory } from '../shared/care.ts';
import type {
  ActionItem,
  CategoryHistory,
  CheckIn,
  CoachingSession,
  Dream,
  DreamHistory,
  DreamerProfile,
  JournalEntry,
  JournalNote,
  LatestRating,
  Program,
  ProgressEntry,
  RatingEntry,
  Role,
  SessionGrid,
  Snapshot,
  TimelineItem,
} from '../shared/types.ts';

/* ---------- row shapes ---------- */

interface UserLite {
  id: number;
  name: string;
  role: Role;
}

interface RatingRow {
  id: number;
  dreamer_id: number;
  category: RatingCategory;
  value: number;
  occurred_at: string;
  source: 'session' | 'self';
  session_id: number | null;
  check_in_id: number | null;
  recorded_by: number;
  is_private: number;
  rb_name: string;
  rb_role: Role;
  n_id: number | null;
  n_body: string | null;
  n_private: number | null;
  n_created: string | null;
  n_updated: string | null;
}

interface ProgressRow extends Omit<RatingRow, 'category'> {
  dream_id: number;
}

interface JournalRow {
  id: number;
  dreamer_id: number;
  body: string;
  occurred_at: string;
  is_private: number;
  source: 'session' | 'self';
  session_id: number | null;
  check_in_id: number | null;
  rating_id: number | null;
  progress_id: number | null;
  dream_id: number | null;
  category: RatingCategory | null;
  author_id: number;
  a_name: string;
  a_role: Role;
  created_at: string;
  updated_at: string;
  /** 1 when attached to a private rating / progress update. */
  parent_private: number;
}

interface ActionRow {
  id: number;
  dreamer_id: number;
  title: string;
  details: string;
  status: 'active' | 'completed' | 'archived';
  dream_id: number | null;
  category: ActionItem['category'];
  is_private: number;
  created_by: number;
  cb_name: string;
  cb_role: Role;
  session_id: number | null;
  created_at: string;
  completed_at: string | null;
  archived_at: string | null;
  updated_at: string;
}

interface SessionRow {
  id: number;
  dreamer_id: number;
  coach_user_id: number;
  coach_name: string;
  status: 'in_progress' | 'completed';
  occurred_at: string;
  completed_at: string | null;
  notes: string;
  focus: string;
  actions_reviewed: number;
}

/* ---------- mappers ---------- */

function note(r: { n_id: number | null; n_body: string | null; n_private: number | null; n_created: string | null; n_updated: string | null }): JournalNote | null {
  if (r.n_id == null) return null;
  return { id: r.n_id, body: r.n_body ?? '', isPrivate: !!r.n_private, createdAt: r.n_created!, updatedAt: r.n_updated! };
}

function mapRating(r: RatingRow): RatingEntry {
  return {
    id: r.id,
    dreamerId: r.dreamer_id,
    category: r.category,
    value: r.value,
    occurredAt: r.occurred_at,
    source: r.source,
    sessionId: r.session_id,
    checkInId: r.check_in_id,
    recordedBy: { id: r.recorded_by, name: r.rb_name, role: r.rb_role },
    isPrivate: !!r.is_private,
    note: note(r),
  };
}

function mapProgress(r: ProgressRow): ProgressEntry {
  return {
    id: r.id,
    dreamerId: r.dreamer_id,
    dreamId: r.dream_id,
    value: r.value,
    occurredAt: r.occurred_at,
    source: r.source,
    sessionId: r.session_id,
    checkInId: r.check_in_id,
    recordedBy: { id: r.recorded_by, name: r.rb_name, role: r.rb_role },
    isPrivate: !!r.is_private,
    note: note(r),
  };
}

export function mapJournal(r: JournalRow, scope: Scope): JournalEntry {
  return {
    id: r.id,
    dreamerId: r.dreamer_id,
    body: r.body,
    occurredAt: r.occurred_at,
    isPrivate: !!r.is_private,
    source: r.source,
    sessionId: r.session_id,
    checkInId: r.check_in_id,
    ratingId: r.rating_id,
    progressId: r.progress_id,
    dreamId: r.dream_id,
    category: r.category,
    author: { id: r.author_id, name: r.a_name, role: r.a_role },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(scope.includePrivate ? { parentPrivate: !!r.parent_private } : {}),
  };
}

export function mapAction(r: ActionRow): ActionItem {
  return {
    id: r.id,
    dreamerId: r.dreamer_id,
    title: r.title,
    details: r.details,
    status: r.status,
    dreamId: r.dream_id,
    category: r.category,
    isPrivate: !!r.is_private,
    createdAt: r.created_at,
    createdBy: { id: r.created_by, name: r.cb_name, role: r.cb_role },
    sessionId: r.session_id,
    completedAt: r.completed_at,
    archivedAt: r.archived_at,
    updatedAt: r.updated_at,
  };
}

/* ---------- SQL fragments ---------- */

/** Attached note: only visible when both the parent and the note itself are visible. */
const NOTE_JOIN = (parentCol: string) => `
  LEFT JOIN journal_entries n ON n.${parentCol} = x.id AND (n.is_private = 0 OR ? = 1)`;

const RATING_SELECT = `
  SELECT x.id, x.dreamer_id, x.category, x.value, x.occurred_at, x.source, x.session_id, x.check_in_id,
         x.recorded_by, x.is_private, u.name AS rb_name, u.role AS rb_role,
         n.id AS n_id, n.body AS n_body, n.is_private AS n_private, n.created_at AS n_created, n.updated_at AS n_updated
  FROM ratings x
  JOIN users u ON u.id = x.recorded_by
  ${NOTE_JOIN('rating_id')}`;

const PROGRESS_SELECT = `
  SELECT x.id, x.dreamer_id, x.dream_id, x.value, x.occurred_at, x.source, x.session_id, x.check_in_id,
         x.recorded_by, x.is_private, u.name AS rb_name, u.role AS rb_role,
         n.id AS n_id, n.body AS n_body, n.is_private AS n_private, n.created_at AS n_created, n.updated_at AS n_updated
  FROM dream_progress x
  JOIN users u ON u.id = x.recorded_by
  ${NOTE_JOIN('progress_id')}`;

const JOURNAL_SELECT = `
  SELECT j.*, a.name AS a_name, a.role AS a_role,
         COALESCE((SELECT r.is_private FROM ratings r WHERE r.id = j.rating_id), (SELECT p.is_private FROM dream_progress p WHERE p.id = j.progress_id), 0) AS parent_private
  FROM journal_entries j
  JOIN users a ON a.id = j.author_id`;

/**
 * A journal row is visible when its own flag allows it AND, if it is attached to a
 * rating/progress entry, that parent is visible too. Takes three `inc` params.
 * Use this everywhere journal rows are listed OR counted.
 */
export const JOURNAL_VISIBLE = (alias = 'j') => `(
  (${alias}.is_private = 0 OR ? = 1)
  AND (${alias}.rating_id IS NULL OR EXISTS (SELECT 1 FROM ratings r WHERE r.id = ${alias}.rating_id AND (r.is_private = 0 OR ? = 1)))
  AND (${alias}.progress_id IS NULL OR EXISTS (SELECT 1 FROM dream_progress p WHERE p.id = ${alias}.progress_id AND (p.is_private = 0 OR ? = 1)))
)`;

/** A journal row the dreamer wrote themselves (not a coach's session reflection). Takes no params. */
export const WRITTEN_BY_DREAMER = (alias = 'j') => `${alias}.author_id = (SELECT dd.user_id FROM dreamers dd WHERE dd.id = ${alias}.dreamer_id)`;

/**
 * When a journal row counts as the dreamer's activity. A note on a session-recorded value (attached, outside
 * any check-in) takes the session's date, but it is a reflection of theirs dated when they wrote it; every
 * other row counts on its own date. Takes no params.
 */
export const ACTIVITY_AT = (alias = 'j') =>
  `(CASE WHEN ${alias}.check_in_id IS NULL AND (${alias}.rating_id IS NOT NULL OR ${alias}.progress_id IS NOT NULL) THEN ${alias}.created_at ELSE ${alias}.occurred_at END)`;

/** Same-moment ratings (one check-in) keep CARE order, since ids carry no order. */
const CATEGORY_ORDER = `CASE x.category ${RATING_CATEGORIES.map((c, i) => `WHEN '${c}' THEN ${i}`).join(' ')} END`;

const ACTION_SELECT = `
  SELECT x.*, u.name AS cb_name, u.role AS cb_role
  FROM actions x JOIN users u ON u.id = x.created_by`;

const SESSION_SELECT = `
  SELECT s.id, s.dreamer_id, s.coach_user_id, c.name AS coach_name, s.status, s.occurred_at, s.completed_at, s.notes, s.focus, s.actions_reviewed
  FROM coaching_sessions s JOIN users c ON c.id = s.coach_user_id`;

/* ---------- Program & profile ---------- */

export function getProgram(db: DB, id: number): Program {
  const r = db.prepare('SELECT * FROM programs WHERE id = ?').get(id) as {
    id: number; name: string; description: string; slot_labels: string; slot_guidance: string; starts_on: string; ends_on: string;
  };
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    slotLabels: JSON.parse(r.slot_labels),
    slotGuidance: JSON.parse(r.slot_guidance),
    startsOn: r.starts_on,
    endsOn: r.ends_on,
  };
}

export function getDreamerProfile(db: DB, dreamerId: number): DreamerProfile | null {
  const r = db
    .prepare(
      `SELECT d.id, d.user_id, d.coach_user_id, d.program_id, d.status, d.joined_on, d.about,
              u.name, u.email, c.name AS coach_name
       FROM dreamers d JOIN users u ON u.id = d.user_id
       LEFT JOIN users c ON c.id = d.coach_user_id
       WHERE d.id = ?`,
    )
    .get(dreamerId) as
    | { id: number; user_id: number; coach_user_id: number | null; program_id: number; status: DreamerProfile['status']; joined_on: string; about: string | null; name: string; email: string; coach_name: string | null }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    initials: initials(r.name),
    status: r.status,
    joinedOn: r.joined_on,
    about: r.about,
    coach: r.coach_user_id ? { id: r.coach_user_id, userId: r.coach_user_id, name: r.coach_name!, initials: initials(r.coach_name!) } : null,
    program: getProgram(db, r.program_id),
  };
}

/* ---------- Dreams ---------- */

export function listDreams(db: DB, scope: Scope): Dream[] {
  const program = db.prepare('SELECT program_id FROM dreamers WHERE id = ?').get(scope.dreamerId) as { program_id: number };
  const labels: string[] = JSON.parse(
    (db.prepare('SELECT slot_labels FROM programs WHERE id = ?').get(program.program_id) as { slot_labels: string }).slot_labels,
  );
  const rows = db.prepare('SELECT * FROM dreams WHERE dreamer_id = ? ORDER BY slot').all(scope.dreamerId) as {
    id: number; dreamer_id: number; slot: 1 | 2 | 3 | 4; title: string; description: string; achieved_at: string | null; created_at: string; updated_at: string;
  }[];
  const progress = db
    .prepare(
      `SELECT dream_id, value, occurred_at, is_private FROM dream_progress
       WHERE dreamer_id = ? AND (is_private = 0 OR ? = 1) ORDER BY occurred_at DESC, created_at DESC, id DESC`,
    )
    .all(scope.dreamerId, INC(scope)) as { dream_id: number; value: number; occurred_at: string; is_private: number }[];
  const actions = db
    .prepare(
      `SELECT dream_id, COUNT(*) AS n FROM actions WHERE dreamer_id = ? AND status = 'active' AND dream_id IS NOT NULL AND (is_private = 0 OR ? = 1) GROUP BY dream_id`,
    )
    .all(scope.dreamerId, INC(scope)) as { dream_id: number; n: number }[];
  const actionMap = new Map(actions.map((a) => [a.dream_id, a.n]));
  return rows.map((d) => {
    const entries = progress.filter((p) => p.dream_id === d.id);
    return {
      id: d.id,
      dreamerId: d.dreamer_id,
      slot: d.slot,
      slotLabel: labels[d.slot - 1] ?? `Dream ${d.slot}`,
      title: d.title,
      description: d.description,
      progress: entries[0]?.value ?? null,
      progressAt: entries[0]?.occurred_at ?? null,
      previousProgress: entries[1]?.value ?? null,
      ...(scope.includePrivate ? { progressIsPrivate: !!entries[0]?.is_private } : {}),
      achievedAt: d.achieved_at,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      activeActions: actionMap.get(d.id) ?? 0,
    };
  });
}

export function getDream(db: DB, scope: Scope, dreamId: number): Dream | null {
  return listDreams(db, scope).find((d) => d.id === dreamId) ?? null;
}

/* ---------- Ratings ---------- */

export function listRatings(db: DB, scope: Scope, opts: { category?: RatingCategory; from?: string; to?: string; sessionId?: number; checkInId?: number } = {}): RatingEntry[] {
  const where: string[] = ['x.dreamer_id = ?', '(x.is_private = 0 OR ? = 1)'];
  const params: unknown[] = [INC(scope), scope.dreamerId, INC(scope)];
  if (opts.category) { where.push('x.category = ?'); params.push(opts.category); }
  if (opts.from) { where.push('x.occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('x.occurred_at <= ?'); params.push(opts.to); }
  if (opts.sessionId != null) { where.push('x.session_id = ?'); params.push(opts.sessionId); }
  if (opts.checkInId != null) { where.push('x.check_in_id = ?'); params.push(opts.checkInId); }
  const rows = db.prepare(`${RATING_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.occurred_at ASC, ${CATEGORY_ORDER}, x.created_at ASC, x.id ASC`).all(...params) as RatingRow[];
  return rows.map(mapRating);
}

export function getRating(db: DB, scope: Scope, id: number): RatingEntry | null {
  const row = db.prepare(`${RATING_SELECT} WHERE x.id = ? AND x.dreamer_id = ? AND (x.is_private = 0 OR ? = 1)`).get(INC(scope), id, scope.dreamerId, INC(scope)) as RatingRow | undefined;
  return row ? mapRating(row) : null;
}

export function latestRatings(db: DB, scope: Scope): Partial<Record<RatingCategory, LatestRating>> {
  const rows = db
    .prepare(
      `SELECT category, value, occurred_at, source, is_private FROM ratings
       WHERE dreamer_id = ? AND (is_private = 0 OR ? = 1) ORDER BY occurred_at DESC, created_at DESC, id DESC`,
    )
    .all(scope.dreamerId, INC(scope)) as { category: RatingCategory; value: number; occurred_at: string; source: 'session' | 'self'; is_private: number }[];
  const out: Partial<Record<RatingCategory, LatestRating>> = {};
  for (const cat of RATING_CATEGORIES) {
    const [latest, prev] = rows.filter((r) => r.category === cat);
    if (latest) out[cat] = { category: cat, value: latest.value, occurredAt: latest.occurred_at, source: latest.source, previous: prev?.value ?? null, ...(scope.includePrivate ? { isPrivate: !!latest.is_private } : {}) };
  }
  return out;
}

/* ---------- Progress ---------- */

export function listProgress(db: DB, scope: Scope, opts: { dreamId?: number; sessionId?: number; checkInId?: number } = {}): ProgressEntry[] {
  const where: string[] = ['x.dreamer_id = ?', '(x.is_private = 0 OR ? = 1)'];
  const params: unknown[] = [INC(scope), scope.dreamerId, INC(scope)];
  if (opts.dreamId != null) { where.push('x.dream_id = ?'); params.push(opts.dreamId); }
  if (opts.sessionId != null) { where.push('x.session_id = ?'); params.push(opts.sessionId); }
  if (opts.checkInId != null) { where.push('x.check_in_id = ?'); params.push(opts.checkInId); }
  // Same-moment entries (one session or check-in) keep dream order, since ids carry no order.
  const rows = db
    .prepare(`${PROGRESS_SELECT} WHERE ${where.join(' AND ')} ORDER BY x.occurred_at ASC, (SELECT d.slot FROM dreams d WHERE d.id = x.dream_id), x.created_at ASC, x.id ASC`)
    .all(...params) as ProgressRow[];
  return rows.map(mapProgress);
}

export function getProgressEntry(db: DB, scope: Scope, id: number): ProgressEntry | null {
  const row = db.prepare(`${PROGRESS_SELECT} WHERE x.id = ? AND x.dreamer_id = ? AND (x.is_private = 0 OR ? = 1)`).get(INC(scope), id, scope.dreamerId, INC(scope)) as ProgressRow | undefined;
  return row ? mapProgress(row) : null;
}

/* ---------- Journal ---------- */

export function listJournal(
  db: DB,
  scope: Scope,
  opts: { from?: string; to?: string; dreamId?: number; category?: RatingCategory; standaloneOnly?: boolean; checkInId?: number; sessionId?: number } = {},
): JournalEntry[] {
  // A note attached to a rating/progress entry is only visible if its parent is visible too.
  const where: string[] = ['j.dreamer_id = ?', JOURNAL_VISIBLE('j')];
  const params: unknown[] = [scope.dreamerId, INC(scope), INC(scope), INC(scope)];
  if (opts.from) { where.push('j.occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('j.occurred_at <= ?'); params.push(opts.to); }
  if (opts.dreamId != null) { where.push('j.dream_id = ?'); params.push(opts.dreamId); }
  if (opts.category) { where.push('j.category = ?'); params.push(opts.category); }
  if (opts.standaloneOnly) where.push('j.rating_id IS NULL AND j.progress_id IS NULL');
  if (opts.checkInId != null) { where.push('j.check_in_id = ?'); params.push(opts.checkInId); }
  if (opts.sessionId != null) { where.push('j.session_id = ?'); params.push(opts.sessionId); }
  const rows = db.prepare(`${JOURNAL_SELECT} WHERE ${where.join(' AND ')} ORDER BY j.occurred_at DESC, j.id DESC`).all(...params) as JournalRow[];
  return rows.map((r) => mapJournal(r, scope));
}

export function getJournalEntry(db: DB, scope: Scope, id: number): JournalEntry | null {
  return listJournal(db, scope).find((j) => j.id === id) ?? null;
}

/* ---------- Actions ---------- */

export function listActions(db: DB, scope: Scope, status?: ActionItem['status'] | 'all'): ActionItem[] {
  const where: string[] = ['x.dreamer_id = ?', '(x.is_private = 0 OR ? = 1)'];
  const params: unknown[] = [scope.dreamerId, INC(scope)];
  if (status && status !== 'all') { where.push('x.status = ?'); params.push(status); }
  const rows = db
    .prepare(
      `${ACTION_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY CASE x.status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
                COALESCE(x.completed_at, x.archived_at, x.created_at) DESC, x.id DESC`,
    )
    .all(...params) as ActionRow[];
  return rows.map(mapAction);
}

export function getAction(db: DB, scope: Scope, id: number): ActionItem | null {
  const row = db.prepare(`${ACTION_SELECT} WHERE x.id = ? AND x.dreamer_id = ? AND (x.is_private = 0 OR ? = 1)`).get(id, scope.dreamerId, INC(scope)) as ActionRow | undefined;
  return row ? mapAction(row) : null;
}

/* ---------- Coaching sessions ---------- */

function mapSession(db: DB, scope: Scope, s: SessionRow, number: number): CoachingSession {
  // Cells come in CARE order / dream order, never in an order a private write could move. Within a cell,
  // shared rows win over private ones (a coach may re-enter a value the dreamer privatised).
  const ratings = db
    .prepare(`SELECT x.category, x.value, x.is_private FROM ratings x WHERE x.session_id = ? AND (x.is_private = 0 OR ? = 1) ORDER BY ${CATEGORY_ORDER}, x.is_private DESC, x.updated_at ASC`)
    .all(s.id, INC(scope)) as { category: RatingCategory; value: number; is_private: number }[];
  const progress = db
    .prepare(`SELECT dream_id, value, is_private FROM dream_progress WHERE session_id = ? AND (is_private = 0 OR ? = 1) ORDER BY dream_id, is_private DESC, updated_at ASC`)
    .all(s.id, INC(scope)) as { dream_id: number; value: number; is_private: number }[];
  // Actions chosen in this session, and how many of those have since been completed.
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS created, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM actions WHERE session_id = ? AND dreamer_id = ? AND (is_private = 0 OR ? = 1)`,
    )
    .get(s.id, s.dreamer_id, INC(scope)) as { created: number | null; completed: number | null };
  // The last row per cell wins (the query lists private rows first), and with it whether the value shown is private.
  const r: Partial<Record<RatingCategory, number>> = {};
  const ratingPrivate = new Map<RatingCategory, boolean>();
  for (const row of ratings) { r[row.category] = row.value; ratingPrivate.set(row.category, !!row.is_private); }
  const privateRatings = [...ratingPrivate].filter(([, priv]) => priv).map(([cat]) => cat);
  const p: Record<number, number> = {};
  const progressPrivate = new Map<number, boolean>();
  for (const row of progress) { p[row.dream_id] = row.value; progressPrivate.set(row.dream_id, !!row.is_private); }
  const privateProgress = [...progressPrivate].filter(([, priv]) => priv).map(([dreamId]) => dreamId);
  return {
    id: s.id,
    dreamerId: s.dreamer_id,
    coach: { id: s.coach_user_id, name: s.coach_name, initials: initials(s.coach_name) },
    number,
    status: s.status,
    occurredAt: s.occurred_at,
    // A reopened session keeps its original completion time for when it is completed again.
    completedAt: s.status === 'completed' ? s.completed_at : null,
    notes: s.notes,
    focus: s.focus,
    actionsReviewed: !!s.actions_reviewed,
    ratings: r,
    progress: p,
    ...(scope.includePrivate ? { privateRatings, privateProgress } : {}),
    actionsCreated: counts.created ?? 0,
    actionsCompleted: counts.completed ?? 0,
  };
}

export function listSessions(db: DB, scope: Scope): CoachingSession[] {
  const rows = db.prepare(`${SESSION_SELECT} WHERE s.dreamer_id = ? ORDER BY s.occurred_at ASC, s.id ASC`).all(scope.dreamerId) as SessionRow[];
  return rows.map((s, i) => mapSession(db, scope, s, i + 1));
}

export function getSession(db: DB, scope: Scope, sessionId: number): CoachingSession | null {
  return listSessions(db, scope).find((s) => s.id === sessionId) ?? null;
}

export function getGrid(db: DB, scope: Scope): SessionGrid {
  const dreams = listDreams(db, scope).map((d) => ({ id: d.id, slot: d.slot, slotLabel: d.slotLabel, title: d.title }));
  return { dreams, sessions: listSessions(db, scope) };
}

/* ---------- Check-ins ---------- */

export function listCheckIns(db: DB, scope: Scope, opts: { from?: string; to?: string; limit?: number } = {}): CheckIn[] {
  const where = ['c.dreamer_id = ?'];
  const params: unknown[] = [scope.dreamerId];
  if (opts.from) { where.push('c.occurred_at >= ?'); params.push(opts.from); }
  if (opts.to) { where.push('c.occurred_at <= ?'); params.push(opts.to); }
  const rows = db.prepare(`SELECT c.id, c.dreamer_id, c.occurred_at FROM check_ins c WHERE ${where.join(' AND ')} ORDER BY c.occurred_at DESC, c.id DESC`).all(...params) as {
    id: number; dreamer_id: number; occurred_at: string;
  }[];
  const out: CheckIn[] = [];
  for (const c of rows) {
    const ratings = listRatings(db, scope, { checkInId: c.id });
    const progress = listProgress(db, scope, { checkInId: c.id });
    const reflection = listJournal(db, scope, { checkInId: c.id, standaloneOnly: true })[0] ?? null;
    // A check-in whose every entry is hidden does not exist for this viewer.
    if (!ratings.length && !progress.length && !reflection) continue;
    out.push({ id: c.id, dreamerId: c.dreamer_id, occurredAt: c.occurred_at, source: 'self', sessionId: null, ratings, progress, reflection });
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

export function getCheckIn(db: DB, scope: Scope, id: number): CheckIn | null {
  return listCheckIns(db, scope).find((c) => c.id === id) ?? null;
}

/* ---------- Snapshot & timeline ---------- */

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

export function getSnapshot(db: DB, scope: Scope): Snapshot {
  const inc = INC(scope);
  const d30 = daysAgo(30);
  const actions = db
    .prepare(
      `SELECT SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'completed' AND completed_at >= ? THEN 1 ELSE 0 END) AS done30
       FROM actions WHERE dreamer_id = ? AND (is_private = 0 OR ? = 1)`,
    )
    .get(d30, scope.dreamerId, inc) as { active: number | null; done30: number | null };
  const sessions = listSessions(db, scope);
  const completed = sessions.filter((s) => s.status === 'completed');
  const last = completed[completed.length - 1] ?? null;
  const open = sessions.find((s) => s.status === 'in_progress') ?? null;
  // Self activity: only visible entries count. A check-in counts when any of its entries is visible
  // (the same rule as listCheckIns); a reflection is anything the dreamer wrote outside a check-in — a
  // standalone entry, or a note on a session-recorded value (dated when written, as in journal30 below).
  const lastCheckIn = listCheckIns(db, scope, { limit: 1 })[0]?.occurredAt ?? null;
  const lastReflection = (
    db
      .prepare(
        `SELECT MAX(${ACTIVITY_AT('j')}) AS t FROM journal_entries j
         WHERE j.dreamer_id = ? AND ${WRITTEN_BY_DREAMER('j')} AND j.check_in_id IS NULL AND ${JOURNAL_VISIBLE('j')}`,
      )
      .get(scope.dreamerId, inc, inc, inc) as { t: string | null }
  ).t;
  const lastSelfActivity: Snapshot['lastSelfActivity'] =
    lastReflection && (!lastCheckIn || lastReflection > lastCheckIn) ? { at: lastReflection, kind: 'reflection' } : lastCheckIn ? { at: lastCheckIn, kind: 'check-in' } : null;
  const checkIns30 = listCheckIns(db, scope, { from: d30 }).length;
  // The dreamer's own words in the last 30 days: reflections and notes, on self and session entries alike.
  const journal30 = db
    .prepare(`SELECT COUNT(*) AS n FROM journal_entries j WHERE j.dreamer_id = ? AND ${WRITTEN_BY_DREAMER('j')} AND ${ACTIVITY_AT('j')} >= ? AND ${JOURNAL_VISIBLE('j')}`)
    .get(scope.dreamerId, d30, inc, inc, inc) as { n: number };
  return {
    latest: latestRatings(db, scope),
    dreams: listDreams(db, scope),
    activeActions: actions.active ?? 0,
    completedActions30d: actions.done30 ?? 0,
    lastSession: last ? { id: last.id, occurredAt: last.occurredAt, number: last.number, status: last.status } : null,
    openSession: open ? { id: open.id, occurredAt: open.occurredAt } : null,
    lastSelfCheckIn: lastCheckIn,
    lastSelfActivity,
    selfCheckIns30d: checkIns30,
    journalEntries30d: journal30.n,
    sessionsCompleted: completed.length,
  };
}

export function getTimeline(db: DB, scope: Scope, opts: { limit?: number; from?: string; to?: string } = {}): TimelineItem[] {
  const items: TimelineItem[] = [];
  const dreams = new Map(listDreams(db, scope).map((d) => [d.id, d.title]));
  // Session-recorded ratings/progress are represented by their session item (which carries all
  // values, focus and notes), so the feed shows one row per coaching session instead of ten.
  for (const r of listRatings(db, scope, { from: opts.from, to: opts.to })) if (r.sessionId == null) items.push({ kind: 'rating', at: r.occurredAt, item: r });
  for (const p of listProgress(db, scope)) {
    if (p.sessionId != null) continue;
    if (opts.from && p.occurredAt < opts.from) continue;
    if (opts.to && p.occurredAt > opts.to) continue;
    items.push({ kind: 'progress', at: p.occurredAt, item: p, dreamTitle: dreams.get(p.dreamId) ?? 'Dream' });
  }
  // Attached notes travel with their parent entries; only standalone reflections appear on their own —
  // except notes on values a coach recorded, whose parent is folded into its session item, so they sit beside it.
  for (const j of listJournal(db, scope, { from: opts.from, to: opts.to })) {
    const standalone = j.ratingId == null && j.progressId == null;
    const onSessionValue = j.sessionId != null && (j.ratingId != null || j.progressId != null);
    if (standalone || onSessionValue) items.push({ kind: 'journal', at: j.occurredAt, item: j });
  }
  for (const a of listActions(db, scope, 'all')) {
    const push = (at: string, event: 'created' | 'completed' | 'archived') => {
      if (opts.from && at < opts.from) return;
      if (opts.to && at > opts.to) return;
      items.push({ kind: 'action', at, item: a, event });
    };
    push(a.createdAt, 'created');
    if (a.completedAt) push(a.completedAt, 'completed');
    if (a.archivedAt) push(a.archivedAt, 'archived');
  }
  for (const s of listSessions(db, scope)) {
    if (opts.from && s.occurredAt < opts.from) continue;
    if (opts.to && s.occurredAt > opts.to) continue;
    items.push({ kind: 'session', at: s.occurredAt, item: s });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return opts.limit ? items.slice(0, opts.limit) : items;
}

export function getCategoryHistory(db: DB, scope: Scope, category: RatingCategory): CategoryHistory {
  const entries = listRatings(db, scope, { category });
  const checkInIds = new Set(entries.map((e) => e.checkInId).filter((x): x is number => x != null));
  const reflections = listJournal(db, scope, { standaloneOnly: true }).filter(
    (j) => (j.checkInId != null && checkInIds.has(j.checkInId)) || j.category === category,
  );
  return { category, entries, reflections };
}

export function getDreamHistory(db: DB, scope: Scope, dreamId: number): DreamHistory | null {
  const dream = getDream(db, scope, dreamId);
  if (!dream) return null;
  const entries = listProgress(db, scope, { dreamId });
  const actions = listActions(db, scope, 'all').filter((a) => a.dreamId === dreamId);
  const reflections = listJournal(db, scope, { standaloneOnly: true }).filter((j) => j.dreamId === dreamId);
  return { dream, entries, actions, reflections };
}

export const CARE = CARE_CATEGORIES;
