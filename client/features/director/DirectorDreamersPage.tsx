/**
 * All dreamers (/director/dreamers): every dreamer in the program in one
 * searchable, filterable, sortable table (cards on phones). Each row opens the
 * dreamer's staff page; a row menu reassigns the coach or pauses / resumes the
 * dreamer. The server already returns only what the Director may see, so
 * nothing here filters or mentions privacy.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { DirectorDreamerRow, DreamerStatus, User } from '@shared/types';
import { useDirectorDreamers, useReassignDreamer, useStaff } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { staffDreamerPath } from '@/app/routes';
import { useToast } from '@/components/toast';
import { Avatar, Button, Card, EmptyState, Field, LoadingPage, Modal, PageHeader, TextInput } from '@/components/ui';
import { IconArrowRight, IconChevronDown, IconInfo, IconPlay, IconRefresh, IconSearch, IconUsers } from '@/components/icons';
import { firstName, plural } from '@/lib/format';
import { CareCell, CareChangeValue, DreamsCell, LastSelfCell, LastSessionCell, PersonCell, TableScroll, Th, achievedCount } from './DirectorMetrics';
import { DirectorRowMenu } from './DirectorRowMenu';

/** `lastActivity` is the dreamer's last self activity (check-in or reflection), the column it sorts. */
type SortKey = 'name' | 'lastActivity' | 'lastSession' | 'careAvg' | 'careChange' | 'dreamAvg';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | DreamerStatus;
const UNASSIGNED = 'none';

/** Every sort the table headers offer, in both directions, for the Sort by menu (the only sort control on phones). */
const SORT_OPTIONS: { key: SortKey; dir: SortDir; label: string }[] = [
  { key: 'name', dir: 'asc', label: 'Name, A–Z' },
  { key: 'name', dir: 'desc', label: 'Name, Z–A' },
  { key: 'lastSession', dir: 'desc', label: 'Last session, newest first' },
  { key: 'lastSession', dir: 'asc', label: 'Last session, oldest first' },
  { key: 'lastActivity', dir: 'desc', label: 'Self activity, newest first' },
  { key: 'lastActivity', dir: 'asc', label: 'Self activity, oldest first' },
  { key: 'careAvg', dir: 'desc', label: 'CARE average, highest first' },
  { key: 'careAvg', dir: 'asc', label: 'CARE average, lowest first' },
  { key: 'careChange', dir: 'desc', label: 'CARE change, largest first' },
  { key: 'careChange', dir: 'asc', label: 'CARE change, smallest first' },
  { key: 'dreamAvg', dir: 'desc', label: 'Dream progress, highest first' },
  { key: 'dreamAvg', dir: 'asc', label: 'Dream progress, lowest first' },
];
const sortValue = (s: { key: SortKey; dir: SortDir }) => `${s.key}:${s.dir}`;
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { all: 'All statuses', active: 'Active', paused: 'Paused', completed: 'Completed program' };
const STATUS_WORD: Record<DreamerStatus, string> = { active: 'active', paused: 'paused', completed: 'completed' };

/** Never having a session (or self activity) sorts as the longest time ago. */
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
/** Missing figures sort last in either direction, so "lowest first" starts with real values. */
const byNumber = (x: number | null | undefined, y: number | null | undefined, sign: number) =>
  x == null || y == null ? (x == null ? 1 : 0) - (y == null ? 1 : 0) : (x - y) * sign;

function sortRows(rows: DirectorDreamerRow[], key: SortKey, dir: SortDir): DirectorDreamerRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let d = 0;
    switch (key) {
      case 'name': d = a.dreamer.name.localeCompare(b.dreamer.name) * sign; break;
      case 'lastActivity': d = (time(a.snapshot.lastSelfActivity?.at) - time(b.snapshot.lastSelfActivity?.at)) * sign; break;
      case 'lastSession': d = (time(a.snapshot.lastSession?.occurredAt) - time(b.snapshot.lastSession?.occurredAt)) * sign; break;
      case 'careAvg': d = byNumber(a.careAverage, b.careAverage, sign); break;
      case 'careChange': d = byNumber(a.careChange, b.careChange, sign); break;
      case 'dreamAvg': d = byNumber(a.dreamAverage, b.dreamAverage, sign); break;
    }
    return d || a.dreamer.name.localeCompare(b.dreamer.name);
  });
}

