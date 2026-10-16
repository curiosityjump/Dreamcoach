/**
 * Dreamer home — the personal dashboard. A calm greeting, the four dreams with
 * progress, the latest CARE snapshot, active actions, the last coaching session
 * and recent activity. Everything here is the dreamer's own data (`'me'`).
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthContext';
import { useActions, useOverview, useSessions } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Avatar, Bar, Button, Card, CardHead, Chip, Delta, EmptyState, LoadingPage, PageHeader, Skeleton, Stat } from '@/components/ui';
import { WheelOfLife, type WheelValues } from '@/components/WheelOfLife';
import { IconArrowRight, IconCheck, IconEye, IconInfo, IconList, IconMessage, IconPen, IconPlus, IconSparkle, IconStar } from '@/components/icons';
import { ActionComposer, ActionList } from '@/features/shared/ActionItems';
import { TimelineFeed } from '@/features/shared/Timeline';
import { CARE_CATEGORIES, CATEGORY_META, type CareCategory } from '@shared/care';
import type { CoachingSession, Dream, DreamerOverview, LatestRating, Snapshot } from '@shared/types';
import { firstName, fmtDate, fmtDateLong, plural, relativeTime } from '@/lib/format';

/* ---------- Small helpers ---------- */

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "2 days ago" for recent dates, "on Oct 14" for older ones. */
function whenPhrase(iso: string): string {
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  return days < 7 ? relativeTime(iso) : `on ${fmtDate(iso)}`;
}

function contextLine(snapshot: Snapshot, coachName: string | null): string {
  const who = coachName ? firstName(coachName) : 'your coach';
  if (snapshot.openSession) return `A session with ${who} is in progress.`;
  const last = snapshot.lastSession;
  if (!last) {
    return coachName
      ? `Your first conversation with ${who} will start wherever you'd like to begin. Until then, this is your space.`
      : 'This is your space for dreams, actions and reflections.';
  }
  return `Session ${last.number} with ${who} was ${whenPhrase(last.occurredAt)}. Your next conversation will pick up where you left off.`;
}

/** One line describing where the latest CARE values came from. */
function latestSummary(latest: Snapshot['latest'], coachName: string | null): string | null {
  const entries = CARE_CATEGORIES.map((c) => latest[c]).filter((x): x is LatestRating => !!x);
  if (!entries.length) return null;
  const newest = entries.reduce((a, b) => (a.occurredAt > b.occurredAt ? a : b));
  const sameMoment = entries.every((e) => e.source === newest.source && e.occurredAt.slice(0, 10) === newest.occurredAt.slice(0, 10));
  const when = whenPhrase(newest.occurredAt);
  if (sameMoment) {
    return newest.source === 'session' ? `From your session${coachName ? ` with ${firstName(coachName)}` : ''} ${when}` : `From your self check-in ${when}`;
  }
  return `A mix of session and self check-in values · most recent ${when}`;
}

const sourceLabel = (r: LatestRating) => `${r.source === 'session' ? 'Session' : 'Self check-in'} · ${fmtDate(r.occurredAt)}`;

/* ---------- Page ---------- */

export function HomePage() {
  const { auth } = useAuth();
  const overview = useOverview('me');

  if (overview.isLoading) return <LoadingPage label="Opening your space…" />;
  if (overview.error || !overview.data) {
    return (
      <div className="page">
        <PageHeader eyebrow="Home" title="Something went wrong" />
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(overview.error)}</span></div>
      </div>
    );
  }

  const data = overview.data;
  const { dreamer, snapshot } = data;
  const name = firstName(auth?.user.name ?? dreamer.name);
  const coachName = dreamer.coach?.name ?? null;

  return (
    <div className="page dh-page" data-testid="home-page">
      <PageHeader
        eyebrow={dreamer.program.name}
        title={<span data-testid="home-greeting">{greeting()}, {name}</span>}
        lead={
          <>
            <span data-testid="home-context">{contextLine(snapshot, coachName)}</span>
            {auth?.privateUnlocked && (
              <span className="dh-private-hint"><IconEye /> Private entries are showing on this device.</span>
            )}
          </>
        }
        actions={
          <>
            <Link to="/check-in" className="btn btn-primary dh-cta" data-testid="home-checkin"><IconSparkle /> Check in</Link>
            <Link to="/journal?compose=1" className="btn btn-secondary dh-cta" data-testid="home-write"><IconPen /> Write a reflection</Link>
          </>
        }
      />

      <div className="dh-grid">
        <div className="dh-col">
          <DreamsCard dreams={snapshot.dreams} />
          <ActionsCard dreams={snapshot.dreams} />
        </div>
        <div className="dh-col">
          <CareCard snapshot={snapshot} coachName={coachName} />
          <CoachingCard snapshot={snapshot} coachName={coachName} />
        </div>
      </div>

      <RecentCard overview={data} />
    </div>
  );
}

/* ---------- Your dreams ---------- */

