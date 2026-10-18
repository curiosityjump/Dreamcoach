/**
 * My coaching sessions — the dreamer's read-only view of every one-on-one:
 * the spreadsheet-like grid (months side by side), a list newest first, and a
 * detail view per session with the coach's notes, the ratings and dream progress
 * recorded, and the actions chosen (which the dreamer can complete right there).
 */
import { useMemo, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useActions, useDreams, useGrid, useOverview, useSession, useSessions } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Avatar, Bar, Card, CardHead, Chip, Delta, EmptyState, LoadingPage, PageHeader, Skeleton } from '@/components/ui';
import { WheelOfLife, type WheelValues } from '@/components/WheelOfLife';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconInfo, IconLock, IconMessage } from '@/components/icons';
import { ActionList } from '@/features/shared/ActionItems';
import { SessionGridView } from '@/features/coach/SessionGridView';
import { CARE_CATEGORIES, CATEGORY_META, RATING_CATEGORIES, type RatingCategory } from '@shared/care';
import type { ActionItem, CoachingSession, Dream } from '@shared/types';
import { firstName, fmtDateLong, plural } from '@/lib/format';
import { textShade } from '@/lib/color';
import { PrivateMark } from './HomePage';
import { useTouch } from './CareShared';

type DreamRef = Pick<Dream, 'id' | 'title' | 'slot' | 'slotLabel'>;

const newestFirst = (a: CoachingSession, b: CoachingSession) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : b.id - a.id);
const firstLine = (s: string) => s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

/* ---------- Entry ---------- */

export function MySessionsPage() {
  const { sessionId } = useParams();
  const sid = sessionId != null && /^\d+$/.test(sessionId) ? Number(sessionId) : sessionId != null ? NaN : null;
  const sessions = useSessions('me');
  const dreams = useDreams('me');
  const overview = useOverview('me');

  if (sessions.isLoading) return <LoadingPage label="Loading your sessions…" />;
  if (sessions.error || !sessions.data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Coaching" title="My coaching sessions" />
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(sessions.error)}</span></div>
      </div>
    );
  }

  const list = sessions.data;
  const dreamRefs: DreamRef[] = dreams.data ?? overview.data?.snapshot.dreams ?? [];
  const coachName = overview.data?.dreamer.coach?.name ?? list[list.length - 1]?.coach.name ?? null;
  const programName = overview.data?.dreamer.program.name ?? 'Your program';

  if (sid !== null) {
    return <SessionDetail sid={sid} sessions={list} dreams={dreamRefs} programName={programName} />;
  }
  return <SessionsIndex sessions={list} dreams={dreamRefs} coachName={coachName} openSessionId={overview.data?.snapshot.openSession?.id ?? null} />;
}

/* ---------- Index: grid + list ---------- */

