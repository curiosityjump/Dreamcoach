/**
 * Staff-facing aggregates. Everything here uses staffScope (private rows excluded),
 * so a private rating/action/journal entry can never move a number on a coach or
 * Director screen.
 */
import type { DB } from './db.ts';
import type { Viewer } from './auth.ts';
import { staffScope } from './privacy.ts';
import { toUser } from './auth.ts';
import * as q from './queries.ts';
import { JOURNAL_VISIBLE } from './queries.ts';
import { CARE_CATEGORIES, RATING_CATEGORIES, type RatingCategory } from '../shared/care.ts';
import type { CaseloadEntry, CoachDashboard, CoachDetail, CoachSummary, DirectorDreamerRow, DirectorOverview, MonthPoint, User } from '../shared/types.ts';

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
/** Start of the current month in UTC, matching the YYYY-MM month keys the trend charts bucket by. */
const utcMonthStart = (ms: number) => { const d = new Date(ms); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

function caseloadEntry(db: DB, viewer: Viewer, dreamerId: number): CaseloadEntry {
  const scope = staffScope(viewer, dreamerId);
  const dreamer = q.getDreamerProfile(db, dreamerId)!;
  const snapshot = q.getSnapshot(db, scope);
  const careVals = CARE_CATEGORIES.map((c) => snapshot.latest[c]?.value).filter((v): v is number => v != null);
  const dreamVals = snapshot.dreams.map((d) => d.progress).filter((v): v is number => v != null);
  const lastSession = snapshot.lastSession?.occurredAt ?? null;
  const lastSelf = snapshot.lastSelfActivity?.at ?? null;
  let lastActivityAt: string | null = null;
  let lastActivityKind: 'session' | 'self' | null = null;
  if (lastSession && (!lastSelf || lastSession >= lastSelf)) { lastActivityAt = lastSession; lastActivityKind = 'session'; }
  else if (lastSelf) { lastActivityAt = lastSelf; lastActivityKind = 'self'; }
  return { dreamer, snapshot, careAverage: avg(careVals), dreamAverage: avg(dreamVals), lastActivityAt, lastActivityKind };
}

function dreamerIdsForCoach(db: DB, coachUserId: number): number[] {
  return (db.prepare('SELECT id FROM dreamers WHERE coach_user_id = ? ORDER BY id').all(coachUserId) as { id: number }[]).map((r) => r.id);
}

function allDreamerIds(db: DB): number[] {
  return (db.prepare('SELECT id FROM dreamers ORDER BY id').all() as { id: number }[]).map((r) => r.id);
}

/* ---------- Coach dashboard ---------- */

export function coachDashboard(db: DB, viewer: Viewer, coachUserId: number): CoachDashboard {
  const coachRow = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(coachUserId) as { id: number; email: string; name: string; role: string };
  const ids = dreamerIdsForCoach(db, coachUserId);
  const caseload = ids.map((id) => caseloadEntry(db, viewer, id));
  caseload.sort((a, b) => a.dreamer.name.localeCompare(b.dreamer.name));
  const now = Date.now();
  const monthStart = utcMonthStart(now);
  const d30 = iso(now - 30 * DAY);
  const d45 = iso(now - 45 * DAY);
  const inList = ids.length ? ids.map(() => '?').join(',') : 'NULL';
  const activeIds = caseload.filter((c) => c.dreamer.status === 'active').map((c) => c.dreamer.id);
  // Sessions are credited to whoever ran them; open sessions and "seen" cover the current caseload.
  const ran = db
    .prepare(
      `SELECT SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS month,
              SUM(CASE WHEN occurred_at >= ? THEN 1 ELSE 0 END) AS d30
       FROM coaching_sessions WHERE status = 'completed' AND coach_user_id = ?`,
    )
    .get(monthStart, d30, coachUserId) as { month: number | null; d30: number | null };
  const sessions = db
    .prepare(
      `SELECT SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS open,
              COUNT(DISTINCT CASE WHEN status = 'completed' AND occurred_at >= ? AND dreamer_id IN (${activeIds.length ? activeIds.map(() => '?').join(',') : 'NULL'}) THEN dreamer_id END) AS seen45
       FROM coaching_sessions WHERE dreamer_id IN (${inList})`,
    )
    .get(d45, ...activeIds, ...ids) as { open: number | null; seen45: number | null };
  const selfCheckIns = caseload.reduce((n, c) => n + c.snapshot.selfCheckIns30d, 0);
  return {
    coach: toUser(coachRow),
    caseload,
    stats: {
      dreamers: ids.length,
      activeDreamers: activeIds.length,
      sessionsThisMonth: ran.month ?? 0,
      sessionsLast30d: ran.d30 ?? 0,
      dreamersSeenLast45d: sessions.seen45 ?? 0,
      selfCheckInsLast30d: selfCheckIns,
      openSessions: sessions.open ?? 0,
    },
  };
}

/* ---------- Shared metric helpers ---------- */

interface SessionCare { dreamerId: number; occurredAt: string; careAvg: number | null; ratings: Partial<Record<RatingCategory, number>> }

function sessionCareSeries(db: DB, viewer: Viewer, dreamerId: number): SessionCare[] {
  const sessions = q.listSessions(db, staffScope(viewer, dreamerId)).filter((s) => s.status === 'completed');
  return sessions.map((s) => {
    const vals = CARE_CATEGORIES.map((c) => s.ratings[c]).filter((v): v is number => v != null);
    return { dreamerId, occurredAt: s.occurredAt, careAvg: vals.length === 4 ? avg(vals) : null, ratings: s.ratings };
  });
}

/** Mean change in CARE average between a dreamer's first and latest completed session (needs >= 2 with full CARE). */
function careChangeFor(series: SessionCare[]): number | null {
  const withCare = series.filter((s) => s.careAvg != null);
  if (withCare.length < 2) return null;
  return Math.round((withCare[withCare.length - 1]!.careAvg! - withCare[0]!.careAvg!) * 10) / 10;
}

function groupSummary(db: DB, viewer: Viewer, coach: User | null, ids: number[]): CoachSummary {
  const now = Date.now();
  const d30 = iso(now - 30 * DAY);
  const d45 = iso(now - 45 * DAY);
  const d90 = iso(now - 90 * DAY);
  const inList = ids.length ? ids.map(() => '?').join(',') : 'NULL';
  const statuses = db.prepare(`SELECT status, COUNT(*) AS n FROM dreamers WHERE id IN (${inList}) GROUP BY status`).all(...ids) as { status: string; n: number }[];
  const active = statuses.find((s) => s.status === 'active')?.n ?? 0;
  const activeIds = (db.prepare(`SELECT id FROM dreamers WHERE id IN (${inList}) AND status = 'active'`).all(...ids) as { id: number }[]).map((r) => r.id);
  // Sessions are credited to the person who ran them (the team row counts every session). Everything
  // else describes the current caseload; participation and engagement look at its active dreamers only.
  const sess = db
    .prepare(
      `SELECT SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS total,
              SUM(CASE WHEN status = 'completed' AND occurred_at >= ? THEN 1 ELSE 0 END) AS d30
       FROM coaching_sessions WHERE ${coach ? 'coach_user_id = ?' : `dreamer_id IN (${inList})`}`,
    )
    .get(d30, ...(coach ? [coach.id] : ids)) as { total: number | null; d30: number | null };
  const seen = db
    .prepare(
      `SELECT COUNT(DISTINCT dreamer_id) AS n FROM coaching_sessions
       WHERE status = 'completed' AND occurred_at >= ? AND dreamer_id IN (${activeIds.length ? activeIds.map(() => '?').join(',') : 'NULL'})`,
    )
    .get(d45, ...activeIds) as { n: number };
  const entries = ids.map((id) => caseloadEntry(db, viewer, id));
  const engaged = entries.filter((e) => e.dreamer.status === 'active' && (e.snapshot.selfCheckIns30d > 0 || e.snapshot.journalEntries30d > 0)).length;
  const changes = ids.map((id) => careChangeFor(sessionCareSeries(db, viewer, id))).filter((v): v is number => v != null);
  const commitments = entries.map((e) => e.snapshot.latest.commitment?.value).filter((v): v is number => v != null);
  const satisfactions = entries.map((e) => e.snapshot.latest.satisfaction?.value).filter((v): v is number => v != null);
  const dreamProgress = entries.flatMap((e) => e.snapshot.dreams.map((d) => d.progress)).filter((v): v is number => v != null);
  const dreamsAchieved = entries.reduce((n, e) => n + e.snapshot.dreams.filter((d) => d.achievedAt).length, 0);
  const actions = db
    .prepare(
      `SELECT SUM(CASE WHEN status = 'completed' AND completed_at >= ? THEN 1 ELSE 0 END) AS done90,
              SUM(CASE WHEN created_at <= ? THEN 1 ELSE 0 END) AS olderN,
              SUM(CASE WHEN created_at <= ? AND status = 'completed' THEN 1 ELSE 0 END) AS olderDone
       FROM actions WHERE is_private = 0 AND dreamer_id IN (${inList})`,
    )
    .get(d90, d30, d30, ...ids) as { done90: number | null; olderN: number | null; olderDone: number | null };
  return {
    coach: coach ?? { id: 0, email: '', name: 'Dream Team', role: 'director', initials: 'DT' },
    dreamers: ids.length,
    activeDreamers: active,
    sessionsLast30d: sess.d30 ?? 0,
    sessionsTotal: sess.total ?? 0,
    participation45d: active ? Math.round((seen.n / active) * 100) : null,
    engagedBetweenSessions30d: engaged,
    careChange: changes.length ? { value: avg(changes)!, n: changes.length } : null,
    avgCommitment: avg(commitments),
    avgSatisfaction: avg(satisfactions),
    avgDreamProgress: avg(dreamProgress),
    dreamsAchieved,
    actionsCompleted90d: actions.done90 ?? 0,
    followThrough: actions.olderN ? { rate: Math.round(((actions.olderDone ?? 0) / actions.olderN) * 100), n: actions.olderN } : null,
  };
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Month trends for a group of dreamers; with `coachUserId`, session counts are the sessions that coach ran. */
function monthSeries(db: DB, viewer: Viewer, ids: number[], startsOn: string, coachUserId?: number): MonthPoint[] {
  const inList = ids.length ? ids.map(() => '?').join(',') : 'NULL';
  const start = monthKey(startsOn);
  const end = monthKey(new Date().toISOString());
  const keys: string[] = [];
  for (let k = start; k <= end; ) {
    keys.push(k);
    const [y, m] = k.split('-').map(Number);
    const next = new Date(Date.UTC(y!, m!, 1));
    k = next.toISOString().slice(0, 7);
    if (keys.length > 60) break;
  }
  const sessions = db
    .prepare(`SELECT id, dreamer_id, substr(occurred_at,1,7) AS m FROM coaching_sessions WHERE status = 'completed' AND ${coachUserId != null ? 'coach_user_id = ?' : `dreamer_id IN (${inList})`}`)
    .all(...(coachUserId != null ? [coachUserId] : ids)) as { id: number; dreamer_id: number; m: string }[];
  const ratings = db
    .prepare(`SELECT category, value, substr(occurred_at,1,7) AS m FROM ratings WHERE source = 'session' AND is_private = 0 AND dreamer_id IN (${inList})`)
    .all(...ids) as { category: RatingCategory; value: number; m: string }[];
  const progress = db
    .prepare(`SELECT value, substr(occurred_at,1,7) AS m FROM dream_progress WHERE source = 'session' AND is_private = 0 AND dreamer_id IN (${inList})`)
    .all(...ids) as { value: number; m: string }[];
  // Journal entries the dreamers wrote themselves (reflections and notes, on self or session entries).
  const journal = db
    .prepare(`SELECT substr(j.occurred_at,1,7) AS m, COUNT(*) AS n FROM journal_entries j WHERE ${q.WRITTEN_BY_DREAMER('j')} AND ${JOURNAL_VISIBLE('j')} AND j.dreamer_id IN (${inList}) GROUP BY m`)
    .all(0, 0, 0, ...ids) as { m: string; n: number }[];
  const actionsCreated = db
    .prepare(`SELECT substr(created_at,1,7) AS m, COUNT(*) AS n FROM actions WHERE is_private = 0 AND dreamer_id IN (${inList}) GROUP BY m`)
    .all(...ids) as { m: string; n: number }[];
  const actionsCompleted = db
    .prepare(`SELECT substr(completed_at,1,7) AS m, COUNT(*) AS n FROM actions WHERE is_private = 0 AND status = 'completed' AND completed_at IS NOT NULL AND dreamer_id IN (${inList}) GROUP BY m`)
    .all(...ids) as { m: string; n: number }[];
  // Self check-ins: count only check-ins with at least one visible entry.
  const checkIns = ids.flatMap((id) => q.listCheckIns(db, staffScope(viewer, id)).map((c) => monthKey(c.occurredAt)));
  const joined = db.prepare(`SELECT id, joined_on FROM dreamers WHERE id IN (${inList})`).all(...ids) as { id: number; joined_on: string }[];
  return keys.map((k) => {
    const care: Partial<Record<RatingCategory, number>> = {};
    for (const cat of RATING_CATEGORIES) {
      const vals = ratings.filter((r) => r.m === k && r.category === cat).map((r) => r.value);
      const a = avg(vals);
      if (a != null) care[cat] = a;
    }
    const careVals = CARE_CATEGORIES.map((c) => care[c]).filter((v): v is number => v != null);
    const prog = progress.filter((p) => p.m === k).map((p) => p.value);
    return {
      month: k,
      label: monthLabel(k),
      sessions: sessions.filter((s) => s.m === k).length,
      selfCheckIns: checkIns.filter((m) => m === k).length,
      journalEntries: journal.find((j) => j.m === k)?.n ?? 0,
      actionsCompleted: actionsCompleted.find((a) => a.m === k)?.n ?? 0,
      actionsCreated: actionsCreated.find((a) => a.m === k)?.n ?? 0,
      care,
      careAverage: careVals.length ? avg(careVals) : null,
      dreamProgress: avg(prog),
      activeDreamers: joined.filter((d) => monthKey(d.joined_on) <= k).length,
    };
  });
}

/* ---------- Director ---------- */

export function directorOverview(db: DB, viewer: Viewer): DirectorOverview {
  const program = q.getProgram(db, (db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get() as { id: number }).id);
  const coachRows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role FROM users u
       WHERE u.role = 'coach' OR (u.role = 'director' AND (EXISTS (SELECT 1 FROM dreamers d WHERE d.coach_user_id = u.id) OR EXISTS (SELECT 1 FROM coaching_sessions s WHERE s.coach_user_id = u.id)))
       ORDER BY u.role = 'director', u.name`,
    )
    .all() as { id: number; email: string; name: string; role: string }[];
  const coaches = coachRows.map((c) => groupSummary(db, viewer, toUser(c), dreamerIdsForCoach(db, c.id)));
  const ids = allDreamerIds(db);
  const all = groupSummary(db, viewer, null, ids);
  const thisMonth = db.prepare(`SELECT COUNT(*) AS n FROM coaching_sessions WHERE status = 'completed' AND occurred_at >= ?`).get(utcMonthStart(Date.now())) as { n: number };
  const unassigned = db.prepare('SELECT COUNT(*) AS n FROM dreamers WHERE coach_user_id IS NULL').get() as { n: number };
  const careLatest: Partial<Record<RatingCategory, number>> = {};
  const entries = ids.map((id) => q.latestRatings(db, staffScope(viewer, id)));
  for (const cat of RATING_CATEGORIES) {
    const a = avg(entries.map((e) => e[cat]?.value).filter((v): v is number => v != null));
    if (a != null) careLatest[cat] = a;
  }
  return {
    program,
    totals: {
      coaches: coachRows.length,
      dreamers: ids.length,
      unassignedDreamers: unassigned.n,
      activeDreamers: all.activeDreamers,
      sessionsTotal: all.sessionsTotal,
      sessionsLast30d: all.sessionsLast30d,
      sessionsThisMonth: thisMonth.n,
      participation45d: all.participation45d,
      engagedBetweenSessions30d: all.engagedBetweenSessions30d,
      dreamsAchieved: all.dreamsAchieved,
      avgDreamProgress: all.avgDreamProgress,
      avgCommitment: all.avgCommitment,
      avgSatisfaction: all.avgSatisfaction,
      careChange: all.careChange,
      careLatest,
      actionsCompleted90d: all.actionsCompleted90d,
      followThrough: all.followThrough,
    },
    coaches,
    months: monthSeries(db, viewer, ids, program.startsOn),
  };
}

export function directorDreamers(db: DB, viewer: Viewer): DirectorDreamerRow[] {
  return allDreamerIds(db)
    .map((id) => {
      const entry = caseloadEntry(db, viewer, id);
      return { ...entry, careChange: careChangeFor(sessionCareSeries(db, viewer, id)), sessionsCompleted: entry.snapshot.sessionsCompleted };
    })
    .sort((a, b) => a.dreamer.name.localeCompare(b.dreamer.name));
}

export function coachDetail(db: DB, viewer: Viewer, coachUserId: number): CoachDetail | null {
  const c = db.prepare(`SELECT id, email, name, role FROM users WHERE id = ? AND role IN ('coach','director')`).get(coachUserId) as
    | { id: number; email: string; name: string; role: string }
    | undefined;
  if (!c) return null;
  const ids = dreamerIdsForCoach(db, coachUserId);
  const program = q.getProgram(db, (db.prepare('SELECT id FROM programs ORDER BY id LIMIT 1').get() as { id: number }).id);
  return {
    summary: groupSummary(db, viewer, toUser(c), ids),
    caseload: ids.map((id) => caseloadEntry(db, viewer, id)).sort((a, b) => a.dreamer.name.localeCompare(b.dreamer.name)),
    months: monthSeries(db, viewer, ids, program.startsOn, coachUserId),
  };
}

export function listStaff(db: DB): User[] {
  return (db.prepare(`SELECT id, email, name, role FROM users WHERE role IN ('coach','director') ORDER BY role = 'director', name`).all() as { id: number; email: string; name: string; role: string }[]).map(toUser);
}
