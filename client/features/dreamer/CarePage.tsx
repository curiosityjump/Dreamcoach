/**
 * CARE · Wheel of Life (/care). The dreamer's own view of the four CARE areas:
 * an interactive wheel (click or drag a quadrant to rate it, then save the
 * check-in), the latest values with deltas and sparklines, quick Commitment and
 * Satisfaction ratings (pick a number, then save), and the four lines over time.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/AuthContext';
import { useCreateCheckIn, useOverview, useRatings, useSessions } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { useToast } from '@/components/toast';
import { Button, Card, CardHead, CategoryChip, Delta, EmptyState, LoadingPage, PageHeader, PrivacyToggle, PrivateChip, RatingInput, Segmented, SourceChip, Spinner, TextArea } from '@/components/ui';
import { MultiTrendChart, Sparkline } from '@/components/charts';
import { WheelOfLife, type WheelValues } from '@/components/WheelOfLife';
import { IconArrowRight, IconChart, IconInfo, IconSparkle, IconWheel } from '@/components/icons';
import { CARE_CATEGORIES, CATEGORY_META, PROGRAM_CATEGORIES, type CareCategory, type ProgramCategory } from '@shared/care';
import type { CheckInInput, CoachingSession, LatestRating, RatingEntry, Snapshot } from '@shared/types';
import { fmtDate, plural, relativeTime } from '@/lib/format';
import { byTimeAsc, catVars, latestLine, savedToast, toTrendPoint, useNarrow } from './CareShared';

type Pending = Partial<Record<CareCategory, number>>;
type Range = '3m' | '6m' | 'all';

const RANGE_DAYS: Record<Range, number | null> = { '3m': 92, '6m': 183, all: null };

/* ---------- Page ---------- */

export function CarePage() {
  const overview = useOverview('me');
  const ratings = useRatings('me');
  const sessions = useSessions('me');

  if (overview.isLoading) return <LoadingPage label="Opening your wheel…" />;
  if (overview.error || !overview.data) {
    return (
      <div className="page">
        <PageHeader eyebrow="CARE" title="Wheel of Life" />
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(overview.error)}</span></div>
      </div>
    );
  }

  const snapshot = overview.data.snapshot;
  const coachName = overview.data.dreamer.coach?.name ?? null;
  const lastSession = [...(sessions.data ?? [])].filter((s) => s.status === 'completed').sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0] ?? null;

  return (
    <div className="page dc-page" data-testid="care-page">
      <PageHeader
        eyebrow="CARE"
        title="Wheel of Life"
        lead="CARE stands for Contribution, Alignment, Relationships and Energy — four areas of a full life, each rated 0–10. Rate any of them whenever you like; your coach adds a reading in each session."
        actions={<Link to="/check-in" className="btn btn-primary" data-testid="care-full-checkin"><IconSparkle /> Full check-in</Link>}
      />

      <WheelSection snapshot={snapshot} lastSession={lastSession} />

      <section className="dc-section" aria-labelledby="dc-areas-head">
        <h2 id="dc-areas-head" className="dc-section-title">The four areas</h2>
        <div className="grid grid-4 dc-cards">
          {CARE_CATEGORIES.map((c) => (
            <CategoryCard key={c} category={c} latest={snapshot.latest[c]} ratings={ratings.data} loading={ratings.isLoading} />
          ))}
        </div>
      </section>

      <section className="dc-section" aria-labelledby="dc-program-head">
        <h2 id="dc-program-head" className="dc-section-title">Commitment and satisfaction</h2>
        <p className="muted small dc-section-sub">Two program ratings, usually set together with {coachName ? coachName.split(' ')[0] : 'your coach'} in a session. Pick a number and save it to record where you are today.</p>
        <div className="grid grid-2 dc-cards">
          {PROGRAM_CATEGORIES.map((c) => (
            <QuickRatingCard key={c} category={c} latest={snapshot.latest[c]} />
          ))}
        </div>
      </section>

      <OverTimeCard ratings={ratings.data} loading={ratings.isLoading} error={ratings.error} />
    </div>
  );
}

/* ---------- Wheel + pending check-in ---------- */

