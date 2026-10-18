/**
 * Coach dashboard (/coach): the signed-in coach's caseload at a glance. The
 * director sees the dreamers they coach directly here too.
 *
 * Engagement is phrased as facts (dates, counts) — never as judgments. The server
 * already returns only what staff may see, so nothing here filters or mentions
 * privacy.
 */
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { CARE_CATEGORIES, CATEGORY_META } from '@shared/care';
import type { CaseloadEntry, DreamerStatus } from '@shared/types';
import { useCoachDashboard, useStartSession } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { sessionPath, staffDreamerPath } from '@/app/routes';
import { useToast } from '@/components/toast';
import { Avatar, Bar, Button, Card, CardHead, Chip, EmptyState, LoadingPage, PageHeader, Stat } from '@/components/ui';
import { IconArrowRight, IconChevronDown, IconInfo, IconPlay, IconUsers } from '@/components/icons';
import { fmtDate, fmtDateTime, num, pct, plural, relativeTime } from '@/lib/format';

type SortKey = 'name' | 'lastSession' | 'lastActivity';
type SortDir = 'asc' | 'desc';

const SORT_LABEL: Record<SortKey, string> = { name: 'Name', lastSession: 'Last session', lastActivity: 'Last self activity' };
const STATUS_LABEL: Record<DreamerStatus, string | null> = { active: null, paused: 'Paused', completed: 'Completed program' };

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

function sortCaseload(list: CaseloadEntry[], key: SortKey, dir: SortDir): CaseloadEntry[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let d = 0;
    if (key === 'name') d = a.dreamer.name.localeCompare(b.dreamer.name);
    else if (key === 'lastSession') d = time(a.snapshot.lastSession?.occurredAt) - time(b.snapshot.lastSession?.occurredAt);
    else d = time(a.snapshot.lastSelfActivity?.at) - time(b.snapshot.lastSelfActivity?.at);
    return d * sign || a.dreamer.name.localeCompare(b.dreamer.name);
  });
}

/* ---------- Small cell renderers shared by the table and the cards ---------- */

export function StatusChip({ status }: { status: DreamerStatus }) {
  const label = STATUS_LABEL[status];
  if (!label) return null;
  return <Chip className={status === 'completed' ? 'chip-success' : 'chip-muted'} data-testid="dreamer-status">{label}</Chip>;
}

function LastSessionCell({ entry }: { entry: CaseloadEntry }) {
  const last = entry.snapshot.lastSession;
  const open = entry.snapshot.openSession;
  if (!last && !open) return <span className="muted">No sessions yet</span>;
  return (
    <span className="cv-cell-stack">
      {last && (
        <span>
          <span className="cv-strong">Session {last.number}</span> <span className="muted">· {relativeTime(last.occurredAt)}</span>
        </span>
      )}
      {open && <span className="cv-open-note"><Chip className="chip-warning">In progress</Chip><span className="muted tiny">since {fmtDate(open.occurredAt)}</span></span>}
    </span>
  );
}

function LastSelfCell({ entry }: { entry: CaseloadEntry }) {
  const last = entry.snapshot.lastSelfActivity;
  if (!last) return <span className="muted">—</span>;
  return (
    <span className="cv-cell-stack">
      <span title={fmtDateTime(last.at)}><span className="cv-strong">{last.kind === 'reflection' ? 'Reflection' : 'Check-in'}</span> <span className="muted">· {relativeTime(last.at)}</span></span>
      {entry.snapshot.selfCheckIns30d > 0 && <span className="muted tiny">{plural(entry.snapshot.selfCheckIns30d, 'check-in')} in 30 days</span>}
    </span>
  );
}

function CareCell({ entry }: { entry: CaseloadEntry }) {
  const latest = entry.snapshot.latest;
  const has = CARE_CATEGORIES.some((c) => latest[c] != null);
  if (!has) return <span className="muted">—</span>;
  return (
    <span className="cv-care" title="Average of the four latest CARE ratings, then Contribution · Alignment · Relationships · Energy">
      <span className="cv-care-avg tnum">{num(entry.careAverage)}</span>
      <span className="cv-care-mini" aria-label={CARE_CATEGORIES.map((c) => `${CATEGORY_META[c].label} ${latest[c]?.value ?? 'not rated'}`).join(', ')}>
        {CARE_CATEGORIES.map((c) => (
          <span key={c} className="tnum" style={{ color: CATEGORY_META[c].color }} aria-hidden>
            <span className="cv-care-mini-key">{CATEGORY_META[c].short}</span>{latest[c]?.value ?? '–'}
          </span>
        ))}
      </span>
    </span>
  );
}