function SessionsIndex({ sessions, dreams, coachName, openSessionId }: { sessions: CoachingSession[]; dreams: DreamRef[]; coachName: string | null; openSessionId: number | null }) {
  const nav = useNavigate();
  const touch = useTouch();
  const grid = useGrid('me');
  const sorted = useMemo(() => [...sessions].sort(newestFirst), [sessions]);
  const who = coachName ? firstName(coachName) : 'your coach';
  const completed = sessions.filter((s) => s.status === 'completed').length;

  return (
    <div className="page dh-sessions" data-testid="sessions-page">
      <PageHeader
        eyebrow="Coaching"
        title="My coaching sessions"
        lead={sessions.length
          ? `Your conversations with ${coachName ?? 'your coach'}, side by side: the ratings and dream progress you recorded together, the notes and focus from each one, and the actions you chose.`
          : `Your conversations with ${who} will live here.`}
      />

      {!sessions.length ? (
        <Card>
          <EmptyState
            icon={<IconMessage />}
            title="No sessions yet"
            action={<Link to="/home" className="btn btn-secondary" data-testid="sessions-empty-home">Back home</Link>}
          >
            After your first conversation with {who}, you'll find it here — the ratings and progress you record together, your coach's notes, and the actions you choose.
          </EmptyState>
          <span className="sr-only" data-testid="sessions-empty" />
        </Card>
      ) : (
        <div className="stack dh-sessions-stack">
          <Card data-testid="sessions-grid">
            <CardHead title="Months side by side" sub={`CARE ratings, dream progress, commitment and satisfaction as recorded in each session. ${touch ? 'Tap' : 'Click'} a session to open it.`} />
            {grid.isLoading ? (
              <div className="stack" aria-busy><Skeleton h={28} /><Skeleton h={28} /><Skeleton h={28} w="90%" /></div>
            ) : grid.error || !grid.data ? (
              <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(grid.error)}</span></div>
            ) : (
              <SessionGridView grid={grid.data} editable={false} showDeltas currentSessionId={openSessionId} onSelectSession={(id) => nav(`/sessions/${id}`)} />
            )}
          </Card>

          <Card data-testid="sessions-list">
            <CardHead title="All sessions" sub={`${plural(completed, 'session')} completed${sessions.length > completed ? ' · one in progress' : ''} · newest first`} />
            <div className="dh-srows">
              {sorted.map((s) => <SessionRow key={s.id} session={s} dreams={dreams} />)}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function SessionRow({ session: s, dreams }: { session: CoachingSession; dreams: DreamRef[] }) {
  const open = s.status === 'in_progress';
  const line = firstLine(s.notes);
  return (
    <Link to={`/sessions/${s.id}`} className="dh-srow" data-testid="session-row" data-session-id={s.id}>
      <div className="dh-srow-head">
        <div className="grow">
          <div className="dh-srow-title">
            Session {s.number}
            {open && <Chip className="chip-session">In progress</Chip>}
          </div>
          <div className="dh-srow-sub">{fmtDateLong(s.occurredAt)} · with {s.coach.name}</div>
        </div>
        <IconChevronRight className="dh-srow-chev" />
      </div>
      <div className="dh-pills" aria-label="Ratings recorded">
        {RATING_CATEGORIES.map((c) => <ValuePill key={c} category={c} value={s.ratings[c]} isPrivate={s.privateRatings?.includes(c)} />)}
      </div>
      {dreams.length > 0 && (
        <div className="dh-minis" aria-label="Dream progress recorded">
          {dreams.map((d) => {
            const v = s.progress[d.id];
            const priv = s.privateProgress?.includes(d.id);
            return (
              <span key={d.id} className="dh-mini" title={`${d.slotLabel}: ${d.title}${priv ? ' (private)' : ''}`}>
                <span className="dh-mini-label truncate">{d.title || d.slotLabel}</span>
                <span className="dh-mini-val tnum">{priv && <><IconLock className="dh-lock" /><span className="sr-only">Private</span></>}{v != null ? `${v}%` : '—'}</span>
              </span>
            );
          })}
        </div>
      )}
      {s.focus && <div className="dh-srow-focus"><span className="dh-eyebrow">Focus</span><span>{s.focus}</span></div>}
      {line && <p className="dh-srow-notes">{line}</p>}
      <div className="dh-srow-foot">
        {s.actionsCreated ? `${plural(s.actionsCreated, 'action')} chosen` : 'No actions chosen'}
        {s.actionsCompleted > 0 && ` · ${s.actionsCompleted} completed since`}
      </div>
    </Link>
  );
}

function ValuePill({ category, value, delta, isPrivate }: { category: RatingCategory; value: number | undefined; delta?: number | null; isPrivate?: boolean }) {
  const m = CATEGORY_META[category];
  return (
    <span className="dh-pill" style={{ '--dh-color': m.color, '--dh-tint': m.tint, '--dh-ink': textShade(m.color) } as CSSProperties} title={`${m.label}${value != null ? `: ${value}${isPrivate ? ' (private)' : ''}` : ' (not recorded)'}`}>
      {isPrivate && <><IconLock className="dh-lock" /><span className="sr-only">Private</span></>}
      <span className="dh-pill-k">{m.short}</span>
      <span className="dh-pill-v tnum">{value ?? '–'}</span>
      {delta != null && delta !== 0 && <span className="dh-pill-d tnum">{delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}</span>}
    </span>
  );
}

/* ---------- Detail ---------- */

function SessionDetail({ sid, sessions, dreams, programName }: { sid: number; sessions: CoachingSession[]; dreams: DreamRef[]; programName: string }) {
  const listed = Number.isNaN(sid) ? undefined : sessions.find((s) => s.id === sid);
  const live = useSession('me', listed ? sid : null, listed?.status === 'in_progress' ? { refetchInterval: 8000 } : undefined);
  const actions = useActions('me', 'all');
  const session = live.data ?? listed;

  const ordered = useMemo(() => [...sessions].sort((a, b) => -newestFirst(a, b)), [sessions]);
  const idx = session ? ordered.findIndex((s) => s.id === session.id) : -1;
  const previous = idx > 0 ? ordered[idx - 1] : undefined;
  const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : undefined;

  if (!session) {
    return (
      <div className="page dh-sessions">
        <Link to="/sessions" className="dh-back" data-testid="session-back"><IconArrowLeft /> All sessions</Link>
        <Card>
          <EmptyState icon={<IconMessage />} title="We couldn't find that session" action={<Link to="/sessions" className="btn btn-secondary">See all sessions</Link>}>
            It may have been removed, or the link may be out of date.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const open = session.status === 'in_progress';
  // In the order they were chosen during the session, as the coach's workspace lists them.
  const sessionActions: ActionItem[] = (actions.data ?? []).filter((a) => a.sessionId === session.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const wheelNow = Object.fromEntries(CARE_CATEGORIES.map((c) => [c, session.ratings[c] ?? null])) as WheelValues;
  const wheelPrev = previous ? (Object.fromEntries(CARE_CATEGORIES.map((c) => [c, previous.ratings[c] ?? null])) as WheelValues) : null;
  const anyRating = RATING_CATEGORIES.some((c) => session.ratings[c] != null);
  const anyProgress = dreams.some((d) => session.progress[d.id] != null);

  return (
    <div className="page dh-sessions" data-testid="session-detail" data-session-id={session.id}>
      <Link to="/sessions" className="dh-back" data-testid="session-back"><IconArrowLeft /> All sessions</Link>
      <PageHeader
        eyebrow={programName}
        title={<>Session {session.number}{open && <Chip className="chip-session dh-title-chip">In progress</Chip>}</>}
        lead={`${fmtDateLong(session.occurredAt)} · with ${session.coach.name} · session ${session.number} of your program${ordered.length > 1 ? ` (${ordered.length} so far)` : ''}`}
        actions={
          <>
            {previous ? (
              <Link to={`/sessions/${previous.id}`} className="btn btn-secondary btn-sm" data-testid="session-prev"><IconChevronLeft /> Session {previous.number}</Link>
            ) : null}
            {next ? (
              <Link to={`/sessions/${next.id}`} className="btn btn-secondary btn-sm" data-testid="session-next">Session {next.number} <IconChevronRight /></Link>
            ) : null}
          </>
        }
      />

      {open && (
        <div className="callout dh-open" style={{ marginBottom: 18 }} data-testid="session-open-note">
          <IconMessage />
          <span>This session is still in progress — {firstName(session.coach.name)} is writing as you talk. What you see here updates as it's saved.</span>
        </div>
      )}

      <div className="dh-detail">
        <div className="dh-col">
          <Card data-testid="session-notes-card">
            <CardHead title="Notes" sub={<span className="row"><Avatar initials={session.coach.initials} size="sm" tone="gold" /><span>From your coach, {session.coach.name}</span></span>} />
            {session.focus && (
              <div className="dh-focus" data-testid="session-focus">
                <span className="dh-eyebrow">Focus for the coming period</span>
                <div className="dh-focus-text">{session.focus}</div>
              </div>
            )}
            {session.notes.trim() ? (
              <div className="dh-notes" data-testid="session-notes">{session.notes}</div>
            ) : (
              <p className="muted small" data-testid="session-notes">{open ? 'No notes yet.' : 'No notes were written for this session.'}</p>
            )}
          </Card>

          <Card data-testid="session-actions">
            <CardHead title="Actions chosen in this session" sub={sessionActions.length ? 'Complete or adjust them here — they are yours.' : undefined} />
            {actions.isLoading ? (
              <div className="stack" aria-busy><Skeleton h={22} /><Skeleton h={22} w="70%" /></div>
            ) : actions.error ? (
              <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(actions.error)}</span></div>
            ) : (
              <ActionList
                dreamerRef="me"
                actions={sessionActions}
                dreams={dreams}
                mode="dreamer"
                sessionId={session.id}
                filter="all"
                compact
                showAdd={false}
                emptyTitle="No actions were chosen in this session"
                emptyBody="Not every conversation needs a to-do. Anything you add later lives under Actions."
              />
            )}
          </Card>
        </div>

        <div className="dh-col">
          <Card data-testid="session-ratings">
            <CardHead title="Ratings recorded" sub={previous ? `Compared with Session ${previous.number}` : 'Your first recorded session'} />
            {anyRating ? (
              <>
                <div className="dh-care-wheel">
                  <WheelOfLife values={wheelNow} compare={wheelPrev} size={240} valueLabel={`Session ${session.number}`} compareLabel={previous ? `Session ${previous.number}` : undefined} />
                </div>
                <div className="dh-rating-rows">
                  {RATING_CATEGORIES.map((c) => {
                    const m = CATEGORY_META[c];
                    const v = session.ratings[c];
                    const p = previous?.ratings[c];
                    const delta = v != null && p != null ? v - p : null;
                    return (
                      <div key={c} className="dh-rating-row" style={{ '--dh-color': m.color, '--dh-tint': m.tint } as CSSProperties} data-testid={`session-rating-${c}`}>
                        <span className="dh-care-swatch" aria-hidden />
                        <span className="dh-rating-label grow">{m.label}</span>
                        {v != null && session.privateRatings?.includes(c) && <PrivateMark testId={`session-rating-private-${c}`} />}
                        <span className="dh-care-delta">{v != null && previous && <Delta value={delta} digits={0} />}</span>
                        <span className="dh-care-val tnum">{v ?? '–'}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="muted small">{open ? 'No ratings recorded yet.' : 'No ratings were recorded in this session.'}</p>
            )}
          </Card>

          <Card data-testid="session-progress">
            <CardHead title="Dream progress recorded" sub={previous ? `Change since Session ${previous.number}` : undefined} />
            {dreams.length === 0 ? (
              <p className="muted small">No dreams set up yet.</p>
            ) : anyProgress ? (
              <div className="dh-progress-rows">
                {dreams.map((d) => {
                  const v = session.progress[d.id];
                  const p = previous?.progress[d.id];
                  const delta = v != null && p != null ? v - p : null;
                  return (
                    <Link key={d.id} to={`/dreams/${d.id}`} className="dh-progress-row" data-testid={`session-progress-${d.id}`}>
                      <div className="dh-progress-top">
                        <span className="grow">
                          <span className="dh-eyebrow">{d.slotLabel}</span>
                          <span className="dh-progress-title">{d.title || 'Untitled dream'}</span>
                        </span>
                        {v != null && session.privateProgress?.includes(d.id) && <PrivateMark testId={`session-progress-private-${d.id}`} />}
                        <span className="dh-progress-val tnum">{v != null ? `${v}%` : '—'}</span>
                      </div>
                      <Bar value={v ?? null} label={`${d.title || d.slotLabel} progress`} />
                      <div className="dh-progress-meta">
                        {v == null ? 'Not recorded in this session' : delta != null ? <Delta value={delta} digits={0} suffix=" pts" /> : previous ? 'First time recorded' : 'Starting point'}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="muted small">{open ? 'No dream progress recorded yet.' : 'No dream progress was recorded in this session.'}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