function WheelSection({ snapshot, lastSession }: { snapshot: Snapshot; lastSession: CoachingSession | null }) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const create = useCreateCheckIn('me');
  const narrow = useNarrow(640);

  const [pending, setPending] = useState<Pending>({});
  const [notes, setNotes] = useState<Partial<Record<CareCategory, string>>>({});
  const [priv, setPriv] = useState<Partial<Record<CareCategory, boolean>>>({});
  const [notePriv, setNotePriv] = useState<Partial<Record<CareCategory, boolean>>>({});
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const [panelActions, setPanelActions] = useState<HTMLDivElement | null>(null);
  const [actionsBelow, setActionsBelow] = useState(true);

  // On narrow screens the pending panel sits under the wheel, below the fold. While its Save button is
  // still further down the page, a small bar (shown by CSS only when stacked) keeps the unsaved change visible.
  useEffect(() => {
    if (!panelActions) return;
    const io = new IntersectionObserver(([e]) => setActionsBelow(!!e && !e.isIntersecting && e.boundingClientRect.top > 0), { rootMargin: '0px 0px -64px 0px' });
    io.observe(panelActions);
    return () => io.disconnect();
  }, [panelActions]);

  const latest = snapshot.latest;
  const latestValues = useMemo<WheelValues>(() => Object.fromEntries(CARE_CATEGORIES.map((c) => [c, latest[c]?.value ?? null])) as WheelValues, [latest]);
  const wheelValues = useMemo<WheelValues>(() => ({ ...latestValues, ...pending }), [latestValues, pending]);

  /** Categories whose pending value differs from the latest recorded one. */
  const changed = CARE_CATEGORIES.filter((c) => pending[c] != null && pending[c] !== latestValues[c]);
  const only = changed.length === 1 ? changed[0]! : null;
  const changeSummary = only ? `${CATEGORY_META[only].label} ${latestValues[only] != null ? `${latestValues[only]} → ` : ''}${pending[only]}` : `${plural(changed.length, 'area')} changed`;
  const anyRated = CARE_CATEGORIES.some((c) => latest[c]);

  const compareValues = useMemo<WheelValues | null>(() => {
    if (!lastSession) return null;
    const v: WheelValues = {};
    for (const c of CARE_CATEGORIES) if (lastSession.ratings[c] != null) v[c] = lastSession.ratings[c];
    return Object.keys(v).length ? v : null;
  }, [lastSession]);

  const setValue = (c: CareCategory, v: number) => {
    setError(null);
    setPending((p) => ({ ...p, [c]: v }));
  };
  const undo = (c: CareCategory) => {
    setPending((p) => { const n = { ...p }; delete n[c]; return n; });
  };
  const reset = () => { setPending({}); setNotes({}); setPriv({}); setNotePriv({}); setError(null); };

  const save = () => {
    if (!changed.length || create.isPending) return;
    const input: CheckInInput = {
      ratings: changed.map((c) => {
        const note = notes[c]?.trim();
        return { category: c, value: pending[c]!, isPrivate: !!priv[c], ...(note ? { note, notePrivate: !!notePriv[c] } : {}) };
      }),
    };
    const anyPrivate = input.ratings!.some((r) => r.isPrivate || r.notePrivate);
    create.mutate(input, {
      onSuccess: () => {
        const names = changed.map((c) => CATEGORY_META[c].label);
        const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
        const [msg, kind] = savedToast(auth, anyPrivate, `Check-in saved — ${list} updated.`, `Check-in saved — the private parts are only visible to you.`);
        toast(msg, kind);
        reset();
      },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  return (
    <div className={`dc-wheel-grid${changed.length ? ' has-pending' : ''}`}>
      <Card className="dc-wheel-card" data-testid="care-wheel-card">
        <CardHead
          title="Your wheel right now"
          sub={anyRated ? 'Click or drag inside a quadrant to set a new rating.' : 'Nothing rated yet — click or drag inside a quadrant to begin.'}
        />
        <div className="dc-wheel" data-testid="care-wheel">
          <WheelOfLife
            values={wheelValues}
            compare={compare ? compareValues : null}
            size={narrow ? 300 : 380}
            onChange={setValue}
            showAreas={!narrow}
            valueLabel={compare && compareValues ? 'Now' : undefined}
            compareLabel={lastSession ? `Session ${lastSession.number} · ${fmtDate(lastSession.occurredAt)}` : undefined}
          />
        </div>
        {narrow && (
          <ul className="dc-areas" aria-label="CARE sub-areas">
            {CARE_CATEGORIES.map((c) => (
              <li key={c} style={catVars(c)}><span className="dc-area-dot" aria-hidden /><b>{CATEGORY_META[c].label}</b><span className="muted">{CATEGORY_META[c].areas.join(' · ')}</span></li>
            ))}
          </ul>
        )}
        <div className="dc-wheel-foot">
          {compareValues ? (
            <label className="dc-check">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} data-testid="care-compare-toggle" />
              <span>Compare with last coaching session <span className="muted">(Session {lastSession!.number}, {fmtDate(lastSession!.occurredAt)})</span></span>
            </label>
          ) : (
            <span className="muted small">Once you’ve had a coaching session, you’ll be able to overlay its readings here.</span>
          )}
        </div>
        {changed.length > 0 && actionsBelow && (
          <div className="dc-pending-bar" role="status" data-testid="care-pending-bar">
            <span className="dc-pending-bar-text small">
              <b>Not saved yet</b> · {changeSummary}
            </span>
            <div className="row">
              <Button variant="ghost" onClick={() => sideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} data-testid="care-pending-bar-review">Add a note</Button>
              <Button variant="primary" onClick={save} loading={create.isPending} data-testid="care-pending-bar-save">Save</Button>
            </div>
          </div>
        )}
      </Card>

      <div className="dc-side" ref={sideRef}>
        {changed.length ? (
          <Card className="dc-pending" data-testid="care-pending-panel" aria-live="polite">
            <CardHead title="Save check-in" sub={`${plural(changed.length, 'area')} changed on the wheel. Add a note if you like, then save.`} />
            <div className="dc-pending-list">
              {changed.map((c) => {
                const m = CATEGORY_META[c];
                const prev = latestValues[c];
                const note = notes[c] ?? '';
                return (
                  <div key={c} className="dc-pending-item" style={catVars(c)} data-testid={`care-pending-${c}`}>
                    <div className="spread">
                      <div className="row-wrap">
                        <CategoryChip category={c} />
                        <span className="small muted tnum">{prev != null ? `${prev} → ` : ''}<b className="dc-pending-value">{pending[c]}</b></span>
                      </div>
                      <button type="button" className="dc-text-btn" onClick={() => undo(c)} data-testid={`care-pending-undo-${c}`}>{prev != null ? `Keep at ${prev}` : 'Remove'}</button>
                    </div>
                    <RatingInput value={pending[c] ?? null} onChange={(v) => { if (v != null) setValue(c, v); }} category={c} compact />
                    <TextArea
                      value={note}
                      onChange={(e) => setNotes((n) => ({ ...n, [c]: e.target.value }))}
                      placeholder={`A note about your ${m.label.toLowerCase()} (optional)`}
                      aria-label={`${m.label} note`}
                      rows={2}
                      maxLength={4000}
                      disabled={create.isPending}
                      data-testid={`care-pending-note-${c}`}
                    />
                    <div className="row-wrap dc-privacy-row">
                      <span data-testid={`care-pending-privacy-${c}`}><PrivacyToggle size="sm" value={!!priv[c]} onChange={(v) => setPriv((p) => ({ ...p, [c]: v }))} labels={['Rating shared with coach', 'Rating private']} /></span>
                      {note.trim() && (
                        <span data-testid={`care-pending-note-privacy-${c}`}><PrivacyToggle size="sm" value={!!notePriv[c]} onChange={(v) => setNotePriv((p) => ({ ...p, [c]: v }))} labels={['Note shared with coach', 'Note private']} /></span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {error && <div className="callout callout-muted" role="alert"><IconInfo /><span>{error}</span></div>}
            <div className="dc-pending-actions" ref={setPanelActions}>
              <Button variant="ghost" onClick={reset} disabled={create.isPending} data-testid="care-pending-cancel">Cancel</Button>
              <Button variant="primary" onClick={save} loading={create.isPending} data-testid="care-pending-save">Save check-in</Button>
            </div>
          </Card>
        ) : (
          <Card soft className="dc-hint" data-testid="care-wheel-hint">
            <div className="dc-hint-icon"><IconWheel /></div>
            <h3>Rate right on the wheel</h3>
            <p className="muted small">
              Click or drag inside any quadrant — the closer to the edge, the higher the rating. Changed areas appear here so you can add a note and choose what to share before saving.
            </p>
            {anyRated && (
              <p className="muted small">
                Latest readings: {CARE_CATEGORIES.filter((c) => latest[c]).map((c) => `${CATEGORY_META[c].label} ${latest[c]!.value}${latest[c]!.isPrivate ? ' (private)' : ''}`).join(' · ')}.
              </p>
            )}
            <Link to="/check-in" className="dc-link" data-testid="care-hint-checkin">Prefer a form? Open the full check-in <IconArrowRight /></Link>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------- Category cards ---------- */

function CategoryCard({ category, latest, ratings, loading }: { category: CareCategory; latest: LatestRating | undefined; ratings: RatingEntry[] | undefined; loading: boolean }) {
  const m = CATEGORY_META[category];
  const values = useMemo(() => (ratings ?? []).filter((r) => r.category === category).sort(byTimeAsc).slice(-10).map((r) => r.value), [ratings, category]);
  const delta = latest && latest.previous != null ? latest.value - latest.previous : null;
  return (
    <Card className="dc-cat-card" style={catVars(category)} data-testid={`care-card-${category}`}>
      <div className="spread">
        <CategoryChip category={category} />
        {latest && <SourceChip source={latest.source} />}
      </div>
      <div className="dc-cat-value-row">
        <span className="dc-cat-value tnum" data-testid={`care-card-value-${category}`}>{latest ? latest.value : '–'}</span>
        <span className="dc-cat-of">/ 10</span>
        {latest && <span className="dc-cat-delta"><Delta value={delta} digits={0} /></span>}
        {latest?.isPrivate && <span className="dc-cat-private" data-testid={`care-card-private-${category}`}><PrivateChip /></span>}
      </div>
      <div className="dc-cat-meta muted small">
        {latest ? `${latest.source === 'session' ? 'Session' : 'Self check-in'} · ${relativeTime(latest.occurredAt)}` : 'Not rated yet'}
      </div>
      <div className="dc-cat-spark" aria-label={values.length >= 2 ? `Last ${values.length} ${m.label} ratings` : undefined}>
        {loading ? <Spinner /> : values.length >= 2 ? <Sparkline values={values} color={m.color} width={120} height={28} max={10} /> : <span className="muted tiny">{values.length === 1 ? 'One entry so far' : 'No entries yet'}</span>}
        {values.length >= 2 && <span className="muted tiny">last {values.length}</span>}
      </div>
      <div className="dc-cat-areas muted tiny">{m.areas.join(' · ')}</div>
      <Link to={`/care/${category}`} className="dc-link dc-cat-link" data-testid={`care-card-history-${category}`}>History <IconArrowRight /></Link>
    </Card>
  );
}

/** Commitment / Satisfaction: picking a number starts a draft; nothing is recorded until Save. */
function QuickRatingCard({ category, latest }: { category: ProgramCategory; latest: LatestRating | undefined }) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const create = useCreateCheckIn('me');
  const m = CATEGORY_META[category];
  const delta = latest && latest.previous != null ? latest.value - latest.previous : null;
  const [value, setValue] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [priv, setPriv] = useState(false);
  const [notePriv, setNotePriv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = note.trim();

  const pick = (v: number | null) => { if (v != null) { setError(null); setValue(v); } };
  const reset = () => { setValue(null); setNote(''); setPriv(false); setNotePriv(false); setError(null); };

  const save = () => {
    if (value == null || create.isPending) return;
    const anyPrivate = priv || (!!text && notePriv);
    create.mutate({ ratings: [{ category, value, isPrivate: priv, ...(text ? { note: text, notePrivate: notePriv } : {}) }] }, {
      onSuccess: () => {
        const [msg, kind] = savedToast(auth, anyPrivate, `${m.label} saved: ${value}.`, `${m.label} saved as private — only you can see it.`);
        toast(msg, kind);
        reset();
      },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  return (
    <Card className="dc-quick-card" style={catVars(category)} data-testid={`care-quick-${category}`}>
      <div className="spread">
        <CategoryChip category={category} />
        <Link to={`/care/${category}`} className="dc-link" data-testid={`care-quick-history-${category}`}>History <IconArrowRight /></Link>
      </div>
      <p className="dc-quick-prompt">{m.prompt}</p>
      <div className="dc-cat-value-row">
        <span className="dc-cat-value tnum" data-testid={`care-quick-value-${category}`}>{latest ? latest.value : '–'}</span>
        <span className="dc-cat-of">/ 10</span>
        {latest && <span className="dc-cat-delta"><Delta value={delta} digits={0} /></span>}
        {latest?.isPrivate && <span className="dc-cat-private" data-testid={`care-quick-private-${category}`}><PrivateChip /></span>}
        <span className="muted small dc-quick-when">{latest ? latestLine(latest) : 'Not rated yet'}</span>
      </div>
      <div className={`dc-quick-input${create.isPending ? ' is-busy' : ''}`} aria-busy={create.isPending || undefined} data-testid={`care-quick-input-${category}`}>
        <RatingInput value={value ?? latest?.value ?? null} onChange={pick} category={category} compact label={`Rate your ${m.label.toLowerCase()} today`} disabled={create.isPending} />
      </div>
      {value == null ? (
        <div className="muted tiny">Pick a number for today — you can add a note before you save it.</div>
      ) : (
        <div className="dc-quick-draft" data-testid={`care-quick-draft-${category}`}>
          <div className="small tnum">{latest ? `${latest.value} → ` : ''}<b>{value}</b> <span className="muted">· not saved yet</span></div>
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What’s behind this number? (optional)" aria-label={`${m.label} note`} rows={2} maxLength={4000} disabled={create.isPending} data-testid={`care-quick-note-${category}`} />
          <div className="row-wrap dc-privacy-row">
            <span data-testid={`care-quick-privacy-${category}`}><PrivacyToggle size="sm" value={priv} onChange={setPriv} labels={['Rating shared with coach', 'Rating private']} /></span>
            {text && <span data-testid={`care-quick-note-privacy-${category}`}><PrivacyToggle size="sm" value={notePriv} onChange={setNotePriv} labels={['Note shared with coach', 'Note private']} /></span>}
          </div>
          {error && <div className="callout callout-muted" role="alert"><IconInfo /><span>{error}</span></div>}
          <div className="dc-pending-actions">
            <Button variant="ghost" onClick={reset} disabled={create.isPending} data-testid={`care-quick-cancel-${category}`}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={create.isPending} data-testid={`care-quick-save-${category}`}>Save {m.label.toLowerCase()}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- Over time ---------- */

function OverTimeCard({ ratings, loading, error }: { ratings: RatingEntry[] | undefined; loading: boolean; error: unknown }) {
  const [range, setRange] = useState<Range>('all');
  const series = useMemo(() => {
    const days = RANGE_DAYS[range];
    const cutoff = days ? Date.now() - days * 86400000 : null;
    return CARE_CATEGORIES.map((c) => ({
      category: c,
      points: (ratings ?? []).filter((r) => r.category === c && (cutoff == null || new Date(r.occurredAt).getTime() >= cutoff)).sort(byTimeAsc).map(toTrendPoint),
    }));
  }, [ratings, range]);
  const total = series.reduce((n, s) => n + s.points.length, 0);
  const careTotal = (ratings ?? []).filter((r) => CARE_CATEGORIES.includes(r.category as CareCategory)).length;

  return (
    <Card className="dc-section" data-testid="care-over-time">
      <CardHead
        title="Over time"
        sub="All four CARE areas on one 0–10 scale, from coaching sessions and self check-ins alike."
        actions={careTotal > 0 && <Segmented value={range} onChange={setRange} ariaLabel="Time range" options={[{ value: '3m', label: '3 months' }, { value: '6m', label: '6 months' }, { value: 'all', label: 'All' }]} />}
      />
      {loading ? (
        <div className="loading-page" style={{ minHeight: 200 }}><Spinner /> <span>Loading your history…</span></div>
      ) : error ? (
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(error)}</span></div>
      ) : careTotal === 0 ? (
        <EmptyState icon={<IconChart />} title="Your trends will appear here" action={<Link to="/check-in" className="btn btn-primary">Check in</Link>}>
          Rate an area on the wheel above or make a full check-in — each entry becomes a point on these lines.
        </EmptyState>
      ) : total === 0 ? (
        <EmptyState icon={<IconChart />} title="Nothing in this range yet">Try a longer range, or rate an area on the wheel to add today’s point.</EmptyState>
      ) : (
        <>
          <MultiTrendChart series={series} height={280} />
          <p className="muted tiny dc-chart-note">Every point here is one rating. Open a category’s history to see coaching sessions (solid) and self check-ins (hollow) told apart, with the notes behind each point.</p>
        </>
      )}
    </Card>
  );
}
