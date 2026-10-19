/**
 * All dreamers (/director/dreamers): every dreamer in the program in one
 * searchable, filterable, sortable table (cards on phones). Each row opens the
 * dreamer's staff page; a row menu reassigns the coach or pauses / resumes the
 * dreamer. The server already returns only what the Director may see, so
 * nothing here filters or mentions privacy.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useNavigationType, useSearchParams } from 'react-router';
import type { DirectorDreamerRow, DreamerStatus, User } from '@shared/types';
import { useDirectorDreamers, useReassignDreamer, useStaff } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { staffDreamerPath } from '@/app/routes';
import { useToast } from '@/components/toast';
import { Avatar, Button, Card, EmptyState, Field, LoadingPage, Modal, PageHeader, TextInput } from '@/components/ui';
import { IconArrowRight, IconChevronDown, IconInfo, IconPlay, IconRefresh, IconSearch, IconUsers } from '@/components/icons';
import { firstName, plural } from '@/lib/format';
import { useTouch } from '@/features/dreamer/CareShared';
import { CareCell, CareChangeValue, ComparisonCaveat, DreamsCell, HowCalculated, LastSelfCell, LastSessionCell, PersonCell, TableScroll, Th, achievedCount, type Definition } from './DirectorMetrics';
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
const DEFAULT_SORT = SORT_OPTIONS[0]!;
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { all: 'All statuses', active: 'Active', paused: 'Paused', completed: 'Completed program' };
const STATUS_FILTERS = Object.keys(STATUS_FILTER_LABEL) as StatusFilter[];
const STATUS_WORD: Record<DreamerStatus, string> = { active: 'active', paused: 'paused', completed: 'completed' };

/* ---------- The list's view, kept in the URL ---------- */

const LIST_PATH = '/director/dreamers';

/** Search, filters and sort. In the URL, so Back from a dreamer (or a coach's caseload link) opens this list as it was. */
interface ListView { q: string; coach: string; status: StatusFilter; sort: { key: SortKey; dir: SortDir } }

/** A value the menus don't offer reads as the default. */
function readView(p: URLSearchParams): ListView {
  return {
    q: p.get('q') ?? '',
    coach: p.get('coach') || 'all',
    status: STATUS_FILTERS.find((k) => k === p.get('status')) ?? 'all',
    sort: SORT_OPTIONS.find((o) => sortValue(o) === p.get('sort')) ?? DEFAULT_SORT,
  };
}

/** Defaults are left out, so the unfiltered list keeps a bare URL. */
function writeView(v: ListView): URLSearchParams {
  const p = new URLSearchParams();
  if (v.q) p.set('q', v.q);
  if (v.coach !== 'all') p.set('coach', v.coach);
  if (v.status !== 'all') p.set('status', v.status);
  if (sortValue(v.sort) !== sortValue(DEFAULT_SORT)) p.set('sort', sortValue(v.sort));
  return p;
}

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

/** What each column of this table means, for the "How these are calculated" block under it. */
const DREAMER_DEFINITIONS: Definition[] = [
  { term: 'Sessions', def: 'Completed coaching sessions, with any coach.' },
  { term: 'Self activity', def: 'The dreamer’s most recent self check-in or reflection, named as such, and how many check-ins they made in the last 30 days.' },
  { term: 'CARE', def: 'The average of the dreamer’s latest Contribution, Alignment, Relationships and Energy ratings, followed by the four ratings.' },
  { term: 'CARE change', def: 'The latest session’s CARE average minus the first session’s, counting only completed sessions that rated all four CARE areas. Shown once a dreamer has two such sessions.' },
  { term: 'Dreams', def: 'The average of the latest progress on the dreamer’s four dreams (0–100%), and how many they have achieved.' },
  { term: 'Active actions', def: 'Actions the dreamer is working on now.' },
];

