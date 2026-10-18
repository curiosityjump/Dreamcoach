/**
 * Small pieces shared by the three director pages: stat groups, the metric
 * definitions, the comparison caveat, and the table cell renderers.
 *
 * The server already returns only what the director may see, so nothing here
 * filters or mentions privacy. Figures are context, never a ranking.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CARE_CATEGORIES, CATEGORY_META } from '@shared/care';
import type { CoachSummary, DreamerStatus, LatestRating, Snapshot } from '@shared/types';
import { Avatar, Bar, Chip, Stat } from '@/components/ui';
import { IconInfo } from '@/components/icons';
import { fmtDate, fmtDateTime, num, pct, plural, relativeTime, signed } from '@/lib/format';
import type { RatingCategory } from '@shared/care';

/* ---------- Dates ---------- */

/** Format a date-only string ("2026-02-01") in local time so it never slips a day across time zones. */
export function fmtDay(day: string, opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' }): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return fmtDate(day, opts);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', opts);
}

/** "February 1 – November 30, 2026" (year once when both ends share it). */
export function fmtDayRange(from: string, to: string): string {
  const y1 = from.slice(0, 4);
  const y2 = to.slice(0, 4);
  if (y1 === y2) return `${fmtDay(from)} – ${fmtDay(to, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  return `${fmtDay(from, { month: 'long', day: 'numeric', year: 'numeric' })} – ${fmtDay(to, { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

/**
 * Which month of the program we are in, e.g. { current: 9, total: 10 }; null outside the program window.
 * `now` is read in UTC, like the server's monthly buckets, so the counter agrees with the charts and "Sessions this month".
 */
export function programMonth(startsOn: string, endsOn: string, now = new Date()): { current: number; total: number } | null {
  const s = new Date(Number(startsOn.slice(0, 4)), Number(startsOn.slice(5, 7)) - 1, 1);
  const e = new Date(Number(endsOn.slice(0, 4)), Number(endsOn.slice(5, 7)) - 1, 1);
  const total = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  const current = (now.getUTCFullYear() - s.getFullYear()) * 12 + (now.getUTCMonth() - s.getMonth()) + 1;
  if (current < 1 || current > total) return null;
  return { current, total };
}

/* ---------- Stat groups ---------- */

export interface StatItem { key: string; label: ReactNode; value: ReactNode; sub?: ReactNode }

export function StatGroup({ label, items, testPrefix }: { label: string; items: StatItem[]; testPrefix: string }) {
  return (
    <section className="dir-stat-group" aria-label={label}>
      <div className="dir-eyebrow">{label}</div>
      <div className="stat-row dir-stat-row">
        {items.map((s) => (
          <div key={s.key} data-testid={`${testPrefix}-${s.key}`}>
            <Stat label={s.label} value={s.value} sub={s.sub} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** A signed change with the optional "n = …" footnote, used for CARE change everywhere. */
export function CareChangeValue({ change, size = 'md' }: { change: { value: number; n: number } | number | null | undefined; size?: 'md' | 'lg' }) {
  if (change == null) return <span className="muted">—</span>;
  const value = typeof change === 'number' ? change : change.value;
  const n = typeof change === 'number' ? null : change.n;
  const tone = value > 0 ? 'is-up' : value < 0 ? 'is-down' : 'is-flat';
  return (
    <span className={`dir-signed ${tone}${size === 'lg' ? ' dir-signed-lg' : ''}`}>
      <span className="tnum">{signed(value)}</span>
      {/* Large stat tiles state n in their sub-line, so only table cells repeat it inline. */}
      {n != null && size !== 'lg' && <span className="dir-n">n = {n}</span>}
    </span>
  );
}

export function RateWithN({ rate, n }: { rate: number; n: number }) {
  return (
    <span className="dir-signed">
      <span className="tnum">{pct(rate)}</span>
      <span className="dir-n">n = {n}</span>
    </span>
  );
}

/** The stat tiles for one coach's caseload (also used for the director's own group on the coach page). */
export function summaryStatGroups(s: CoachSummary): { label: string; items: StatItem[] }[] {
  return [
    {
      label: 'Caseload & participation',
      items: [
        { key: 'dreamers', label: 'Dreamers', value: s.activeDreamers, sub: s.dreamers === 0 ? 'no dreamers assigned' : s.dreamers === s.activeDreamers ? 'all active' : `active of ${s.dreamers} in total` },
        { key: 'sessions', label: 'Sessions run (30d)', value: s.sessionsLast30d, sub: `${s.sessionsTotal} in the program · counted for the coach who ran them` },
        { key: 'participation', label: 'Participation (45d)', value: pct(s.participation45d), sub: 'of active dreamers had a session in the last 45 days' },
        { key: 'engaged', label: 'Engaged between sessions (30d)', value: plural(s.engagedBetweenSessions30d, 'dreamer'), sub: `of ${s.activeDreamers} active, with a self check-in or reflection in the last 30 days` },
      ],
    },
    {
      label: 'Caseload outcomes',
      items: [
        { key: 'achieved', label: 'Dreams achieved', value: s.dreamsAchieved, sub: 'in this caseload' },
        { key: 'dream-progress', label: 'Avg dream progress', value: pct(s.avgDreamProgress), sub: 'latest progress across all dreams' },
        { key: 'commitment', label: 'Avg commitment / satisfaction', value: <>{num(s.avgCommitment)} <span className="dir-slash">/</span> {num(s.avgSatisfaction)}</>, sub: 'latest ratings, 0–10' },
        { key: 'care-change', label: 'CARE change since first session', value: <CareChangeValue change={s.careChange} size="lg" />, sub: s.careChange ? `n = ${plural(s.careChange.n, 'dreamer')} with 2+ sessions` : 'needs dreamers with 2+ sessions' },
        { key: 'follow-through', label: 'Follow-through', value: s.followThrough ? pct(s.followThrough.rate) : '—', sub: s.followThrough ? `of ${plural(s.followThrough.n, 'action')} older than 30 days completed` : 'no actions older than 30 days yet' },
      ],
    },
  ];
}

/* ---------- Caveat + definitions ---------- */

export function ComparisonCaveat() {
  return (
    <div className="callout callout-muted dir-caveat" data-testid="director-caveat">
      <IconInfo />
      <span>Caseloads differ in size, start dates, and starting points. These figures are context for conversations with coaches, not a ranking.</span>
    </div>
  );
}

const DEFINITIONS: { term: string; def: string }[] = [
  { term: 'Sessions run', def: 'Completed coaching sessions, counted for the coach who ran them, even if the dreamer has since moved to another coach.' },
  { term: 'Caseload figures', def: 'Everything else on a coach’s row or page describes their current caseload: the dreamers assigned to them today, with each dreamer’s whole history.' },
  { term: 'Participation (45d)', def: 'Share of active dreamers who had a completed coaching session, with any coach, in the last 45 days.' },
  { term: 'Engaged between sessions (30d)', def: 'Active dreamers with at least one self check-in or reflection in the last 30 days, out of all active dreamers. Paused dreamers are left out of both participation and engagement.' },
  { term: 'CARE change', def: 'For each dreamer with two or more completed sessions that rated all four CARE areas: the latest session’s CARE average minus the first session’s. Shown as the mean, with n = dreamers counted.' },
  { term: 'Avg commitment / satisfaction', def: 'Mean of each dreamer’s most recent Commitment and Satisfaction ratings (0–10).' },
  { term: 'Avg dream progress', def: 'Mean of the latest recorded progress of every dream (0–100%). Dreams achieved counts dreams marked as achieved.' },
  { term: 'Follow-through', def: 'Among actions created more than 30 days ago, the share completed. Actions that were set aside are reconsidered priorities, not failures — they simply are not counted as completed.' },
  { term: 'Month trends', def: 'Entries are counted in the month they were recorded. The CARE and dream-progress lines average the coaching-session entries recorded that month, whoever had a session, so self check-ins never move them. A dashed line marks a month when dreamers joined: their starting values can lower that month’s average although nobody went backwards. The Avg dream progress figure uses each dream’s latest value, so it can differ from the line’s last point.' },
];

export function HowCalculated() {
  return (
    <details className="dir-details" data-testid="director-how-calculated">
      <summary>How these are calculated</summary>
      <dl className="dir-defs">
        {DEFINITIONS.map((d) => (
          <div key={d.term}>
            <dt>{d.term}</dt>
            <dd>{d.def}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/* ---------- Table wrapper ---------- */

/**
 * The horizontal scroller around a director table. When the table is wider than its card it marks
 * which edges have more columns, so the sticky first and last columns can cast a soft shadow there.
 */
export function TableScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollWidth - el.clientWidth - el.scrollLeft > 1;
      setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  return <div ref={ref} className={`table-wrap dir-table-wrap${more.start ? ' has-more-start' : ''}${more.end ? ' has-more-end' : ''}`}>{children}</div>;
}

/* ---------- Cells shared by the tables ---------- */

/** A column header with an optional small second line (unit or time window). */
export function Th({ children, sub, className = '' }: { children: ReactNode; sub?: string; className?: string }) {
  return (
    <th scope="col" className={className}>
      <span className="dir-th">{children}{sub && <span className="dir-th-sub">{sub}</span>}</span>
    </th>
  );
}

const STATUS_LABEL: Record<DreamerStatus, string> = { active: 'Active', paused: 'Paused', completed: 'Completed program' };

/** Shown only when a dreamer is not active, so paused and completed dreamers stand out. */
export function DreamerStatusChip({ status }: { status: DreamerStatus }) {
  if (status === 'active') return null;
  const cls = status === 'completed' ? 'chip-success' : status === 'paused' ? 'chip-muted' : 'chip-session';
  return <Chip className={cls} data-testid="dreamer-status">{STATUS_LABEL[status]}</Chip>;
}

export function PersonCell({ initials, name, about, status, tone }: { initials: string; name: ReactNode; about?: string | null; status?: DreamerStatus; tone?: 'gold' | 'plum' }) {
  return (
    <span className="dir-person">
      <Avatar initials={initials} tone={tone} />
      <span className="dir-person-text">
        <span className="dir-person-name">{name}{status && <DreamerStatusChip status={status} />}</span>
        {about && <span className="dir-person-about">{about}</span>}
      </span>
    </span>
  );
}
/** "Session 9 · 2 days ago" plus an "In progress" chip when one is open. `compact` drops the session number (for tables that already show the count). */
export function LastSessionCell({ snapshot, compact }: { snapshot: Snapshot; compact?: boolean }) {
  const last = snapshot.lastSession;
  const open = snapshot.openSession;
  if (!last && !open) return <span className="muted">{compact ? '—' : 'No sessions yet'}</span>;
  return (
    <span className="dir-cell-stack">
      {last && (compact
        ? <span className="dir-when" title={fmtDateTime(last.occurredAt)}>{relativeTime(last.occurredAt)}</span>
        : <span><span className="dir-strong">Session {last.number}</span> <span className="muted">· {relativeTime(last.occurredAt)}</span></span>)}
      {open && <span className="row" style={{ gap: 6 }}><Chip className="chip-warning">In progress</Chip>{!compact && <span className="muted tiny">since {fmtDate(open.occurredAt)}</span>}</span>}
    </span>
  );
}

const SELF_KIND_LABEL: Record<NonNullable<Snapshot['lastSelfActivity']>['kind'], string> = { 'check-in': 'Check-in', reflection: 'Reflection' };

/** The dreamer's newest self activity — a check-in or a reflection, named as such — plus their check-ins in the last 30 days. */
export function LastSelfCell({ snapshot }: { snapshot: Snapshot }) {
  const last = snapshot.lastSelfActivity;
  if (!last) return <span className="muted">—</span>;
  return (
    <span className="dir-cell-stack">
      <span title={fmtDateTime(last.at)}><span className="dir-strong">{SELF_KIND_LABEL[last.kind]}</span> <span className="muted">· {relativeTime(last.at)}</span></span>
      {snapshot.selfCheckIns30d > 0 && <span className="muted tiny">{plural(snapshot.selfCheckIns30d, 'check-in')} in 30 days</span>}
    </span>
  );
}

/** Average of the four latest CARE ratings plus the four values as tiny colored marks. */
export function CareCell({ careAverage, latest }: { careAverage: number | null; latest: Partial<Record<RatingCategory, LatestRating>> }) {
  const has = CARE_CATEGORIES.some((c) => latest[c] != null);
  if (!has) return <span className="muted">—</span>;
  return (
    <span className="dir-care" title="Average of the four latest CARE ratings, then Contribution · Alignment · Relationships · Energy">
      <span className="dir-care-avg tnum">{num(careAverage)}</span>
      <span className="dir-mini" aria-label={CARE_CATEGORIES.map((c) => `${CATEGORY_META[c].label} ${latest[c]?.value ?? 'not rated'}`).join(', ')}>
        {CARE_CATEGORIES.map((c) => (
          <span key={c} className="dir-mini-item tnum" aria-hidden>
            <span className="dir-mini-dot" style={{ background: CATEGORY_META[c].color }} />{latest[c]?.value ?? '–'}
          </span>
        ))}
      </span>
    </span>
  );
}

export function DreamsCell({ dreamAverage, achieved }: { dreamAverage: number | null; achieved: number }) {
  return (
    <span className="dir-dreams">
      <span className="dir-dreams-top">
        <span className="tnum dir-strong">{pct(dreamAverage)}</span>
        {achieved > 0 && <span className="dir-achieved tnum">{achieved} achieved</span>}
      </span>
      <Bar value={dreamAverage} label={`Average dream progress ${pct(dreamAverage)}`} />
    </span>
  );
}

export const achievedCount = (snapshot: Snapshot) => snapshot.dreams.filter((d) => d.achievedAt).length;
