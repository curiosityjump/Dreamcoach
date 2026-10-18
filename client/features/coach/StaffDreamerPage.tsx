/**
 * Staff view of one dreamer (/dreamers/:dreamerId[/:tab]) for coaches and the
 * director. Tabs: Overview · Sessions · Actions · History · Reflections.
 *
 * The server returns only what the viewer may see, so nothing here filters or
 * mentions privacy. Coaching-session entries and self check-ins are always told
 * apart (SourceChip, solid vs hollow chart markers, the session grid holds only
 * session values).
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CARE_CATEGORIES, CATEGORY_META, RATING_CATEGORIES, type CareCategory, type RatingCategory } from '@shared/care';
import type { ActionItem, CoachingSession, Dream, DreamerOverview, JournalEntry, ProgressEntry, RatingEntry, Snapshot } from '@shared/types';
import { useActions, useCategoryHistory, useDreamHistory, useGrid, useJournal, useOverview, useSessions, useStartSession } from '@/api/hooks';
import { ApiRequestError, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { sessionPath, staffDreamerPath } from '@/app/routes';
import { useToast } from '@/components/toast';
import { Avatar, Bar, Button, Card, CardHead, Chip, Delta, EmptyState, LoadingPage, Segmented, Skeleton, SourceChip } from '@/components/ui';
import { WheelOfLife, type WheelValues } from '@/components/WheelOfLife';
import { SourceLegend, TrendChart, type TrendPoint } from '@/components/charts';
import { ActionList } from '@/features/shared/ActionItems';
import { JournalEntryCard, TimelineFeed } from '@/features/shared/Timeline';
import { SessionGridView } from '@/features/coach/SessionGridView';
import { StatusChip } from '@/features/coach/CoachDashboardPage';
import { IconArrowLeft, IconCheck, IconCompass, IconEdit, IconInfo, IconMessage, IconPen, IconPlay, IconStar, IconUsers, IconWheel } from '@/components/icons';
import { dayHeading, dayKey, fmtDate, fmtDateTime, plural, relativeTime } from '@/lib/format';
import { sessionBaseline } from '@/lib/sessionDelta';

const TABS = ['overview', 'sessions', 'actions', 'history', 'reflections'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', sessions: 'Sessions', actions: 'Actions', history: 'History', reflections: 'Reflections' };

const is404 = (e: unknown) => e instanceof ApiRequestError && e.status === 404;
const bySlot = (dreams: Dream[]) => [...dreams].sort((a, b) => a.slot - b.slot);
const newestFirst = <T extends { occurredAt: string }>(list: T[]) => [...list].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
const catStyle = (c: RatingCategory) => ({ '--cv-color': CATEGORY_META[c].color, '--cv-tint': CATEGORY_META[c].tint } as CSSProperties);
const firstLine = (s: string) => s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/** Date-only strings ("2026-02-03") are read as local dates so they never shift a day. */
function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ErrorCallout({ error }: { error: unknown }) {
  return <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(error)}</span></div>;
}

/* ======================================================================
   Start / Continue session
   ====================================================================== */

function SessionButton({ id, snapshot, label, size, testId }: { id: number; snapshot: Snapshot; label?: string; size?: 'sm' | 'md' | 'lg'; testId?: string }) {
  const nav = useNavigate();
  const { toast } = useToast();
  const start = useStartSession(id);
  const open = snapshot.openSession;
  if (open) {
    return (
      <Link to={sessionPath(id, open.id)} className={`btn btn-primary${size === 'sm' ? ' btn-sm' : size === 'lg' ? ' btn-lg' : ''}`} data-testid={testId ?? 'staff-continue-session'}>
        <IconPlay /> Continue session
      </Link>
    );
  }
  const onStart = () =>
    start.mutate(undefined, {
      onSuccess: (s) => { toast(`Session ${s.number} started.`); nav(sessionPath(id, s.id)); },
      onError: (e) => toast(errorMessage(e), 'error'),
    });
  return (
    <Button variant="primary" size={size} onClick={onStart} loading={start.isPending} data-testid={testId ?? 'staff-start-session'}>
      <IconPlay /> {label ?? 'Start session'}
    </Button>
  );
}

/* ======================================================================
   Overview
   ====================================================================== */

function sessionWheel(s: CoachingSession | undefined): WheelValues | null {
  if (!s) return null;
  const v: WheelValues = {};
  for (const c of CARE_CATEGORIES) v[c] = s.ratings[c] ?? null;
  return CARE_CATEGORIES.some((c) => v[c] != null) ? v : null;
}