/** Handed to the dreamer page so its "All dreamers" link returns to this list as it was filtered and sorted. */
export interface DreamerListState { backTo: string }

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
  /** Location state for links to a dreamer (see DreamerListState). */
  openState: DreamerListState;
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

function SortTh({ k, sort, onSort, children, sub, className = '' }: { k: SortKey; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void; children: ReactNode; sub?: string; className?: string }) {
  const active = sort.key === k;
  return (
    <th scope="col" className={`sortable ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} data-testid={`director-dreamers-sort-${k}`}>
      <button type="button" className="dir-th dir-sort-btn" onClick={() => onSort(k)}>
        <span className="dir-th-label">{children}{sub && <span className="dir-th-sub">{sub}</span>}</span>
        {active && <IconChevronDown className={`dir-sort-icon${sort.dir === 'asc' ? ' is-asc' : ''}`} />}
      </button>
    </th>
  );
}

function DreamersTable({ rows, sort, onSort, actions }: { rows: DirectorDreamerRow[]; sort: { key: SortKey; dir: SortDir }; onSort: (k: SortKey) => void; actions: RowActions }) {
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
            <SortTh k="careChange" sort={sort} onSort={onSort} sub="first → latest session" className="num">Change</SortTh>
            <SortTh k="dreamAvg" sort={sort} onSort={onSort} sub="avg progress">Dreams</SortTh>
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
              onClick={() => actions.onOpen(r)}
              onKeyDown={(e) => { if (e.key === 'Enter') actions.onOpen(r); }}
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
  const touch = useTouch();
  return (
    <div className="dir-cards" data-testid="director-dreamer-cards">
      {rows.map((r) => (
        <Card
          key={r.dreamer.id}
          className="dir-card"
          pad="sm"
          tabIndex={0}
          onClick={() => actions.onOpen(r)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) actions.onOpen(r); }}
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
            <span className="muted small">{touch ? 'Tap' : 'Click'} to open</span>
            <Link to={staffDreamerPath(r.dreamer.id)} state={actions.openState} className="btn btn-secondary btn-sm" onClick={(e) => e.stopPropagation()}>Open <IconArrowRight /></Link>
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
  const navType = useNavigationType();
  const [params, setParams] = useSearchParams();

  const [reassigning, setReassigning] = useState<DirectorDreamerRow | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const staff = staffQ.data ?? [];
  const all = dreamers.data ?? [];

  // The list answers at once from its own state and mirrors it into the URL (replacing the entry, so typing
  // adds no history). The URL drives the list only when it changes from outside: a link (the nav, a coach's
  // caseload), Back or Forward — never on the list's own writes, which render later as a transition.
  const [view, setView] = useState(() => readView(params));
  const urlSearch = params.toString();
  useEffect(() => {
    if (navType !== 'REPLACE') setView(readView(new URLSearchParams(urlSearch)));
  }, [urlSearch, navType]);
  const update = (changes: Partial<ListView>) => {
    const next = { ...view, ...changes };
    setView(next);
    setParams(writeView(next), { replace: true });
  };
  const { q: search, status, sort } = view;

  // A coach value that names no coach (an old or hand-edited link) is dropped, so the menu always shows the filter in use.
  const staleCoach = view.coach !== 'all' && view.coach !== UNASSIGNED && staffQ.isSuccess && !staff.some((s) => String(s.id) === view.coach);
  const coachFilter = staleCoach ? 'all' : view.coach;
  useEffect(() => {
    if (!staleCoach) return;
    setView((v) => ({ ...v, coach: 'all' }));
    setParams((p) => { const next = new URLSearchParams(p); next.delete('coach'); return next; }, { replace: true });
  }, [staleCoach, setParams]);

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

  const onSort = (key: SortKey) => update({ sort: sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' } });

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

  const listSearch = writeView({ ...view, coach: coachFilter }).toString();
  const openState: DreamerListState = { backTo: `${LIST_PATH}${listSearch ? `?${listSearch}` : ''}` };
  const actions: RowActions = { onOpen: (row) => nav(staffDreamerPath(row.dreamer.id), { state: openState }), openState, onReassign: setReassigning, onToggleStatus: toggleStatus, busyId };

  const filtersActive = search.trim() !== '' || status !== 'all' || coachFilter !== 'all';
  const clearFilters = () => update({ q: '', status: 'all', coach: 'all' });
  // An empty list says why: the chosen coach (or "No coach assigned") has nobody right now, or the search and filters match no one.
  const coachIsEmpty = coachFilter !== 'all' && !all.some((r) => (coachFilter === UNASSIGNED ? !r.dreamer.coach : String(r.dreamer.coach?.userId ?? '') === coachFilter));
  const filteredCoach = staff.find((s) => String(s.id) === coachFilter);
  const emptyTitle = !coachIsEmpty ? 'No dreamers match' : coachFilter === UNASSIGNED ? 'Every dreamer has a coach' : `${filteredCoach ? firstName(filteredCoach.name) : 'This coach'} has no dreamers assigned`;
  const emptyText = !coachIsEmpty
    ? search.trim() ? 'Try a different name, or widen the coach and status filters.' : 'Try widening the coach and status filters.'
    : coachFilter === UNASSIGNED ? 'Clear the filters to see everyone.' : 'To assign one, clear the filters and choose “Reassign coach” in a dreamer’s row menu.';

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
              <TextInput type="search" placeholder="Search by name, role or coach" value={search} onChange={(e) => update({ q: e.target.value })} aria-label="Search dreamers" data-testid="director-dreamers-search" />
            </label>
            <label className="dir-filter">
              <span>Coach</span>
              <select value={coachFilter} onChange={(e) => update({ coach: e.target.value })} aria-label="Filter by coach" data-testid="director-dreamers-coach-filter">
                <option value="all">All coaches</option>
                {staff.map((s) => <option key={s.id} value={String(s.id)}>{staffLabel(s)}</option>)}
                {showUnassigned && <option value={UNASSIGNED}>No coach assigned</option>}
              </select>
            </label>
            <label className="dir-filter">
              <span>Status</span>
              <select value={status} onChange={(e) => update({ status: e.target.value as StatusFilter })} aria-label="Filter by status" data-testid="director-dreamers-status-filter">
                {STATUS_FILTERS.map((k) => <option key={k} value={k}>{STATUS_FILTER_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="dir-filter dir-filter-sort">
              <span>Sort by</span>
              <select value={sortValue(sort)} onChange={(e) => { const o = SORT_OPTIONS.find((x) => sortValue(x) === e.target.value); if (o) update({ sort: o }); }} aria-label="Sort dreamers" data-testid="director-dreamers-sort">
                {SORT_OPTIONS.map((o) => <option key={sortValue(o)} value={sortValue(o)}>{o.label}</option>)}
              </select>
            </label>
            <span className="dir-toolbar-count" aria-live="polite" data-testid="director-dreamers-count">{countLabel}</span>
          </div>

          <Card pad={false} className="dir-table-card">
            {rows.length === 0 ? (
              <EmptyState icon={coachIsEmpty ? <IconUsers /> : <IconSearch />} title={emptyTitle} action={filtersActive ? <Button variant="secondary" onClick={clearFilters} data-testid="director-dreamers-clear">Clear filters</Button> : undefined}>
                {emptyText}
              </EmptyState>
            ) : (
              <>
                <DreamersTable rows={rows} sort={sort} onSort={onSort} actions={actions} />
                <DreamersCards rows={rows} actions={actions} />
              </>
            )}
            <div className="dir-table-foot">
              <ComparisonCaveat>Dreamers joined at different times and started from different places. These figures are context for conversations, not a ranking.</ComparisonCaveat>
              <HowCalculated definitions={DREAMER_DEFINITIONS} />
            </div>
          </Card>
        </>
      )}

      <ReassignDialog row={reassigning} staff={staff} onClose={() => setReassigning(null)} />
    </div>
  );
}