const staffLabel = (u: User) => (u.role === 'director' ? `${u.name} · Director` : u.name);

/* ---------- Cells ---------- */

function CoachCell({ coach, avatar }: { coach: DirectorDreamerRow['dreamer']['coach']; avatar?: boolean }) {
  if (!coach) return <span className="muted">No coach assigned</span>;
  return (
    <span className="dir-coach-cell">
      {avatar && <Avatar initials={coach.initials} size="sm" tone="gold" />}
      <span>{coach.name}</span>
    </span>
  );
}

/* ---------- Row menu + reassign dialog ---------- */

/** Two bars, drawn like the kit icons (24-unit grid, 2px round strokes). */
const IconPause = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 5v14M15 5v14" />
  </svg>
);

interface RowActions {
  onOpen: (row: DirectorDreamerRow) => void;
  onReassign: (row: DirectorDreamerRow) => void;
  onToggleStatus: (row: DirectorDreamerRow) => void;
  busyId: number | null;
}

function RowMenu({ row, actions }: { row: DirectorDreamerRow; actions: RowActions }) {
  const paused = row.dreamer.status !== 'active';
  return (
    <DirectorRowMenu
      label={`More for ${row.dreamer.name}`}
      testId={`director-dreamer-menu-${row.dreamer.id}`}
      items={[
        { key: 'open', label: 'Open dreamer page', icon: <IconArrowRight />, onSelect: () => actions.onOpen(row), testId: 'director-dreamer-open' },
        { key: 'reassign', label: 'Reassign coach…', icon: <IconRefresh />, onSelect: () => actions.onReassign(row), testId: 'director-dreamer-reassign' },
        { key: 'status', label: paused ? 'Mark active' : 'Mark paused', icon: paused ? <IconPlay /> : <IconPause />, onSelect: () => actions.onToggleStatus(row), disabled: actions.busyId === row.dreamer.id, testId: 'director-dreamer-toggle-status' },
      ]}
    />
  );
}