function DreamsCell({ entry }: { entry: CaseloadEntry }) {
  const achieved = entry.snapshot.dreams.filter((d) => d.achievedAt).length;
  return (
    <span className="cv-dreams">
      <span className="cv-dreams-top">
        <span className="tnum cv-strong">{pct(entry.dreamAverage)}</span>
        {achieved > 0 && <span className="cv-achieved tnum">{achieved} achieved</span>}
      </span>
      <Bar value={entry.dreamAverage} label={`Average dream progress ${pct(entry.dreamAverage)}`} />
    </span>
  );
}

/** Open / Start session / Continue session. One instance per dreamer so each has its own mutation. */
function RowActions({ entry, size = 'sm' }: { entry: CaseloadEntry; size?: 'sm' | 'md' }) {
  const nav = useNavigate();
  const { toast } = useToast();
  const id = entry.dreamer.id;
  const start = useStartSession(id);
  const open = entry.snapshot.openSession;
  const stop = (e: MouseEvent) => e.stopPropagation();
  const onStart = (e: MouseEvent) => {
    e.stopPropagation();
    start.mutate(undefined, {
      onSuccess: (s) => { toast(`Session ${s.number} started.`); nav(sessionPath(id, s.id)); },
      onError: (err) => toast(errorMessage(err), 'error'),
    });
  };
  return (
    <span className="cv-row-actions" onClick={stop}>
      <Link to={staffDreamerPath(id)} className={size === 'sm' ? 'cv-open-link' : 'btn btn-secondary'} onClick={stop} data-testid="caseload-open">Open</Link>
      {open ? (
        <Link to={sessionPath(id, open.id)} className={`btn btn-primary${size === 'sm' ? ' btn-sm' : ''}`} onClick={stop} data-testid="caseload-continue-session"><IconPlay /> Continue session</Link>
      ) : (
        <Button variant="primary" size={size} onClick={onStart} loading={start.isPending} data-testid="caseload-start-session"><IconPlay /> Start session</Button>
      )}
    </span>
  );
}

/* ---------- Table (laptops) ---------- */

