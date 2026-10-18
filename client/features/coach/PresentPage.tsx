/**
 * Presentation view for screen sharing during a one-on-one (BareShell: no nav).
 * Big, calm, legible: the CARE wheel today vs. last session, the four dreams with
 * progress bars and deltas, CARE trend lines across sessions, and Commitment &
 * Satisfaction. Polls the session so edits made in the workspace tab appear live.
 *
 * Only coaching-session values are shown here (self check-ins live elsewhere), and
 * the server returns only what the coach may see — nothing is filtered client-side.
 */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CARE_CATEGORIES, CATEGORY_META } from '@shared/care';
import type { CoachingSession, SessionGrid } from '@shared/types';
import { useOverview, useSession } from '@/api/hooks';
import { errorMessage, get } from '@/api/client';
import { sessionPath } from '@/app/routes';
import { WheelOfLife, type WheelValues } from '@/components/WheelOfLife';
import { MultiTrendChart, type TrendPoint } from '@/components/charts';
import { Bar, Delta, LoadingPage, Stat } from '@/components/ui';
import { IconArrowLeft, IconBrand, IconInfo } from '@/components/icons';
import { dayKey, firstName, fmtDate, fmtMonthLong, fmtTime } from '@/lib/format';

const POLL_MS = 4000;

export function PresentPage() {
  const params = useParams();
  const id = Number(params.dreamerId);
  const sid = Number(params.sessionId);
  const valid = Number.isInteger(id) && id > 0 && Number.isInteger(sid) && sid > 0;

  const overview = useOverview(id, { enabled: valid });
  const session = useSession(id, valid ? sid : null, { refetchInterval: POLL_MS });
  // Same key as useGrid so the cache is shared; this observer just polls while the slide is open.
  const grid = useQuery<SessionGrid>({ queryKey: ['dreamer', id, 'grid'], queryFn: () => get(`/dreamers/${id}/grid`), enabled: valid, refetchInterval: POLL_MS });

  const s = session.data;
  const sessions = grid.data?.sessions ?? [];
  const dreams = useMemo(() => [...(grid.data?.dreams ?? [])].sort((a, b) => a.slot - b.slot), [grid.data?.dreams]);

  const previous = useMemo<CoachingSession | null>(() => {
    if (!s) return null;
    const idx = sessions.findIndex((x) => x.id === s.id);
    const before = (idx >= 0 ? sessions.slice(0, idx) : sessions.filter((x) => x.id !== s.id)).filter((x) => x.status === 'completed');
    return before[before.length - 1] ?? null;
  }, [sessions, s]);

  const todayWheel = useMemo<WheelValues>(() => (s ? Object.fromEntries(CARE_CATEGORIES.map((c) => [c, s.ratings[c] ?? null])) : {}), [s]);
  const lastWheel = useMemo<WheelValues | null>(() => (previous ? Object.fromEntries(CARE_CATEGORIES.map((c) => [c, previous.ratings[c] ?? null])) : null), [previous]);

  // Trend across the completed sessions up to this one, plus this one's column as it fills in.
  // Presenting an older session stops the lines there: nothing from later sessions.
  const series = useMemo(
    () => {
      const idx = sessions.findIndex((x) => x.id === sid);
      const upTo = idx >= 0 ? sessions.slice(0, idx + 1) : sessions;
      return CARE_CATEGORIES.map((category) => ({
        category,
        points: upTo
          .filter((x) => x.status === 'completed' || x.id === sid)
          .filter((x) => x.ratings[category] != null)
          .map((x): TrendPoint => ({ at: x.occurredAt, value: x.ratings[category]!, source: 'session', label: `Session ${x.number}` })),
      }));
    },
    [sessions, sid],
  );
  const hasTrend = series.some((x) => x.points.length > 1);

  if (!valid) {
    return (
      <div className="csp-page">
        <div className="callout callout-muted"><IconInfo /><span>That session link doesn’t look right. <Link to="/coach">Back to my dreamers</Link></span></div>
      </div>
    );
  }
  if (overview.isLoading || session.isLoading || grid.isLoading) return <LoadingPage label="Preparing the presentation…" />;
  const err = session.error ?? overview.error ?? grid.error;
  if (err || !s || !overview.data) {
    return (
      <div className="csp-page">
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{err ? errorMessage(err) : 'Session not found.'} <Link to="/coach">Back to my dreamers</Link></span></div>
      </div>
    );
  }

  const dreamer = overview.data.dreamer;
  const delta = (now: number | null | undefined, prev: number | null | undefined) => (now == null || prev == null ? null : now - prev);
  // Presenting an earlier session shows that session's values, not "today's".
  const isToday = dayKey(s.occurredAt) === dayKey(new Date().toISOString());

  return (
    <div className="csp-page" data-testid="present-page">
      <header className="csp-top">
        <Link to={sessionPath(id, sid)} className="csp-back" data-testid="present-back"><IconArrowLeft /> Back to workspace</Link>
        <span className="csp-date tnum">{fmtDate(s.occurredAt, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · {fmtTime(s.occurredAt)}</span>
        <span className="csp-brand"><span className="brand-mark"><IconBrand /></span>Dream Coach</span>
      </header>

      <div className="csp-title-row">
        <h1 className="csp-title" data-testid="present-title">{firstName(dreamer.name)}</h1>
        <div className="csp-subtitle">Session {s.number} · {fmtMonthLong(s.occurredAt)}</div>
      </div>

      <main className="csp-grid">
        <section className="csp-panel csp-wheel" aria-label="CARE wheel">
          <h2 className="csp-h2">{isToday ? 'CARE today' : `CARE at Session ${s.number}`}</h2>
          <WheelOfLife
            values={todayWheel}
            compare={lastWheel}
            size={440}
            valueLabel={isToday ? 'Today' : `Session ${s.number}`}
            compareLabel={previous ? (isToday ? `Last session (S${previous.number})` : `Session ${previous.number}`) : undefined}
          />
          <ul className="csp-care-list" data-testid="present-care">
            {CARE_CATEGORIES.map((c) => {
              const now = s.ratings[c] ?? null;
              const prev = previous?.ratings[c] ?? null;
              return (
                <li key={c} className="csp-care-item" style={{ '--csp-color': CATEGORY_META[c].color, '--csp-tint': CATEGORY_META[c].tint } as React.CSSProperties}>
                  <span className="csp-care-dot" aria-hidden />
                  <span className="csp-care-label">{CATEGORY_META[c].label}</span>
                  <span className="csp-care-val tnum">{now ?? '–'}</span>
                  <Delta value={delta(now, prev)} digits={0} />
                </li>
              );
            })}
          </ul>
        </section>

        <section className="csp-panel csp-dreams" aria-label="Dreams">
          <h2 className="csp-h2">Dreams</h2>
          <ul className="csp-dream-list" data-testid="present-dreams">
            {dreams.map((d) => {
              const now = s.progress[d.id] ?? null;
              const prev = previous?.progress[d.id] ?? null;
              return (
                <li key={d.id} className="csp-dream" data-testid="present-dream">
                  <div className="csp-dream-head">
                    <div className="csp-dream-text">
                      <span className="csp-dream-slot">{d.slotLabel}</span>
                      <span className="csp-dream-title">{d.title}</span>
                    </div>
                    <div className="csp-dream-num">
                      <span className="csp-dream-pct tnum">{now == null ? '–' : `${now}%`}</span>
                      {/* Until this session's value is in, the bar stays empty and last session's value is named as such. */}
                      {now == null && prev != null && previous
                        ? <span className="csp-dream-was tnum" data-testid="present-dream-was">S{previous.number}: {prev}%</span>
                        : <Delta value={delta(now, prev)} digits={0} suffix=" pts" />}
                    </div>
                  </div>
                  <Bar value={now} color="var(--gold)" large label={`${d.title} progress ${isToday ? 'today' : `in Session ${s.number}`}`} />
                </li>
              );
            })}
          </ul>
        </section>

        <section className="csp-panel csp-trend" aria-label="CARE over time">
          <h2 className="csp-h2">CARE over the program</h2>
          {hasTrend ? (
            <MultiTrendChart series={series} height={280} />
          ) : (
            <div className="csp-trend-empty muted">Trend lines appear once there are two sessions to compare.</div>
          )}
        </section>

        <section className="csp-panel csp-program" aria-label="Commitment and satisfaction">
          <h2 className="csp-h2">Commitment & satisfaction</h2>
          <div className="csp-stats" data-testid="present-stats">
            <Stat label="Commitment" value={s.ratings.commitment ?? '–'} delta={delta(s.ratings.commitment, previous?.ratings.commitment)} sub={previous ? `was ${previous.ratings.commitment ?? '–'}` : 'first session'} />
            <Stat label="Satisfaction" value={s.ratings.satisfaction ?? '–'} delta={delta(s.ratings.satisfaction, previous?.ratings.satisfaction)} sub={previous ? `was ${previous.ratings.satisfaction ?? '–'}` : 'first session'} />
          </div>
          {s.focus && (
            <div className="csp-focus" data-testid="present-focus">
              <span className="csp-focus-eyebrow">Focus</span>
              <span className="csp-focus-text">{s.focus}</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