function DreamsCard({ dreams }: { dreams: Dream[] }) {
  return (
    <Card data-testid="home-dreams">
      <CardHead title="Your dreams" sub="Where you're heading, and how far you've come" actions={<Link to="/dreams" className="btn btn-ghost btn-sm" data-testid="home-dreams-all">All dreams</Link>} />
      {dreams.length ? (
        <div className="dh-dreams">
          {dreams.map((d) => <DreamRow key={d.id} dream={d} />)}
        </div>
      ) : (
        <EmptyState icon={<IconStar />} title="Your dreams live here">Once your four dreams are set up, you'll see their progress here.</EmptyState>
      )}
    </Card>
  );
}

function DreamRow({ dream }: { dream: Dream }) {
  const achieved = !!dream.achievedAt;
  const delta = dream.progress != null && dream.previousProgress != null ? dream.progress - dream.previousProgress : null;
  return (
    <Link to={`/dreams/${dream.id}`} className="dh-dream" data-testid="home-dream" data-dream-id={dream.id}>
      <div className="dh-dream-top">
        <div className="grow">
          <div className="dh-eyebrow">{dream.slotLabel}</div>
          <div className="dh-dream-title">{dream.title || <span className="muted">Untitled dream</span>}</div>
        </div>
        <div className="dh-dream-pct tnum" aria-hidden>{dream.progress != null ? `${dream.progress}%` : ''}</div>
      </div>
      <Bar value={dream.progress} color={achieved ? 'var(--success)' : undefined} label={`${dream.title || 'Dream'} progress`} />
      <div className="dh-dream-meta">
        {achieved && <Chip className="chip-success"><IconCheck /> Achieved {fmtDate(dream.achievedAt)}</Chip>}
        {dream.progress == null ? (
          <span>No progress recorded yet</span>
        ) : delta != null ? (
          <span className="row" title="Change since the previous progress update"><Delta value={delta} digits={0} suffix=" pts" /></span>
        ) : (
          <span>First recorded {fmtDate(dream.progressAt)}</span>
        )}
        <span className="dh-dot" aria-hidden />
        <span>{dream.activeActions ? plural(dream.activeActions, 'active action') : 'No active actions'}</span>
      </div>
    </Link>
  );
}

/* ---------- CARE right now ---------- */

