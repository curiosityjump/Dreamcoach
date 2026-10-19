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
import { Avatar, Bar, Button, Card, CardHead, Chip, Delta, EmptyState, LoadingPage, PageHeader, PrivateChip, Skeleton, Stat } from '@/components/ui';
import { WheelOfLife, type WheelValues } from '@/components/WheelOfLife';
import { IconArrowRight, IconCheck, IconEye, IconInfo, IconList, IconMessage, IconPen, IconPlus, IconSparkle, IconStar } from '@/components/icons';
import { ActionComposer, ActionList } from '@/features/shared/ActionItems';
import { TimelineFeed } from '@/features/shared/Timeline';
import { CARE_CATEGORIES, CATEGORY_META, type CareCategory } from '@shared/care';
import type { CoachingSession, Dream, DreamerOverview, LatestRating, Snapshot } from '@shared/types';
import { dayKey, firstName, fmtDate, fmtDateLong, plural, relativeTime } from '@/lib/format';
import { sessionBaseline } from '@/lib/sessionDelta';
import { KeepDrafts, useLastKnown, useLoadedOnce } from './drafts';

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
  const when = whenPhrase(newest.occurredAt);
  if (entries.some((e) => e.source !== newest.source)) return `A mix of session and self check-in values · most recent ${when}`;
  // One source: one session or check-in when they all fall on the same (local) day, several otherwise.
  const oneDay = entries.every((e) => dayKey(e.occurredAt) === dayKey(newest.occurredAt));
  const coach = coachName ? ` with ${firstName(coachName)}` : '';
  if (newest.source === 'session') return oneDay ? `From your session${coach} ${when}` : `From your sessions${coach} · most recent ${when}`;
  return oneDay ? `From your self check-in ${when}` : `From your self check-ins · most recent ${when}`;
}

const sourceLabel = (r: LatestRating) => `${r.source === 'session' ? 'Session' : 'Self check-in'} · ${fmtDate(r.occurredAt)}`;

type Baseline = ReturnType<typeof sessionBaseline>;

/** What a rating's current value is compared with: the coaching session the coach's views use too. */
const ratingBaseline = (sessions: CoachingSession[], r: LatestRating): Baseline => sessionBaseline(sessions, r.occurredAt, r.source === 'session', (s) => s.ratings[r.category]);

/** A dream's current progress compared with a coaching session (the same baseline as the coach's overview). */
export function dreamBaseline(sessions: CoachingSession[], d: Dream): Baseline {
  if (d.progress == null || d.progressAt == null) return null;
  const fromSession = sessions.some((s) => s.occurredAt === d.progressAt && s.progress[d.id] === d.progress);
  return sessionBaseline(sessions, d.progressAt, fromSession, (s) => s.progress[d.id]);
}

/**
 * The change next to a current value, measured against a coaching session and saying which one ("vs S8",
 * "since S9"), so it agrees with the session pages and the coach's notes. Nothing when there is no session
 * to compare with yet.
 */
export function SessionDelta({ value, base, suffix }: { value: number; base: Baseline; suffix?: string }) {
  if (!base) return null;
  return (
    <span className="dh-delta" data-testid="session-delta">
      <Delta value={value - base.value} digits={0} suffix={suffix} />
      <span className="dh-delta-ref">{base.label}</span>
    </span>
  );
}

/* ---------- Page ---------- */

export function HomePage() {
  const { auth } = useAuth();
  const overview = useOverview('me');
  // Hiding private entries loads the overview again. The page stays meanwhile, so an action being added keeps what's
  // typed: the greeting and the coaching card (never private) show what was there, the rest waits for fresh data.
  const loaded = useLoadedOnce(!!overview.data);
  const known = useLastKnown(overview.data);

  if (!loaded || !known) {
    if (overview.isLoading) return <LoadingPage label="Opening your space…" />;
    return (
      <div className="page">
        <PageHeader eyebrow="Home" title="Something went wrong" />
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(overview.error)}</span></div>
      </div>
    );
  }

  const fresh = overview.data;
  const { dreamer, snapshot } = known;
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

      <KeepDrafts>
        <div className="dh-grid">
          <div className="dh-col">
            {fresh ? <DreamsCard dreams={fresh.snapshot.dreams} /> : <CardSkeleton />}
            <ActionsCard dreams={snapshot.dreams} />
          </div>
          <div className="dh-col">
            {fresh ? <CareCard snapshot={fresh.snapshot} coachName={coachName} /> : <CardSkeleton />}
            <CoachingCard snapshot={snapshot} coachName={coachName} />
          </div>
        </div>

        {fresh ? <RecentCard overview={fresh} /> : <CardSkeleton />}
      </KeepDrafts>
    </div>
  );
}