function SortHeader({ k, sort, onSort, children, className = '' }: { k: SortKey; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void; children: ReactNode; className?: string }) {
  const active = sort.key === k;
  return (
    <th scope="col" className={`sortable ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => onSort(k)} data-testid={`caseload-sort-${k}`}>
      <span className="cv-th">{children}{active && <IconChevronDown className={`cv-sort-icon${sort.dir === 'asc' ? ' is-asc' : ''}`} />}</span>
    </th>
  );
}

function CaseloadTable({ rows, sort, onSort }: { rows: CaseloadEntry[]; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void }) {
  const nav = useNavigate();
  return (
    <div className="table-wrap cv-table-wrap">
      <table className="table cv-table" data-testid="caseload-table">
        <thead>
          <tr>
            <SortHeader k="name" sort={sort} onSort={onSort}>Dreamer</SortHeader>
            <SortHeader k="lastSession" sort={sort} onSort={onSort}>Last session</SortHeader>
            <SortHeader k="lastActivity" sort={sort} onSort={onSort}>Last self activity</SortHeader>
            <th scope="col">CARE</th>
            <th scope="col">Dreams</th>
            <th scope="col" className="num cv-th-wrap">Active actions</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr
              key={e.dreamer.id}
              className="clickable cv-row"
              onClick={() => nav(staffDreamerPath(e.dreamer.id))}
              onKeyDown={(ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) nav(staffDreamerPath(e.dreamer.id)); }}
              tabIndex={0}
              data-testid="caseload-row"
              data-dreamer-id={e.dreamer.id}
            >
              <td>
                <span className="cv-person">
                  <Avatar initials={e.dreamer.initials} />
                  <span className="cv-person-text">
                    <span className="cv-person-name">{e.dreamer.name} <StatusChip status={e.dreamer.status} /></span>
                    {e.dreamer.about && <span className="cv-person-about">{e.dreamer.about}</span>}
                  </span>
                </span>
              </td>
              <td><LastSessionCell entry={e} /></td>
              <td><LastSelfCell entry={e} /></td>
              <td><CareCell entry={e} /></td>
              <td className="cv-dreams-cell"><DreamsCell entry={e} /></td>
              <td className="num cv-actions-num">{e.snapshot.activeActions}</td>
              <td className="cv-actions-cell"><RowActions entry={e} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Cards (phones) ---------- */

function CaseloadCards({ rows }: { rows: CaseloadEntry[] }) {
  const nav = useNavigate();
  return (
    <div className="cv-cards" data-testid="caseload-cards">
      {rows.map((e) => (
        <Card key={e.dreamer.id} className="cv-card" pad="sm" data-testid="caseload-card" data-dreamer-id={e.dreamer.id} onClick={() => nav(staffDreamerPath(e.dreamer.id))}>
          <div className="cv-person">
            <Avatar initials={e.dreamer.initials} />
            <span className="cv-person-text grow">
              <span className="cv-person-name">{e.dreamer.name} <StatusChip status={e.dreamer.status} /></span>
              {e.dreamer.about && <span className="cv-person-about">{e.dreamer.about}</span>}
            </span>
            <IconArrowRight className="cv-card-arrow" />
          </div>
          <dl className="cv-card-facts">
            <div><dt>Last session</dt><dd><LastSessionCell entry={e} /></dd></div>
            <div><dt>Last self activity</dt><dd><LastSelfCell entry={e} /></dd></div>
            <div><dt>CARE</dt><dd><CareCell entry={e} /></dd></div>
            <div><dt>Dreams</dt><dd><DreamsCell entry={e} /></dd></div>
            <div><dt>Active actions</dt><dd className="tnum">{e.snapshot.activeActions}</dd></div>
          </dl>
          <div className="cv-card-foot"><RowActions entry={e} size="md" /></div>
        </Card>
      ))}
    </div>
  );
}

/* ---------- Page ---------- */

export function CoachDashboardPage() {
  const { auth } = useAuth();
  const dash = useCoachDashboard();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const isDirector = auth?.user.role === 'director';

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  const rows = useMemo(() => (dash.data ? sortCaseload(dash.data.caseload, sort.key, sort.dir) : []), [dash.data, sort]);

  if (dash.isPending) return <div className="page page-wide"><LoadingPage label="Loading your dreamers…" /></div>;
  if (dash.isError) {
    return (
      <div className="page page-wide">
        <PageHeader eyebrow="Dream Coach" title="My dreamers" />
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(dash.error)}</span></div>
      </div>
    );
  }

  const { stats, caseload } = dash.data;
  const lead = isDirector
    ? 'The dreamers you coach directly — where each one is, and where to pick up.'
    : 'Where each dreamer is right now, and where to pick up next.';

  return (
    <div className="page page-wide cv-dash">
      <PageHeader eyebrow="Dream Coach" title="My dreamers" lead={lead} />

      <div className="stat-row cv-stats" data-testid="coach-stats">
        <Stat label="Dreamers" value={stats.dreamers} sub={caseload.filter((c) => c.dreamer.status === 'active').length === stats.dreamers ? 'all active' : `${caseload.filter((c) => c.dreamer.status === 'active').length} active`} />
        <Stat label="Sessions this month" value={stats.sessionsThisMonth} sub={`${stats.sessionsLast30d} in the last 30 days`} />
        <Stat label="Seen in the last 45 days" value={`${stats.dreamersSeenLast45d} of ${stats.activeDreamers}`} sub="completed a session" />
        <Stat label="Self check-ins" value={stats.selfCheckInsLast30d} sub="last 30 days, across your dreamers" />
        <Stat label="Sessions in progress" value={stats.openSessions} sub={stats.openSessions === 0 ? 'nothing left open' : 'ready to continue'} />
      </div>

      <Card className="cv-caseload">
        <CardHead
          title="Caseload"
          sub={caseload.length ? `${plural(caseload.length, 'dreamer')} · open a dreamer to see their dreams, sessions and history` : undefined}
          actions={caseload.length > 1 ? (
            <label className="cv-sort">
              <span className="muted small">Sort by</span>
              <select value={sort.key} onChange={(e) => setSort({ key: e.target.value as SortKey, dir: e.target.value === 'name' ? 'asc' : 'desc' })} aria-label="Sort caseload" data-testid="caseload-sort-select">
                {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
              </select>
            </label>
          ) : undefined}
        />
        {caseload.length === 0 ? (
          <EmptyState icon={<IconUsers />} title="No dreamers yet" >
            When the Director assigns dreamers to you, they will appear here with their dreams, sessions and recent activity.
          </EmptyState>
        ) : (
          <>
            <CaseloadTable rows={rows} sort={sort} onSort={onSort} />
            <CaseloadCards rows={rows} />
          </>
        )}
      </Card>
    </div>
  );
}