function CareCard({ snapshot, coachName }: { snapshot: Snapshot; coachName: string | null }) {
  const latest = snapshot.latest;
  const wheel = useMemo<WheelValues>(() => Object.fromEntries(CARE_CATEGORIES.map((c) => [c, latest[c]?.value ?? null])) as WheelValues, [latest]);
  const summary = latestSummary(latest, coachName);
  const anyRated = CARE_CATEGORIES.some((c) => latest[c]);
  return (
    <Card data-testid="home-care">
      <CardHead title="CARE right now" sub={summary ?? 'Contribution, Alignment, Relationships, Energy'} actions={<Link to="/care" className="btn btn-ghost btn-sm" data-testid="home-care-link">{anyRated ? 'Full view' : 'Rate now'}</Link>} />
      <div className="dh-care-wheel">
        <WheelOfLife values={wheel} size={260} />
      </div>
      <div className="dh-care-rows">
        {CARE_CATEGORIES.map((c) => <CareRow key={c} category={c} latest={latest[c]} />)}
      </div>
      <div className="dh-stats">
        {(['commitment', 'satisfaction'] as const).map((c) => {
          const l = latest[c];
          return (
            <div key={c} data-testid={`home-stat-${c}`}>
              <Stat label={CATEGORY_META[c].label} value={l ? l.value : '—'} sub={l ? sourceLabel(l) : 'Not rated yet'} delta={l && l.previous != null ? l.value - l.previous : null} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CareRow({ category, latest }: { category: CareCategory; latest: LatestRating | undefined }) {
  const m = CATEGORY_META[category];
  const delta = latest && latest.previous != null ? latest.value - latest.previous : null;
  return (
    <Link to={`/care/${category}`} className="dh-care-row" data-testid={`home-care-${category}`} style={{ '--dh-color': m.color, '--dh-tint': m.tint } as CSSProperties}>
      <span className="dh-care-swatch" aria-hidden />
      <span className="grow">
        <span className="dh-care-label">{m.label}</span>
        <span className="dh-care-src">{latest ? sourceLabel(latest) : 'Not rated yet'}</span>
      </span>
      <span className="dh-care-delta">{latest && <Delta value={delta} digits={0} />}</span>
      <span className="dh-care-val tnum">{latest ? latest.value : '–'}</span>
    </Link>
  );
}

/* ---------- Actions ---------- */

const HOME_ACTION_LIMIT = 5;

function ActionsCard({ dreams }: { dreams: Dream[] }) {
  const actions = useActions('me', 'active');
  const [composing, setComposing] = useState(false);
  const active = actions.data ?? [];
  const shown = active.slice(0, HOME_ACTION_LIMIT);
  const isEmpty = !actions.isLoading && !actions.error && active.length === 0;

  return (
    <Card data-testid="home-actions">
      <CardHead
        title="Actions"
        sub={active.length ? plural(active.length, 'active action') : 'Small steps toward your dreams'}
        actions={
          <>
            {!isEmpty && (
              <Button size="sm" variant="secondary" onClick={() => setComposing((v) => !v)} aria-expanded={composing} data-testid="home-add-action">
                <IconPlus /> {composing ? 'Close' : 'Add'}
              </Button>
            )}
            <Link to="/actions" className="btn btn-ghost btn-sm" data-testid="home-actions-all">All actions</Link>
          </>
        }
      />
      {composing && !isEmpty && (
        <div className="dh-composer" data-testid="home-composer">
          <ActionComposer dreamerRef="me" dreams={dreams} mode="dreamer" autoFocus onDone={() => setComposing(false)} onCancel={() => setComposing(false)} />
        </div>
      )}
      {actions.isLoading ? (
        <div className="stack" aria-busy>
          <Skeleton h={22} /><Skeleton h={22} w="80%" /><Skeleton h={22} w="60%" />
        </div>
      ) : actions.error ? (
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(actions.error)}</span></div>
      ) : isEmpty ? (
        <>
          <EmptyState icon={<IconList />} title="Nothing on your list right now">
            Add a small step toward one of your dreams — or something you and your coach talked about.
          </EmptyState>
          <div className="dh-composer" data-testid="home-composer">
            <ActionComposer dreamerRef="me" dreams={dreams} mode="dreamer" />
          </div>
        </>
      ) : (
        <>
          <ActionList dreamerRef="me" actions={shown} dreams={dreams} mode="dreamer" filter="active" compact showAdd={false} />
          {active.length > HOME_ACTION_LIMIT && (
            <Link to="/actions" className="dh-more" data-testid="home-actions-more">
              {plural(active.length - HOME_ACTION_LIMIT, 'more active action')} <IconArrowRight />
            </Link>
          )}
        </>
      )}
    </Card>
  );
}

/* ---------- Coaching ---------- */

function CoachingCard({ snapshot, coachName }: { snapshot: Snapshot; coachName: string | null }) {
  const sessions = useSessions('me');
  const lastCompleted = useMemo<CoachingSession | null>(() => {
    const done = (sessions.data ?? []).filter((s) => s.status === 'completed');
    if (!done.length) return null;
    return done.reduce((a, b) => (a.occurredAt > b.occurredAt ? a : b));
  }, [sessions.data]);
  const who = coachName ? firstName(coachName) : 'your coach';

  return (
    <Card data-testid="home-coaching">
      <CardHead
        title="Coaching"
        sub={coachName ? `With ${coachName}` : 'Your one-on-one conversations'}
        actions={<Link to="/sessions" className="btn btn-ghost btn-sm" data-testid="home-sessions-all">All sessions</Link>}
      />
      {snapshot.openSession && (
        <div className="callout dh-open" data-testid="home-open-session">
          <IconMessage />
          <span>A session with {who} is in progress. Notes and ratings will appear here once it's complete.</span>
        </div>
      )}
      {sessions.isLoading ? (
        <div className="stack" aria-busy><Skeleton h={18} w="40%" /><Skeleton h={14} /><Skeleton h={14} w="90%" /></div>
      ) : sessions.error ? (
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(sessions.error)}</span></div>
      ) : lastCompleted ? (
        <Link to={`/sessions/${lastCompleted.id}`} className="dh-session" data-testid="home-last-session">
          <div className="dh-session-head">
            <Avatar initials={lastCompleted.coach.initials} size="sm" tone="gold" />
            <div className="grow">
              <div className="dh-session-title">Session {lastCompleted.number}</div>
              <div className="dh-session-sub">{fmtDateLong(lastCompleted.occurredAt)} · {lastCompleted.coach.name}</div>
            </div>
          </div>
          {lastCompleted.focus && (
            <div className="dh-session-focus"><span className="dh-eyebrow">Focus</span><span>{lastCompleted.focus}</span></div>
          )}
          {lastCompleted.notes.trim() ? (
            <p className="dh-session-notes">{lastCompleted.notes}</p>
          ) : (
            <p className="dh-session-notes muted">No notes were written for this session.</p>
          )}
          <span className="dh-link">Read the full session <IconArrowRight /></span>
        </Link>
      ) : !snapshot.openSession ? (
        <EmptyState icon={<IconMessage />} title="No sessions yet">
          Your conversations with {who} will appear here — the ratings and progress you record together, the notes, and the actions you choose.
        </EmptyState>
      ) : null}
      {snapshot.sessionsCompleted > 0 && (
        <div className="dh-foot muted tiny">{plural(snapshot.sessionsCompleted, 'session')} completed so far</div>
      )}
    </Card>
  );
}

/* ---------- Recently ---------- */

function RecentCard({ overview }: { overview: DreamerOverview }) {
  return (
    <Card data-testid="home-recent">
      <CardHead title="Recently" sub="Ratings, progress, reflections, actions and sessions" actions={<Link to="/journal" className="btn btn-ghost btn-sm" data-testid="home-journal-link">Journal</Link>} />
      <TimelineFeed
        items={overview.recentActivity}
        dreamerRef="me"
        mode="dreamer"
        dreams={overview.snapshot.dreams}
        compact
        limit={8}
        emptyTitle="Nothing here yet"
        emptyBody="Your check-ins, reflections and sessions will show up here as they happen."
      />
    </Card>
  );
}