function ReassignDialog({ row, staff, onClose }: { row: DirectorDreamerRow | null; staff: User[]; onClose: () => void }) {
  const reassign = useReassignDreamer();
  const { toast } = useToast();
  const [value, setValue] = useState<string>(UNASSIGNED);
  const [error, setError] = useState<string | null>(null);
  const current = row?.dreamer.coach?.userId ?? null;

  useEffect(() => {
    setValue(current == null ? UNASSIGNED : String(current));
    setError(null);
  }, [row?.dreamer.id, current]);

  if (!row) return null;
  const chosen = value === UNASSIGNED ? null : Number(value);
  const unchanged = chosen === current;
  const target = chosen == null ? null : staff.find((s) => s.id === chosen) ?? null;
  // An open session moves with the dreamer: the new coach continues it, and it counts for whoever completes it.
  const hint = row.snapshot.openSession && !unchanged
    ? `${firstName(row.dreamer.name)} has a session in progress. ${target ? firstName(target.name) : 'Their next coach'} can continue it, and it counts for whoever completes it.`
    : 'The dreamer’s dreams, sessions and history stay exactly as they are — only who coaches them changes.';

  const save = () => {
    setError(null);
    reassign.mutate(
      { dreamerId: row.dreamer.id, coachUserId: chosen },
      {
        onSuccess: () => {
          toast(target ? `${row.dreamer.name} is now coached by ${target.name}.` : `${row.dreamer.name} no longer has a coach assigned.`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reassign coach"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={reassign.isPending} disabled={unchanged} data-testid="director-reassign-save">Reassign</Button>
        </>
      }
    >
      <div className="stack" data-testid="director-reassign-dialog">
        <div className="dir-modal-person">
          <Avatar initials={row.dreamer.initials} />
          <span className="dir-person-text">
            <span className="dir-person-name">{row.dreamer.name}</span>
            <span className="dir-person-about">{row.dreamer.coach ? `Currently coached by ${row.dreamer.coach.name}` : 'No coach assigned'}</span>
          </span>
        </div>
        <Field label="New coach" htmlFor="dir-reassign-select" error={error} hint={hint}>
          <select id="dir-reassign-select" value={value} onChange={(e) => setValue(e.target.value)} data-testid="director-reassign-select">
            {staff.map((s) => (
              <option key={s.id} value={String(s.id)}>{staffLabel(s)}{s.id === current ? ' (current)' : ''}</option>
            ))}
            <option value={UNASSIGNED}>No coach assigned</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/* ---------- Table (laptops) ---------- */

function SortTh({ k, sort, onSort, children, className = '' }: { k: SortKey; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void; children: ReactNode; className?: string }) {
  const active = sort.key === k;
  return (
    <th scope="col" className={`sortable ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} data-testid={`director-dreamers-sort-${k}`}>
      <button type="button" className="dir-th dir-sort-btn" onClick={() => onSort(k)}>
        {children}{active && <IconChevronDown className={`dir-sort-icon${sort.dir === 'asc' ? ' is-asc' : ''}`} />}
      </button>
    </th>
  );
}

function DreamersTable({ rows, sort, onSort, actions }: { rows: DirectorDreamerRow[]; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void; actions: RowActions }) {
  const nav = useNavigate();
  return (
    <TableScroll>
      <table className="table dir-table dir-dreamers-table" data-testid="director-dreamers-table">
        <thead>
          <tr>
            <SortTh k="name" sort={sort} onSort={onSort}>Dreamer</SortTh>
            <th scope="col">Coach</th>
            <th scope="col" className="num">Sessions</th>
            <SortTh k="lastSession" sort={sort} onSort={onSort}>Last session</SortTh>
            <SortTh k="lastActivity" sort={sort} onSort={onSort}>Self activity</SortTh>
            <SortTh k="careAvg" sort={sort} onSort={onSort}>CARE</SortTh>
            <SortTh k="careChange" sort={sort} onSort={onSort} className="num">Change</SortTh>
            <SortTh k="dreamAvg" sort={sort} onSort={onSort}>Dreams</SortTh>
            <Th className="num" sub="active">Actions</Th>
            <th scope="col" className="dir-sticky-col"><span className="sr-only">More</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.dreamer.id}
              className="clickable dir-row"
              tabIndex={0}
              onClick={() => nav(staffDreamerPath(r.dreamer.id))}
              onKeyDown={(e) => { if (e.key === 'Enter') nav(staffDreamerPath(r.dreamer.id)); }}
              data-testid="director-dreamer-row"
              data-dreamer-id={r.dreamer.id}
            >
              <td><PersonCell initials={r.dreamer.initials} name={r.dreamer.name} about={r.dreamer.about} status={r.dreamer.status} /></td>
              <td><CoachCell coach={r.dreamer.coach} /></td>
              <td className="num tnum dir-num-lg">{r.sessionsCompleted}</td>
              <td><LastSessionCell snapshot={r.snapshot} compact /></td>
              <td><LastSelfCell snapshot={r.snapshot} /></td>
              <td><CareCell careAverage={r.careAverage} latest={r.snapshot.latest} /></td>
              <td className="num"><CareChangeValue change={r.careChange} /></td>
              <td className="dir-dreams-cell"><DreamsCell dreamAverage={r.dreamAverage} achieved={achievedCount(r.snapshot)} /></td>
              <td className="num tnum dir-num-lg">{r.snapshot.activeActions}</td>
              <td className="num dir-sticky-col"><RowMenu row={r} actions={actions} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

/* ---------- Cards (phones & tablets) ---------- */

function DreamersCards({ rows, actions }: { rows: DirectorDreamerRow[]; actions: RowActions }) {
  const nav = useNavigate();
  return (
    <div className="dir-cards" data-testid="director-dreamer-cards">
      {rows.map((r) => (
        <Card
          key={r.dreamer.id}
          className="dir-card"
          pad="sm"
          tabIndex={0}
          onClick={() => nav(staffDreamerPath(r.dreamer.id))}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) nav(staffDreamerPath(r.dreamer.id)); }}
          data-testid="director-dreamer-card"
          data-dreamer-id={r.dreamer.id}
        >
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow"><PersonCell initials={r.dreamer.initials} name={r.dreamer.name} about={r.dreamer.about} status={r.dreamer.status} /></div>
            <RowMenu row={r} actions={actions} />
          </div>
          <dl className="dir-card-facts">
            <div><dt>Coach</dt><dd><CoachCell coach={r.dreamer.coach} avatar /></dd></div>
            <div><dt>Sessions</dt><dd className="tnum">{plural(r.sessionsCompleted, 'completed session')}</dd></div>
            <div><dt>Last session</dt><dd><LastSessionCell snapshot={r.snapshot} /></dd></div>
            <div><dt>Last self activity</dt><dd><LastSelfCell snapshot={r.snapshot} /></dd></div>
            <div><dt>CARE</dt><dd><CareCell careAverage={r.careAverage} latest={r.snapshot.latest} /></dd></div>
            <div><dt>CARE change</dt><dd><CareChangeValue change={r.careChange} /></dd></div>
            <div><dt>Dreams</dt><dd><DreamsCell dreamAverage={r.dreamAverage} achieved={achievedCount(r.snapshot)} /></dd></div>
            <div><dt>Active actions</dt><dd className="tnum">{r.snapshot.activeActions}</dd></div>
          </dl>
          <div className="dir-card-foot">
            <span className="muted small">Tap to open</span>
            <Link to={staffDreamerPath(r.dreamer.id)} className="btn btn-secondary btn-sm" onClick={(e) => e.stopPropagation()}>Open <IconArrowRight /></Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---------- Page ---------- */

export function DirectorDreamersPage() {
  const dreamers = useDirectorDreamers();
  const staffQ = useStaff();
  const reassign = useReassignDreamer();
  const { toast } = useToast();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [reassigning, setReassigning] = useState<DirectorDreamerRow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // The coach filter lives in the URL so the coach page can link straight to a caseload.
  const coachFilter = params.get('coach') ?? 'all';
  const setCoachFilter = (v: string) => {
    const next = new URLSearchParams(params);
    if (v === 'all') next.delete('coach'); else next.set('coach', v);
    setParams(next, { replace: true });
  };

  const staff = staffQ.data ?? [];
  const all = dreamers.data ?? [];
  // Offered while someone has no coach, and kept while it is the active filter so the menu never misstates it.
  const showUnassigned = coachFilter === UNASSIGNED || all.some((r) => !r.dreamer.coach);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = all.filter((r) => {
      if (status !== 'all' && r.dreamer.status !== status) return false;
      if (coachFilter === UNASSIGNED && r.dreamer.coach) return false;
      if (coachFilter !== 'all' && coachFilter !== UNASSIGNED && String(r.dreamer.coach?.userId ?? '') !== coachFilter) return false;
      if (q && !(r.dreamer.name.toLowerCase().includes(q) || (r.dreamer.about ?? '').toLowerCase().includes(q) || (r.dreamer.coach?.name ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
    return sortRows(filtered, sort.key, sort.dir);
  }, [all, search, status, coachFilter, sort]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  const toggleStatus = (row: DirectorDreamerRow) => {
    const next: DreamerStatus = row.dreamer.status === 'active' ? 'paused' : 'active';
    setBusyId(row.dreamer.id);
    reassign.mutate(
      { dreamerId: row.dreamer.id, status: next },
      {
        onSuccess: () => toast(next === 'paused' ? `${row.dreamer.name} is paused. Their dreams and history stay put, ready for when they return.` : `${row.dreamer.name} is ${STATUS_WORD[next]} again.`),
        onError: (e) => toast(errorMessage(e), 'error'),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const actions: RowActions = { onOpen: (row) => nav(staffDreamerPath(row.dreamer.id)), onReassign: setReassigning, onToggleStatus: toggleStatus, busyId };

  const filtersActive = search.trim() !== '' || status !== 'all' || coachFilter !== 'all';
  const clearFilters = () => { setSearch(''); setStatus('all'); setCoachFilter('all'); };

  if (dreamers.isPending) return <div className="page page-wide"><LoadingPage label="Gathering every dreamer…" /></div>;
  if (dreamers.isError) {
    return (
      <div className="page page-wide dir-page">
        <PageHeader eyebrow="Dream Team" title="All dreamers" />
        <div className="callout callout-muted" role="alert">
          <IconInfo />
          <span className="grow">{errorMessage(dreamers.error)}</span>
          <Button variant="secondary" size="sm" onClick={() => void dreamers.refetch()} loading={dreamers.isFetching}>Try again</Button>
        </div>
      </div>
    );
  }

  const activeCount = all.filter((r) => r.dreamer.status === 'active').length;
  const countLabel = rows.length === all.length ? plural(all.length, 'dreamer') : `${rows.length} of ${plural(all.length, 'dreamer')}`;

  return (
    <div className="page page-wide dir-page" data-testid="director-dreamers">
      <PageHeader
        eyebrow="Dream Team"
        title="All dreamers"
        lead={all.length ? `${plural(all.length, 'dreamer')} in the program, ${activeCount} active. Open anyone to see their dreams, sessions and history.` : 'Dreamers appear here as they join the program.'}
        actions={<Link to="/director" className="btn btn-secondary" data-testid="director-dreamers-back">Team overview</Link>}
      />

      {all.length === 0 ? (
        <Card><EmptyState icon={<IconUsers />} title="No dreamers yet">When dreamers join the program they appear here with their coach, sessions and progress.</EmptyState></Card>
      ) : (
        <>
          <div className="dir-toolbar" role="search">
            <label className="dir-search">
              <IconSearch />
              <TextInput type="search" placeholder="Search by name, role or coach" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search dreamers" data-testid="director-dreamers-search" />
            </label>
            <label className="dir-filter">
              <span>Coach</span>
              <select value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)} aria-label="Filter by coach" data-testid="director-dreamers-coach-filter">
                <option value="all">All coaches</option>
                {staff.map((s) => <option key={s.id} value={String(s.id)}>{staffLabel(s)}</option>)}
                {showUnassigned && <option value={UNASSIGNED}>No coach assigned</option>}
              </select>
            </label>
            <label className="dir-filter">
              <span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter by status" data-testid="director-dreamers-status-filter">
                {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((k) => <option key={k} value={k}>{STATUS_FILTER_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="dir-filter dir-filter-sort">
              <span>Sort by</span>
              <select value={sortValue(sort)} onChange={(e) => { const o = SORT_OPTIONS.find((x) => sortValue(x) === e.target.value); if (o) setSort({ key: o.key, dir: o.dir }); }} aria-label="Sort dreamers" data-testid="director-dreamers-sort">
                {SORT_OPTIONS.map((o) => <option key={sortValue(o)} value={sortValue(o)}>{o.label}</option>)}
              </select>
            </label>
            <span className="dir-toolbar-count" aria-live="polite" data-testid="director-dreamers-count">{countLabel}</span>
          </div>

          <Card pad={false} className="dir-table-card">
            {rows.length === 0 ? (
              <EmptyState icon={<IconSearch />} title="No dreamers match" action={filtersActive ? <Button variant="secondary" onClick={clearFilters} data-testid="director-dreamers-clear">Clear filters</Button> : undefined}>
                Try a different name, or widen the coach and status filters.
              </EmptyState>
            ) : (
              <>
                <DreamersTable rows={rows} sort={sort} onSort={onSort} actions={actions} />
                <DreamersCards rows={rows} actions={actions} />
              </>
            )}
          </Card>
        </>
      )}

      <ReassignDialog row={reassigning} staff={staff} onClose={() => setReassigning(null)} />
    </div>
  );
}