function BaselineDelta({ value, base, suffix = '' }: { value: number; base: { value: number; label: string } | null; suffix?: string }) {
  if (!base) return null;
  return (
    <span className="cv-delta-ref" data-testid="overview-delta">
      <Delta value={value - base.value} digits={0} suffix={suffix} />
      <span className="muted tiny">{base.label}</span>
    </span>
  );
}

function OverviewTab({ id, overview }: { id: number; overview: DreamerOverview }) {
  const { snapshot, recentActivity } = overview;
  const sessions = useSessions(id);
  const allSessions = sessions.data ?? [];
  const completed = useMemo(() => (sessions.data ?? []).filter((s) => s.status === 'completed'), [sessions.data]);
  const latest = completed[completed.length - 1];
  const previous = completed[completed.length - 2];

  // The wheel shows the latest completed session against the one before; a dreamer
  // with no sessions yet falls back to their latest ratings (any source).
  const latestWheel = sessionWheel(latest);
  const fallback: WheelValues = {};
  for (const c of CARE_CATEGORIES) fallback[c] = snapshot.latest[c]?.value ?? null;
  const wheelValues = latestWheel ?? (CARE_CATEGORIES.some((c) => fallback[c] != null) ? fallback : null);
  const compare = latestWheel ? sessionWheel(previous) : null;
  const dreams = bySlot(snapshot.dreams);

  return (
    <div className="stack cv-stack">
      <section aria-label="Dreams">
        <div className="grid grid-4 cv-dream-grid" data-testid="overview-dreams">
          {dreams.map((d) => (
            <Card key={d.id} pad="sm" className={`cv-dream${d.achievedAt ? ' is-achieved' : ''}`} data-testid="overview-dream-card" data-dream-id={d.id}>
              <div className="cv-eyebrow">{d.slotLabel}</div>
              <h3 className="cv-dream-title">{d.title}</h3>
              <div className="cv-dream-progress">
                <span className="cv-dream-pct tnum">{d.progress == null ? '—' : `${d.progress}%`}</span>
                {d.progress != null && d.progressAt != null && (
                  <BaselineDelta
                    value={d.progress}
                    suffix=" pts"
                    base={sessionBaseline(allSessions, d.progressAt, allSessions.some((s) => s.occurredAt === d.progressAt && s.progress[d.id] === d.progress), (s) => s.progress[d.id])}
                  />
                )}
              </div>
              <Bar value={d.progress} large label={`${d.title}: ${d.progress ?? 0}% progress`} />
              <div className="cv-dream-foot">
                {d.achievedAt ? (
                  <Chip className="chip-success" data-testid="overview-dream-achieved"><IconCheck /> Achieved {fmtDate(d.achievedAt)}</Chip>
                ) : (
                  <span className="muted small">{d.progressAt ? `Updated ${relativeTime(d.progressAt)}` : 'No progress recorded yet'}</span>
                )}
                <span className="muted small tnum">{plural(d.activeActions, 'active action')}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <div className="cv-two">
        <Card>
          <CardHead
            title="CARE wheel"
            sub={latest ? `Session ${latest.number} · ${fmtDate(latest.occurredAt)}${compare && previous ? ` — dashed outline: session ${previous.number}` : ''}` : 'Latest ratings from any source'}
          />
          {sessions.isPending ? (
            <Skeleton h={300} />
          ) : wheelValues ? (
            <div className="cv-wheel" data-testid="overview-wheel">
              <WheelOfLife
                values={wheelValues}
                compare={compare}
                size={300}
                valueLabel={latest ? `Session ${latest.number} · ${fmtDate(latest.occurredAt)}` : 'Latest'}
                compareLabel={compare && previous ? `Session ${previous.number} · ${fmtDate(previous.occurredAt)}` : undefined}
              />
            </div>
          ) : (
            <EmptyState icon={<IconWheel />} title="No CARE ratings yet">The wheel fills in after the first session or self check-in.</EmptyState>
          )}
        </Card>

        <Card className="cv-ratings-card">
          <CardHead title="Latest ratings" sub="The most recent value for each area, whichever way it was recorded. Changes are measured against a coaching session." />
          <ul className="cv-ratings" data-testid="overview-latest-ratings">
            {RATING_CATEGORIES.map((c) => {
              const r = snapshot.latest[c];
              const m = CATEGORY_META[c];
              return (
                <li key={c} className="cv-rating" style={catStyle(c)} data-testid="overview-latest-rating" data-category={c}>
                  <span className="cv-rating-label"><span className="cv-dot" />{m.label}</span>
                  {r ? (
                    <>
                      <span className="cv-val tnum">{r.value}</span>
                      <span className="cv-rating-delta"><BaselineDelta value={r.value} base={sessionBaseline(allSessions, r.occurredAt, r.source === 'session', (s) => s.ratings[c])} /></span>
                      <SourceChip source={r.source} />
                      <span className="cv-rating-when muted small">{fmtDate(r.occurredAt)}</span>
                    </>
                  ) : (
                    <span className="cv-rating-none muted small">Not rated yet</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="cv-two cv-two-wide">
        <Card>
          <CardHead title="At a glance" />
          <dl className="cv-glance" data-testid="overview-glance">
            <div><dt>Sessions completed</dt><dd className="tnum">{snapshot.sessionsCompleted}</dd></div>
            <div><dt>Last session</dt><dd>{snapshot.lastSession ? <>Session {snapshot.lastSession.number} <span className="muted">· {fmtDate(snapshot.lastSession.occurredAt)}</span></> : <span className="muted">None yet</span>}</dd></div>
            <div><dt>Last self check-in</dt><dd>{snapshot.lastSelfCheckIn ? relativeTime(snapshot.lastSelfCheckIn) : <span className="muted">None yet</span>}</dd></div>
            <div><dt>Self check-ins <span className="muted">· 30 days</span></dt><dd className="tnum">{snapshot.selfCheckIns30d}</dd></div>
            <div><dt>Notes &amp; reflections <span className="muted">· 30 days</span></dt><dd className="tnum">{snapshot.journalEntries30d}</dd></div>
            <div><dt>Actions completed <span className="muted">· 30 days</span></dt><dd className="tnum">{snapshot.completedActions30d}</dd></div>
            <div><dt>Active actions</dt><dd className="tnum">{snapshot.activeActions}</dd></div>
          </dl>
        </Card>

        <Card>
          <CardHead
            title="Recent shared activity"
            sub="Ratings, progress updates, reflections, actions and sessions"
            actions={<Link to={staffDreamerPath(id, 'reflections')} className="cv-link" data-testid="overview-all-reflections">All reflections</Link>}
          />
          <div data-testid="overview-activity">
            <TimelineFeed items={recentActivity} dreamerRef={id} mode="staff" compact limit={10} dreams={snapshot.dreams} emptyTitle="Nothing yet" emptyBody="Ratings, progress updates, reflections and actions will appear here as they happen." />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ======================================================================
   Sessions
   ====================================================================== */

function SessionDetail({ id, session: s, prev, dreams, actions }: { id: number; session: CoachingSession; prev: CoachingSession | null; dreams: Dream[]; actions: ActionItem[] }) {
  // In the order they were chosen in the conversation.
  const own = useMemo(() => actions.filter((a) => a.sessionId === s.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id), [actions, s.id]);
  const inProgress = s.status === 'in_progress';
  return (
    <Card className="cv-session-detail" data-testid="session-detail" data-session-id={s.id}>
      <CardHead
        title={<span className="row-wrap">Session {s.number}{inProgress && <Chip className="chip-warning">In progress</Chip>}</span>}
        sub={`${fmtDateTime(s.occurredAt)} · with ${s.coach.name}`}
        actions={
          <Link to={sessionPath(id, s.id)} className={`btn btn-sm ${inProgress ? 'btn-primary' : 'btn-secondary'}`} data-testid="session-open-workspace">
            {inProgress ? <><IconPlay /> Open workspace</> : <><IconEdit /> Edit in workspace</>}
          </Link>
        }
      />
      <div className="cv-detail-grid">
        <section className="cv-detail-section cv-detail-focus">
          <h4>Focus</h4>
          {s.focus ? <p className="cv-focus">{s.focus}</p> : <p className="muted small">No focus recorded.</p>}
        </section>
        <section className="cv-detail-section cv-detail-notes">
          <h4>Notes</h4>
          {s.notes ? <div className="cv-notes" data-testid="session-notes">{s.notes}</div> : <p className="muted small">No notes recorded.</p>}
        </section>
        <section className="cv-detail-section cv-detail-ratings">
          <h4>Ratings</h4>
          <ul className="cv-rating-chips">
            {RATING_CATEGORIES.map((c) => {
              const v = s.ratings[c];
              const pv = prev?.ratings[c];
              return (
                <li key={c} style={catStyle(c)} className={v == null ? 'is-empty' : ''}>
                  <span className="cv-dot" />
                  <span className="cv-rating-chip-label">{CATEGORY_META[c].label}</span>
                  <b className="tnum">{v ?? '–'}</b>
                  {v != null && pv != null && <Delta value={v - pv} digits={0} />}
                </li>
              );
            })}
          </ul>
        </section>
        <section className="cv-detail-section cv-detail-progress">
          <h4>Dream progress</h4>
          <ul className="cv-progress-list">
            {bySlot(dreams).map((d) => {
              const v = s.progress[d.id];
              const pv = prev?.progress[d.id];
              return (
                <li key={d.id}>
                  <span className="cv-progress-label"><span className="cv-eyebrow">{d.slotLabel}</span><span className="truncate" title={d.title}>{d.title}</span></span>
                  <Bar value={v ?? null} label={`${d.title}: ${v ?? 0}%`} />
                  <span className="cv-progress-val tnum">{v == null ? '–' : `${v}%`}{v != null && pv != null && <Delta value={v - pv} digits={0} suffix=" pts" />}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <section className="cv-detail-section cv-detail-actions">
        <h4>Actions from this session</h4>
        <ActionList dreamerRef={id} actions={own} dreams={dreams} mode="staff" compact filter="all" emptyTitle="No actions were chosen in this session" emptyBody="Actions chosen together in the workspace show up here." />
      </section>
    </Card>
  );
}

function SessionsTab({ id, snapshot, dreams }: { id: number; snapshot: Snapshot; dreams: Dream[] }) {
  const grid = useGrid(id);
  const sessions = useSessions(id);
  const actions = useActions(id, 'all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useMemo(() => (sessions.data ? newestFirst(sessions.data) : []), [sessions.data]);
  const selected = list.find((s) => s.id === selectedId) ?? list[0] ?? null;
  const prev = selected ? (sessions.data ?? []).find((s) => s.number === selected.number - 1) ?? null : null;
  const listRef = useRef<HTMLOListElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // The details sit below the grid, often off-screen: picking a column brings them into view and
  // keeps the matching row visible in the (scrollable) list.
  const pickFromGrid = (sessionId: number) => {
    setSelectedId(sessionId);
    window.requestAnimationFrame(() => {
      const listEl = listRef.current;
      const row = listEl?.querySelector<HTMLElement>(`[data-session-id="${sessionId}"]`);
      if (listEl && row) {
        const offset = row.getBoundingClientRect().top - listEl.getBoundingClientRect().top;
        if (offset < 0 || offset + row.offsetHeight > listEl.clientHeight) listEl.scrollTop += offset;
      }
      const detail = detailRef.current;
      if (detail && detail.getBoundingClientRect().top > window.innerHeight - 160) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (sessions.isPending || grid.isPending) return <LoadingPage label="Loading sessions…" />;
  if (sessions.isError) return <ErrorCallout error={sessions.error} />;
  if (grid.isError) return <ErrorCallout error={grid.error} />;

  if (list.length === 0) {
    return (
      <Card>
        <EmptyState icon={<IconMessage />} title="No sessions yet" action={<SessionButton id={id} snapshot={snapshot} label="Start the first session" testId="sessions-start-first" />}>
          The grid and the session history begin with the first one-on-one.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="stack cv-stack">
      <Card>
        <CardHead title="Session grid" sub="One column per coaching session, oldest to newest. Small figures show the change from the previous session. Self check-ins are in History." />
        <SessionGridView grid={grid.data} currentSessionId={selected?.id ?? null} showDeltas onSelectSession={pickFromGrid} />
      </Card>

      <div className="cv-sessions">
        <Card pad={false} className="cv-session-list-card">
          <ol ref={listRef} className="cv-session-list" data-testid="sessions-list">
            {list.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`cv-session-row${selected?.id === s.id ? ' is-selected' : ''}`}
                  onClick={() => setSelectedId(s.id)}
                  aria-current={selected?.id === s.id ? 'true' : undefined}
                  data-testid="session-row"
                  data-session-id={s.id}
                >
                  <span className="cv-session-row-head">
                    <span className="cv-strong">Session {s.number}</span>
                    {s.status === 'in_progress' && <Chip className="chip-warning">In progress</Chip>}
                    <span className="muted small cv-session-date">{fmtDate(s.occurredAt, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </span>
                  <span className="muted small">with {s.coach.name}</span>
                  {s.focus && <span className="cv-session-focus"><span className="cv-eyebrow">Focus</span><span>{s.focus}</span></span>}
                  {s.notes && <span className="cv-session-preview">{firstLine(s.notes)}</span>}
                  <span className="muted tiny">{s.actionsCreated === 0 ? 'No actions chosen' : `${plural(s.actionsCreated, 'action')} chosen`}{s.actionsCompleted > 0 ? ` · ${s.actionsCompleted} completed` : ''}</span>
                </button>
              </li>
            ))}
          </ol>
        </Card>
        <div ref={detailRef} className="cv-session-detail-anchor">
          {selected && <SessionDetail id={id} session={selected} prev={prev} dreams={dreams} actions={actions.data ?? []} />}
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   Actions
   ====================================================================== */

type ActionFilter = 'active' | 'completed' | 'archived';
const ACTION_EMPTY: Record<ActionFilter, [string, string]> = {
  active: ['No active actions', 'Add one above, or choose some together in the next session.'],
  completed: ['No completed actions yet', 'Completed actions will gather here.'],
  archived: ['Nothing set aside', 'Actions that are set aside stay here and can be restored any time.'],
};

function ActionsTab({ id, dreams }: { id: number; dreams: Dream[] }) {
  const actions = useActions(id, 'all');
  const [filter, setFilter] = useState<ActionFilter>('active');
  const count = (s: ActionFilter) => actions.data?.filter((a) => a.status === s).length ?? 0;
  const seg = (s: ActionFilter, label: string) => ({ value: s, label: <>{label} <span className="cv-seg-count tnum">{count(s)}</span></> });
  const [emptyTitle, emptyBody] = ACTION_EMPTY[filter];
  return (
    <Card className="cv-actions-card">
      <CardHead
        title="Actions"
        sub="Steps chosen together in sessions or by the dreamer between them. Setting one aside is a neutral act."
        actions={<div data-testid="actions-filter"><Segmented value={filter} onChange={setFilter} ariaLabel="Filter actions" options={[seg('active', 'Active'), seg('completed', 'Completed'), seg('archived', 'Set aside')]} /></div>}
      />
      {actions.isPending ? (
        <div className="stack"><Skeleton h={44} /><Skeleton h={44} /><Skeleton h={44} /></div>
      ) : actions.isError ? (
        <ErrorCallout error={actions.error} />
      ) : (
        <ActionList dreamerRef={id} actions={actions.data} dreams={dreams} mode="staff" showAdd filter={filter} emptyTitle={emptyTitle} emptyBody={emptyBody} />
      )}
    </Card>
  );
}

/* ======================================================================
   History
   ====================================================================== */

const ratingPoints = (entries: RatingEntry[]): TrendPoint[] => entries.map((e) => ({ at: e.occurredAt, value: e.value, source: e.source, note: e.note?.body ?? null }));
const progressPoints = (entries: ProgressEntry[]): TrendPoint[] => entries.map((e) => ({ at: e.occurredAt, value: e.value, source: e.source, note: e.note?.body ?? null }));

const ENTRY_PREVIEW = 12;

function EntryList({ entries, color, tint, unit = '', noun = 'entries' }: { entries: (RatingEntry | ProgressEntry)[]; color: string; tint: string; unit?: string; noun?: string }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(() => newestFirst(entries), [entries]);
  if (sorted.length === 0) return <p className="muted small">No entries yet.</p>;
  const visible = showAll ? sorted : sorted.slice(0, ENTRY_PREVIEW);
  return (
    <>
      <ol className="cv-entries" data-testid="history-entries" style={{ '--cv-color': color, '--cv-tint': tint } as CSSProperties}>
        {visible.map((e) => (
          <li key={e.id} className="cv-entry" data-testid="history-entry" data-source={e.source}>
            <span className="cv-val tnum">{e.value}{unit}</span>
            <div className="cv-entry-body">
              <div className="cv-entry-meta">
                <SourceChip source={e.source} coachName={e.source === 'session' ? e.recordedBy.name : undefined} />
                <time dateTime={e.occurredAt} className="muted small">{fmtDateTime(e.occurredAt)}</time>
              </div>
              {e.note && <div className="note-block" data-testid="history-note">{e.note.body}</div>}
            </div>
          </li>
        ))}
      </ol>
      {sorted.length > ENTRY_PREVIEW && (
        <div className="cv-more">
          <Button variant="secondary" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} data-testid="history-show-all">
            {showAll ? `Show the latest ${ENTRY_PREVIEW}` : `Show all ${sorted.length} ${noun}`}
          </Button>
        </div>
      )}
    </>
  );
}

function Reflections({ id, entries, dreams, title }: { id: number; entries: JournalEntry[]; dreams: Dream[]; title: string }) {
  if (entries.length === 0) return null;
  return (
    <section className="cv-history-reflections" data-testid="history-reflections">
      <h4>{title}</h4>
      <div className="cv-cards-list">
        {newestFirst(entries).map((e) => <JournalEntryCard key={e.id} entry={e} dreamerRef={id} mode="staff" dreams={dreams} />)}
      </div>
    </section>
  );
}

function CareHistory({ id, dreams }: { id: number; dreams: Dream[] }) {
  const [cat, setCat] = useState<RatingCategory>('contribution');
  const hist = useCategoryHistory(id, cat);
  const m = CATEGORY_META[cat];
  const sessionCount = hist.data?.entries.filter((e) => e.source === 'session').length ?? 0;
  const selfCount = (hist.data?.entries.length ?? 0) - sessionCount;
  return (
    <Card>
      <div className="cv-cat-tabs" role="tablist" aria-label="CARE area">
        {RATING_CATEGORIES.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={c === cat} className={`cv-cat-tab${c === cat ? ' is-active' : ''}`} style={catStyle(c)} onClick={() => setCat(c)} data-testid={`history-category-${c}`}>
            <span className="cv-dot" />{CATEGORY_META[c].label}
          </button>
        ))}
      </div>
      <div className="cv-history-title" style={catStyle(cat)}>
        <h3>{m.label}</h3>
        <p className="muted small">{m.areas.length ? m.areas.join(' · ') : m.prompt}</p>
      </div>
      {hist.isPending ? (
        <Skeleton h={240} />
      ) : hist.isError ? (
        <ErrorCallout error={hist.error} />
      ) : (
        <>
          <TrendChart points={ratingPoints(hist.data.entries)} max={10} color={m.color} height={240} emptyLabel="No ratings yet" />
          <div className="cv-chart-foot">
            <SourceLegend color={m.color} />
            {hist.data.entries.length > 0 && <span className="muted small tnum">{plural(sessionCount, 'session rating')} · {plural(selfCount, 'self check-in')}</span>}
          </div>
          <h4 className="cv-list-head">Entries</h4>
          <EntryList key={cat} entries={hist.data.entries} color={m.color} tint={m.tint} noun="ratings" />
          <Reflections id={id} entries={hist.data.reflections} dreams={dreams} title="Reflections written at check-in" />
        </>
      )}
    </Card>
  );
}

function DreamsHistory({ id, dreams }: { id: number; dreams: Dream[] }) {
  const sorted = bySlot(dreams);
  const [dreamId, setDreamId] = useState<number | null>(null);
  const dream = sorted.find((d) => d.id === dreamId) ?? sorted[0] ?? null;
  const hist = useDreamHistory(id, dream?.id ?? null);
  if (!dream) return <Card><EmptyState icon={<IconStar />} title="No dreams yet">The four dreams appear here once they are written down.</EmptyState></Card>;
  const color = 'var(--gold)';
  return (
    <Card>
      <div className="cv-cat-tabs" role="tablist" aria-label="Dream">
        {sorted.map((d) => (
          <button key={d.id} type="button" role="tab" aria-selected={d.id === dream.id} className={`cv-cat-tab cv-dream-tab${d.id === dream.id ? ' is-active' : ''}`} onClick={() => setDreamId(d.id)} data-testid={`history-dream-${d.id}`} title={d.title}>
            <IconStar /><span className="cv-dream-tab-text">{d.slotLabel}</span>
          </button>
        ))}
      </div>
      <div className="cv-history-title">
        <div className="cv-eyebrow">{dream.slotLabel}{dream.achievedAt && <> · <span className="cv-achieved">Achieved {fmtDate(dream.achievedAt)}</span></>}</div>
        <h3>{dream.title}</h3>
        {dream.description && <p className="muted small cv-dream-desc">{dream.description}</p>}
      </div>
      {hist.isPending ? (
        <Skeleton h={240} />
      ) : hist.isError ? (
        <ErrorCallout error={hist.error} />
      ) : (
        <>
          <TrendChart points={progressPoints(hist.data.entries)} max={100} unit="%" color="var(--gold)" height={240} emptyLabel="No progress recorded yet" />
          <div className="cv-chart-foot"><SourceLegend color={color} /></div>
          <h4 className="cv-list-head">Progress updates</h4>
          <EntryList key={dream.id} entries={hist.data.entries} color="var(--gold)" tint="var(--gold-soft)" unit="%" noun="updates" />
          <Reflections id={id} entries={hist.data.reflections} dreams={dreams} title="Reflections about this dream" />
        </>
      )}
    </Card>
  );
}

function HistoryTab({ id, dreams }: { id: number; dreams: Dream[] }) {
  const [mode, setMode] = useState<'care' | 'dreams'>('care');
  return (
    <div className="stack cv-stack">
      <div className="cv-history-head">
        <div data-testid="history-mode"><Segmented value={mode} onChange={setMode} ariaLabel="History type" options={[{ value: 'care', label: 'CARE' }, { value: 'dreams', label: 'Dreams' }]} /></div>
        <span className="muted small">Solid dots are coaching sessions; hollow dots are self check-ins.</span>
      </div>
      {mode === 'care' ? <CareHistory id={id} dreams={dreams} /> : <DreamsHistory id={id} dreams={dreams} />}
    </div>
  );
}

/* ======================================================================
   Reflections
   ====================================================================== */

type ReflectionFilter = { kind: 'all' } | { kind: 'dream'; dreamId: number } | { kind: 'category'; category: RatingCategory };
const REFLECTIONS_PAGE = 20;

function ReflectionsTab({ id, dreams }: { id: number; dreams: Dream[] }) {
  const journal = useJournal(id);
  const [filter, setFilterState] = useState<ReflectionFilter>({ kind: 'all' });
  const [shown, setShown] = useState(REFLECTIONS_PAGE);
  const setFilter = (f: ReflectionFilter) => { setFilterState(f); setShown(REFLECTIONS_PAGE); };
  const entries = journal.data ?? [];
  const dreamsWith = bySlot(dreams).filter((d) => entries.some((e) => e.dreamId === d.id));
  const catsWith = RATING_CATEGORIES.filter((c) => entries.some((e) => e.category === c));
  const visible = useMemo(() => {
    const v = filter.kind === 'all' ? entries : filter.kind === 'dream' ? entries.filter((e) => e.dreamId === filter.dreamId) : entries.filter((e) => e.category === filter.category);
    return newestFirst(v);
  }, [entries, filter]);
  const page = useMemo(() => visible.slice(0, shown), [visible, shown]);
  const remaining = visible.length - page.length;
  const days = useMemo(() => {
    const out: { key: string; at: string; items: JournalEntry[] }[] = [];
    for (const e of page) {
      const key = dayKey(e.occurredAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, at: e.occurredAt, items: [e] });
    }
    return out;
  }, [page]);

  const chip = (active: boolean, onClick: () => void, children: ReactNode, testId: string, style?: CSSProperties) => (
    <button key={testId} type="button" className="chip chip-button cv-filter-chip" aria-pressed={active} onClick={onClick} data-testid={testId} style={style}>{children}</button>
  );

  return (
    <Card>
      <CardHead title="Reflections" sub={entries.length ? `${plural(entries.length, 'entry', 'entries')} · reflections, plus notes written alongside ratings and progress updates` : undefined} />
      {(dreamsWith.length > 0 || catsWith.length > 0) && (
        <div className="cv-filters" data-testid="reflections-filters">
          {chip(filter.kind === 'all', () => setFilter({ kind: 'all' }), 'All', 'reflections-filter-all')}
          {dreamsWith.map((d) => chip(filter.kind === 'dream' && filter.dreamId === d.id, () => setFilter({ kind: 'dream', dreamId: d.id }), <><IconStar /><span className="cv-filter-text">{d.title}</span></>, `reflections-filter-dream-${d.id}`))}
          {catsWith.map((c) => chip(filter.kind === 'category' && filter.category === c, () => setFilter({ kind: 'category', category: c }), <><span className="cv-dot" />{CATEGORY_META[c].label}</>, `reflections-filter-${c}`, catStyle(c)))}
        </div>
      )}
      {journal.isPending ? (
        <div className="stack"><Skeleton h={72} /><Skeleton h={72} /><Skeleton h={72} /></div>
      ) : journal.isError ? (
        <ErrorCallout error={journal.error} />
      ) : visible.length === 0 ? (
        <EmptyState icon={<IconPen />} title={entries.length === 0 ? 'No shared reflections yet' : 'No reflections match this filter'}>
          {entries.length === 0 ? 'Reflections and notes the dreamer writes will appear here.' : 'Try another dream or CARE area, or show all.'}
        </EmptyState>
      ) : (
        <>
          <div className="cv-days">
            {days.map((day) => (
              <section key={day.key} className="cv-day" data-testid="reflections-day">
                <h4 className="cv-day-head">{dayHeading(day.at)}</h4>
                <div className="cv-cards-list">
                  {day.items.map((e) => <JournalEntryCard key={e.id} entry={e} dreamerRef={id} mode="staff" dreams={dreams} dateFormat="time" />)}
                </div>
              </section>
            ))}
          </div>
          {remaining > 0 && (
            <div className="cv-more">
              <Button variant="secondary" onClick={() => setShown((n) => n + REFLECTIONS_PAGE)} data-testid="reflections-show-more">
                Show {Math.min(REFLECTIONS_PAGE, remaining)} more <span className="cv-more-count tnum">{remaining} earlier</span>
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ======================================================================
   Page
   ====================================================================== */

function NotFound({ backTo, backLabel }: { backTo: string; backLabel: string }) {
  return (
    <div className="page page-narrow" data-testid="staff-not-found">
      <EmptyState icon={<IconCompass />} title="We couldn’t find that dreamer" action={<Link to={backTo} className="btn btn-primary">{backLabel}</Link>}>
        They may not be on your caseload, or the link may be out of date.
      </EmptyState>
    </div>
  );
}

export function StaffDreamerPage() {
  const params = useParams<{ dreamerId: string; tab?: string }>();
  const id = Number(params.dreamerId);
  const valid = Number.isInteger(id) && id > 0;
  const tab: Tab = (TABS as readonly string[]).includes(params.tab ?? '') ? (params.tab as Tab) : 'overview';
  const { auth } = useAuth();
  const isDirector = auth?.user.role === 'director';
  // A 404 (unknown dreamer, or one outside this coach's caseload) is final — don't retry it.
  const overview = useOverview(id, { enabled: valid, retry: (count, err) => !is404(err) && count < 2 });
  // The Director's own dreamers lead back to their coaching list, everyone else's to All dreamers.
  const ownCaseload = !isDirector || (overview.data != null && overview.data.dreamer.coach?.userId === auth?.user.id);
  const backTo = ownCaseload ? '/coach' : '/director/dreamers';
  const backLabel = !isDirector ? 'My dreamers' : ownCaseload ? 'My coaching' : 'All dreamers';

  if (!valid || (overview.isError && is404(overview.error))) return <NotFound backTo={backTo} backLabel={backLabel} />;
  if (overview.isPending) return <div className="page page-wide"><LoadingPage label="Loading dreamer…" /></div>;
  if (overview.isError) return <div className="page page-wide"><ErrorCallout error={overview.error} /></div>;

  const { dreamer, snapshot } = overview.data;
  const dreams = snapshot.dreams;

  return (
    <div className="page page-wide cv-dreamer">
      <Link to={backTo} className="cv-back" data-testid="staff-back"><IconArrowLeft /> {backLabel}</Link>

      <header className="cv-head" data-testid="staff-dreamer-header">
        <div className="cv-head-main">
          <Avatar initials={dreamer.initials} size="lg" />
          <div className="cv-head-text">
            <h1 className="cv-head-name">{dreamer.name} <StatusChip status={dreamer.status} /></h1>
            {dreamer.about && <p className="cv-head-about">{dreamer.about}</p>}
            <div className="cv-head-meta">
              <span><IconUsers /> {dreamer.coach ? `Coached by ${dreamer.coach.name}` : 'No coach assigned'}</span>
              <span>{dreamer.program.name}</span>
              <span>Joined {fmtDay(dreamer.joinedOn)}</span>
            </div>
          </div>
        </div>
        <div className="cv-head-actions">
          <SessionButton id={id} snapshot={snapshot} />
        </div>
      </header>

      <nav className="tabs cv-tabs" aria-label="Dreamer sections">
        {TABS.map((t) => (
          <Link key={t} to={staffDreamerPath(id, t === 'overview' ? undefined : t)} className={`tab${t === tab ? ' active' : ''}`} aria-current={t === tab ? 'page' : undefined} data-testid={`staff-tab-${t}`}>
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      <div key={tab} className="fade-in">
        {tab === 'overview' && <OverviewTab id={id} overview={overview.data} />}
        {tab === 'sessions' && <SessionsTab id={id} snapshot={snapshot} dreams={dreams} />}
        {tab === 'actions' && <ActionsTab id={id} dreams={dreams} />}
        {tab === 'history' && <HistoryTab id={id} dreams={dreams} />}
        {tab === 'reflections' && <ReflectionsTab id={id} dreams={dreams} />}
      </div>
    </div>
  );
}