/** A card waiting for its data to load again. */
function CardSkeleton() {
  return <Card aria-busy><div className="stack"><Skeleton h={18} w="40%" /><Skeleton h={14} /><Skeleton h={14} w="80%" /><Skeleton h={14} w="60%" /></div></Card>;
}

/* ---------- Your dreams ---------- */

function DreamsCard({ dreams }: { dreams: Dream[] }) {
  const sessions = useSessions('me').data ?? [];
  return (
    <Card data-testid="home-dreams">
      <CardHead title="Your dreams" sub="Where you're heading, and how far you've come" actions={<Link to="/dreams" className="btn btn-ghost btn-sm" data-testid="home-dreams-all">All dreams</Link>} />
      {dreams.length ? (
        <div className="dh-dreams">
          {dreams.map((d) => <DreamRow key={d.id} dream={d} base={dreamBaseline(sessions, d)} />)}
        </div>
      ) : (
        <EmptyState icon={<IconStar />} title="Your dreams live here">Once your four dreams are set up, you'll see their progress here.</EmptyState>
      )}
    </Card>
  );
}

function DreamRow({ dream, base }: { dream: Dream; base: Baseline }) {
  const achieved = !!dream.achievedAt;
  return (
    <Link to={`/dreams/${dream.id}`} className="dh-dream" data-testid="home-dream" data-dream-id={dream.id}>
      <div className="dh-dream-top">
        <div className="grow">
          <div className="dh-eyebrow">{dream.slotLabel}</div>
          <div className="dh-dream-title">{dream.title || <span className="muted">Untitled dream</span>}</div>
        </div>
        <div className="dh-dream-pct tnum" aria-hidden>{dream.progress != null ? `${dream.progress}%` : ''}</div>
      </div>
      <Bar value={dream.progress} label={`${dream.title || 'Dream'} progress`} />
      <div className="dh-dream-meta">
        {achieved && <AchievedChip achievedAt={dream.achievedAt!} />}
        {dream.progressIsPrivate && <span data-testid="home-dream-private"><PrivateChip /></span>}
        {dream.progress == null ? (
          <span>No progress recorded yet</span>
        ) : base ? (
          <SessionDelta value={dream.progress} base={base} suffix=" pts" />
        ) : (
          <span>Updated {fmtDate(dream.progressAt)}</span>
        )}
        <span className="dh-dot" aria-hidden />
        <span>{dream.activeActions ? plural(dream.activeActions, 'active action') : 'No active actions'}</span>
      </div>
    </Link>
  );
}

/** The gold "Achieved · Sep 16" chip, the same on Home, the dreams list and a dream's page. */
export function AchievedChip({ achievedAt, compact }: { achievedAt: string; compact?: boolean }) {
  return (
    <Chip className="dd-achieved" title={`Achieved ${fmtDate(achievedAt, { month: 'long', day: 'numeric', year: 'numeric' })}`}>
      <IconCheck />
      {compact ? 'Achieved' : `Achieved · ${fmtDate(achievedAt)}`}
    </Chip>
  );
}

/* ---------- CARE right now ---------- */

function CareCard({ snapshot, coachName }: { snapshot: Snapshot; coachName: string | null }) {
  const sessions = useSessions('me').data ?? [];
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
        {CARE_CATEGORIES.map((c) => <CareRow key={c} category={c} latest={latest[c]} base={latest[c] ? ratingBaseline(sessions, latest[c]) : null} />)}
      </div>
      <div className="dh-stats">
        {(['commitment', 'satisfaction'] as const).map((c) => {
          const l = latest[c];
          return (
            <div key={c} data-testid={`home-stat-${c}`}>
              <Stat
                label={CATEGORY_META[c].label}
                value={l ? l.value : '—'}
                sub={l ? <span className="dh-stat-sub"><SessionDelta value={l.value} base={ratingBaseline(sessions, l)} /><span>{sourceLabel(l)}</span>{l.isPrivate && <PrivateMark testId={`home-stat-private-${c}`} />}</span> : 'Not rated yet'}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CareRow({ category, latest, base }: { category: CareCategory; latest: LatestRating | undefined; base: Baseline }) {
  const m = CATEGORY_META[category];
  return (
    <Link to={`/care/${category}`} className="dh-care-row" data-testid={`home-care-${category}`} style={{ '--dh-color': m.color, '--dh-tint': m.tint } as CSSProperties}>
      <span className="dh-care-swatch" aria-hidden />
      <span className="grow">
        <span className="dh-care-label">{m.label}</span>
        <span className="dh-care-src">{latest ? sourceLabel(latest) : 'Not rated yet'}</span>
      </span>
      {latest?.isPrivate && <PrivateMark testId={`home-care-private-${category}`} />}
      <span className="dh-care-delta">{latest && <SessionDelta value={latest.value} base={base} />}</span>
      <span className="dh-care-val tnum">{latest ? latest.value : '–'}</span>
    </Link>
  );
}

/** A lock next to a value that comes from one of the dreamer's private entries (only ever set while they are shown). */
export function PrivateMark({ testId }: { testId?: string }) {
  return <span className="dh-private" data-testid={testId}><PrivateChip compact /><span className="sr-only">Private</span></span>;
}

/* ---------- Actions ---------- */

const HOME_ACTION_LIMIT = 5;

function ActionsCard({ dreams }: { dreams: Dream[] }) {
  const actions = useActions('me', 'active');
  const [composing, setComposing] = useState(false);
  const active = actions.data ?? [];
  const shown = active.slice(0, HOME_ACTION_LIMIT);
  // While the list loads again (hiding private entries) an empty list stays empty, and its composer stays put.
  const wasEmpty = useLastKnown(actions.data ? actions.data.length === 0 : undefined);
  const isEmpty = !actions.error && (actions.data ? active.length === 0 : !!wasEmpty);

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
      {/* Stays open if the list empties meanwhile (its Cancel closes it), so what's typed is never dropped. */}
      {composing && (
        <div className="dh-composer" data-testid="home-composer">
          <ActionComposer dreamerRef="me" dreams={dreams} mode="dreamer" autoFocus onDone={() => setComposing(false)} onCancel={() => setComposing(false)} />
        </div>
      )}
      {actions.error && !actions.data ? (
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(actions.error)}</span></div>
      ) : isEmpty ? (
        <>
          <EmptyState icon={<IconList />} title="Nothing on your list right now">
            Add a small step toward one of your dreams — or something you and your coach talked about.
          </EmptyState>
          {!composing && (
            <div className="dh-composer" data-testid="home-composer">
              <ActionComposer dreamerRef="me" dreams={dreams} mode="dreamer" />
            </div>
          )}
        </>
      ) : !actions.data ? (
        <div className="stack" aria-busy>
          <Skeleton h={22} /><Skeleton h={22} w="80%" /><Skeleton h={22} w="60%" />
        </div>
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
  // The first two lines of the notes: the clamp then never lands just after a full stop ("84%.…"), and the
  // whole of them is one click away.
  const notes = lastCompleted ? lastCompleted.notes.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join('\n') : '';

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
          <span>
            A session with {who} is in progress — what you record together shows up as it's saved.{' '}
            <Link to={`/sessions/${snapshot.openSession.id}`} className="dh-open-link" data-testid="home-open-session-link">Follow along <IconArrowRight /></Link>
          </span>
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
          {notes ? (
            <p className="dh-session-notes">{notes}</p>
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
