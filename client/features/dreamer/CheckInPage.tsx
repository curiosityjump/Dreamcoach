/**
 * Self check-in (/check-in). Rate any subset of the CARE areas (plus Commitment
 * and Satisfaction), update progress on any dream, and write an overall
 * reflection — each piece with its own privacy. One save creates one check-in.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthContext';
import { useCreateCheckIn, useDreams, useOverview } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { useToast } from '@/components/toast';
import { Bar, Button, Card, CategoryChip, LoadingPage, PageHeader, PercentInput, PrivacyToggle, PrivateChip, RatingInput, TextArea } from '@/components/ui';
import { IconCalendar, IconInfo, IconStar, IconX } from '@/components/icons';
import { CARE_CATEGORIES, CATEGORY_META, PROGRAM_CATEGORIES, isRatingCategory, type RatingCategory } from '@shared/care';
import type { CheckInInput, Dream, LatestRating } from '@shared/types';
import { fmtDate, fromLocalInputValue, plural, toLocalInputValue } from '@/lib/format';
import { NotePrivateWith, catVars, savedToast } from './CareShared';

interface RatingDraft { value: number | null; note: string; isPrivate: boolean; notePrivate: boolean }
interface ProgressDraft { value: number; note: string; isPrivate: boolean; notePrivate: boolean }

const emptyRating = (): RatingDraft => ({ value: null, note: '', isPrivate: false, notePrivate: false });

function fromQuery(params: URLSearchParams): RatingCategory[] {
  return (params.get('category') ?? '').split(',').map((s) => s.trim()).filter(isRatingCategory);
}

/* ---------- Page ---------- */

export function CheckInPage() {
  const overview = useOverview('me');
  const dreams = useDreams('me');

  if (overview.isLoading || dreams.isLoading) return <LoadingPage label="Getting ready…" />;
  if (overview.error || !overview.data) {
    return (
      <div className="page page-narrow">
        <PageHeader eyebrow="Self check-in" title="Check in" />
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(overview.error)}</span></div>
      </div>
    );
  }
  return <CheckInForm latest={overview.data.snapshot.latest} dreams={dreams.data ?? overview.data.snapshot.dreams} />;
}

function CheckInForm({ latest, dreams }: { latest: Partial<Record<RatingCategory, LatestRating>>; dreams: Dream[] }) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const create = useCreateCheckIn('me');

  const [selected, setSelected] = useState<RatingCategory[]>(() => fromQuery(params));
  const [ratings, setRatings] = useState<Partial<Record<RatingCategory, RatingDraft>>>(() => Object.fromEntries(fromQuery(params).map((c) => [c, emptyRating()])));
  const [selectedDreams, setSelectedDreams] = useState<number[]>(() => {
    const id = Number(params.get('dream'));
    return id && dreams.some((d) => d.id === id) ? [id] : [];
  });
  const [progress, setProgress] = useState<Record<number, ProgressDraft>>(() => {
    const id = Number(params.get('dream'));
    const d = dreams.find((x) => x.id === id);
    return d ? { [d.id]: { value: d.progress ?? 0, note: '', isPrivate: false, notePrivate: false } } : {};
  });
  const [reflection, setReflection] = useState('');
  const [reflectionPrivate, setReflectionPrivate] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [when, setWhen] = useState(() => toLocalInputValue(new Date().toISOString()));
  const [error, setError] = useState<string | null>(null);

  const sortedDreams = useMemo(() => [...dreams].sort((a, b) => a.slot - b.slot), [dreams]);

  const toggleCategory = (c: RatingCategory) => {
    setError(null);
    setSelected((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
    setRatings((r) => (r[c] ? r : { ...r, [c]: emptyRating() }));
  };
  const toggleDream = (d: Dream) => {
    setError(null);
    setSelectedDreams((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]));
    setProgress((p) => (p[d.id] ? p : { ...p, [d.id]: { value: d.progress ?? 0, note: '', isPrivate: false, notePrivate: false } }));
  };
  const setRating = (c: RatingCategory, patch: Partial<RatingDraft>) => setRatings((r) => ({ ...r, [c]: { ...(r[c] ?? emptyRating()), ...patch } }));
  const setProg = (id: number, patch: Partial<ProgressDraft>) => setProgress((p) => ({ ...p, [id]: { ...p[id]!, ...patch } }));

  const orderedSelected = [...CARE_CATEGORIES, ...PROGRAM_CATEGORIES].filter((c) => selected.includes(c));
  const completeRatings = orderedSelected.filter((c) => ratings[c]?.value != null);
  const incompleteRatings = orderedSelected.filter((c) => ratings[c]?.value == null);
  const chosenDreams = sortedDreams.filter((d) => selectedDreams.includes(d.id));
  const reflectionText = reflection.trim();
  const dateChanged = when !== toLocalInputValue(new Date().toISOString()).slice(0, 16) && showDate;
  const canSave = (completeRatings.length > 0 || chosenDreams.length > 0 || reflectionText.length > 0) && !create.isPending;

  const summary = [
    completeRatings.length ? `${completeRatings.length} rating${completeRatings.length === 1 ? '' : 's'}` : null,
    chosenDreams.length ? `${chosenDreams.length} dream update${chosenDreams.length === 1 ? '' : 's'}` : null,
    reflectionText ? 'a reflection' : null,
  ].filter(Boolean);
  const summaryLine = summary.length <= 1 ? summary.join('') : `${summary.slice(0, -1).join(', ')} and ${summary[summary.length - 1]}`;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSave) return;
    setError(null);
    const input: CheckInInput = {};
    if (completeRatings.length) {
      input.ratings = completeRatings.map((c) => {
        const r = ratings[c]!;
        const note = r.note.trim();
        // A note on a private rating or progress update is private too.
        return { category: c, value: r.value!, isPrivate: r.isPrivate, ...(note ? { note, notePrivate: r.notePrivate || r.isPrivate } : {}) };
      });
    }
    if (chosenDreams.length) {
      input.progress = chosenDreams.map((d) => {
        const p = progress[d.id]!;
        const note = p.note.trim();
        return { dreamId: d.id, value: p.value, isPrivate: p.isPrivate, ...(note ? { note, notePrivate: p.notePrivate || p.isPrivate } : {}) };
      });
    }
    if (reflectionText) input.reflection = { body: reflectionText, isPrivate: reflectionPrivate };
    if (dateChanged) {
      const iso = fromLocalInputValue(when);
      if (Number.isNaN(new Date(iso).getTime())) { setError('That date doesn’t look right.'); return; }
      input.occurredAt = iso;
    }
    const anyPrivate =
      (input.ratings ?? []).some((r) => r.isPrivate || r.notePrivate) ||
      (input.progress ?? []).some((p) => p.isPrivate || p.notePrivate) ||
      !!input.reflection?.isPrivate;
    // Every part private (a private rating or update takes its note with it), or only some of them?
    const allPrivate =
      (input.ratings ?? []).every((r) => r.isPrivate) &&
      (input.progress ?? []).every((p) => p.isPrivate) &&
      (!input.reflection || input.reflection.isPrivate);
    create.mutate(input, {
      onSuccess: () => {
        const [msg, kind] = savedToast(auth, anyPrivate, 'Check-in saved.', 'Check-in saved — the private parts are only visible to you.', allPrivate ? undefined : 'Check-in saved — the private parts are hidden right now.');
        toast(msg, kind);
        nav('/home');
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const cancel = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1);
    else nav('/home');
  };

  return (
    <form className="page page-narrow dc-page dci-page" onSubmit={submit} data-testid="checkin-page" aria-busy={create.isPending || undefined}>
      <PageHeader eyebrow="Self check-in" title="Check in" lead="Rate whatever you’d like today — one area or all of them. Add a note where it helps, and choose what to share with your coach." />

      <Card className="dci-picker" data-testid="checkin-picker">
        <div className="dci-pick-group">
          <div className="dci-pick-label">CARE</div>
          <div className="dci-chips" role="group" aria-label="CARE areas">
            {CARE_CATEGORIES.map((c) => (
              <PickChip key={c} selected={selected.includes(c)} onClick={() => toggleCategory(c)} style={catVars(c)} testId={`checkin-pick-${c}`}>
                <span className="dci-pick-dot" aria-hidden />{CATEGORY_META[c].label}
              </PickChip>
            ))}
          </div>
        </div>
        <div className="dci-pick-group">
          <div className="dci-pick-label">More</div>
          <div className="dci-chips" role="group" aria-label="Program ratings">
            {PROGRAM_CATEGORIES.map((c) => (
              <PickChip key={c} selected={selected.includes(c)} onClick={() => toggleCategory(c)} style={catVars(c)} testId={`checkin-pick-${c}`}>
                <span className="dci-pick-dot" aria-hidden />{CATEGORY_META[c].label}
              </PickChip>
            ))}
          </div>
        </div>
        {sortedDreams.length > 0 && (
          <div className="dci-pick-group">
            <div className="dci-pick-label">Dream progress</div>
            <div className="dci-chips" role="group" aria-label="Dreams">
              {sortedDreams.map((d) => (
                <PickChip key={d.id} selected={selectedDreams.includes(d.id)} onClick={() => toggleDream(d)} title={`${d.slotLabel} · ${d.title}`} testId={`checkin-pick-dream-${d.id}`}>
                  <IconStar /><span className="dci-pick-text">{d.title}</span>
                </PickChip>
              ))}
            </div>
          </div>
        )}
      </Card>

      {orderedSelected.length === 0 && chosenDreams.length === 0 && (
        <p className="muted small dci-nudge" data-testid="checkin-nudge">Pick an area or a dream above, or just write a reflection below — anything counts as a check-in.</p>
      )}

      <div className="dci-cards">
        {orderedSelected.map((c) => (
          <RatingCard key={c} category={c} draft={ratings[c] ?? emptyRating()} last={latest[c]} onChange={(patch) => setRating(c, patch)} onRemove={() => toggleCategory(c)} disabled={create.isPending} />
        ))}
        {chosenDreams.map((d) => (
          <ProgressCard key={d.id} dream={d} draft={progress[d.id]!} onChange={(patch) => setProg(d.id, patch)} onRemove={() => toggleDream(d)} disabled={create.isPending} />
        ))}

        <Card className="dci-card dci-reflection" data-testid="checkin-reflection-card">
          <div className="dci-card-head">
            <div>
              <h3>Anything else on your mind?</h3>
              <div className="muted small">An overall reflection for today. Optional.</div>
            </div>
          </div>
          <TextArea value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="What’s on your mind today?" aria-label="Reflection" rows={3} maxLength={8000} disabled={create.isPending} data-testid="checkin-reflection" />
          <div className="row-wrap dc-privacy-row">
            <span data-testid="checkin-reflection-privacy"><PrivacyToggle size="sm" value={reflectionPrivate} onChange={setReflectionPrivate} labels={['Reflection shared with coach', 'Reflection private']} /></span>
          </div>
        </Card>

        <div className="dci-date">
          {showDate ? (
            <div className="dci-date-row">
              <label htmlFor="checkin-when" className="field-label"><IconCalendar /> Date and time</label>
              <input id="checkin-when" type="datetime-local" value={when} max={toLocalInputValue(new Date().toISOString())} onChange={(e) => setWhen(e.target.value)} disabled={create.isPending} data-testid="checkin-date" />
              <button type="button" className="dc-text-btn" onClick={() => { setShowDate(false); setWhen(toLocalInputValue(new Date().toISOString())); }}>Use now</button>
            </div>
          ) : (
            <button type="button" className="dc-text-btn" onClick={() => setShowDate(true)} data-testid="checkin-date-toggle"><IconCalendar /> This happened earlier? Set a date</button>
          )}
        </div>
      </div>

      {error && <div className="callout callout-muted" role="alert" data-testid="checkin-error"><IconInfo /><span>{error}</span></div>}

      <div className="dci-footer" data-testid="checkin-footer">
        <div className="dci-footer-text muted small">
          {canSave || create.isPending
            ? <>Saving {summaryLine}{dateChanged ? ` · dated ${fmtDate(fromLocalInputValue(when))}` : ''}{incompleteRatings.length ? ` · ${incompleteRatings.map((c) => CATEGORY_META[c].label).join(', ')} still need${incompleteRatings.length === 1 ? 's' : ''} a number` : ''}</>
            : incompleteRatings.length
              ? <>Choose a number for {incompleteRatings.map((c) => CATEGORY_META[c].label).join(', ')} to save</>
              : <>Nothing to save yet</>}
        </div>
        <div className="row">
          <Button variant="ghost" onClick={cancel} disabled={create.isPending} data-testid="checkin-cancel">Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSave} loading={create.isPending} data-testid="checkin-save">Save check-in</Button>
        </div>
      </div>
    </form>
  );
}

/* ---------- Pieces ---------- */

function PickChip({ selected, onClick, children, style, title, testId }: { selected: boolean; onClick: () => void; children: React.ReactNode; style?: React.CSSProperties; title?: string; testId: string }) {
  return (
    <button type="button" className="dci-pick" aria-pressed={selected} onClick={onClick} style={style} title={title} data-testid={testId}>
      {children}
    </button>
  );
}

function RatingCard({ category, draft, last, onChange, onRemove, disabled }: {
  category: RatingCategory;
  draft: RatingDraft;
  last: LatestRating | undefined;
  onChange: (patch: Partial<RatingDraft>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const m = CATEGORY_META[category];
  const hasNote = draft.note.trim().length > 0;
  return (
    <Card className="dci-card" style={catVars(category)} data-testid={`checkin-card-${category}`}>
      <div className="dci-card-head">
        <div>
          <div className="row-wrap">
            <CategoryChip category={category} />
            <span className="muted small tnum" data-testid={`checkin-last-${category}`}>
              {last ? `Last: ${last.value} · ${fmtDate(last.occurredAt)} · ${last.source === 'session' ? 'session' : 'self check-in'}` : 'Not rated yet'}
            </span>
            {last?.isPrivate && <span data-testid={`checkin-last-private-${category}`}><PrivateChip /></span>}
          </div>
          <div className="dci-prompt">{m.prompt}</div>
        </div>
        <Button variant="ghost" icon size="sm" aria-label={`Remove ${m.label}`} onClick={onRemove} disabled={disabled} data-testid={`checkin-remove-${category}`}><IconX /></Button>
      </div>
      <RatingInput value={draft.value} onChange={(v) => onChange({ value: v })} category={category} label={`${m.label} rating`} />
      <div className="row-wrap dci-under">
        {draft.value == null ? (
          <span className="muted small">Choose a number from 0 to 10.{last ? ' ' : ''}{last && <button type="button" className="dc-text-btn" onClick={() => onChange({ value: last.value })} disabled={disabled} data-testid={`checkin-keep-${category}`}>Same as last ({last.value})</button>}</span>
        ) : (
          <span className="small tnum"><b>{draft.value}</b>{last ? <span className="muted"> · {draft.value === last.value ? 'same as last time' : `${draft.value > last.value ? '+' : '−'}${Math.abs(draft.value - last.value)} since ${fmtDate(last.occurredAt)}`}</span> : null}</span>
        )}
      </div>
      <TextArea value={draft.note} onChange={(e) => onChange({ note: e.target.value })} placeholder="Add a note (optional)" aria-label={`${m.label} note`} rows={2} maxLength={4000} disabled={disabled} data-testid={`checkin-note-${category}`} />
      <div className="row-wrap dc-privacy-row">
        <span data-testid={`checkin-privacy-${category}`}><PrivacyToggle size="sm" value={draft.isPrivate} onChange={(v) => onChange({ isPrivate: v })} labels={['Rating shared with coach', 'Rating private']} /></span>
        {hasNote && <span data-testid={`checkin-note-privacy-${category}`}>{draft.isPrivate ? <NotePrivateWith parent="rating" /> : <PrivacyToggle size="sm" value={draft.notePrivate} onChange={(v) => onChange({ notePrivate: v })} labels={['Note shared with coach', 'Note private']} />}</span>}
      </div>
    </Card>
  );
}

function ProgressCard({ dream, draft, onChange, onRemove, disabled }: {
  dream: Dream;
  draft: ProgressDraft;
  onChange: (patch: Partial<ProgressDraft>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const hasNote = draft.note.trim().length > 0;
  const diff = dream.progress != null ? draft.value - dream.progress : null;
  return (
    <Card className="dci-card dci-dream" data-testid={`checkin-dream-${dream.id}`}>
      <div className="dci-card-head">
        <div className="grow">
          <div className="dc-eyebrow">{dream.slotLabel}</div>
          <h3 className="dci-dream-title">{dream.title}</h3>
          <div className="row-wrap">
            <span className="muted small tnum">{dream.progress != null ? `Now ${dream.progress}%${dream.progressAt ? ` · ${fmtDate(dream.progressAt)}` : ''}` : 'No progress recorded yet'}</span>
            {dream.progressIsPrivate && <span data-testid={`checkin-dream-private-${dream.id}`}><PrivateChip /></span>}
          </div>
        </div>
        <Button variant="ghost" icon size="sm" aria-label={`Remove ${dream.title}`} onClick={onRemove} disabled={disabled} data-testid={`checkin-remove-dream-${dream.id}`}><IconX /></Button>
      </div>
      <Bar value={draft.value} large label={`${dream.title} progress`} />
      <PercentInput value={draft.value} onChange={(v) => onChange({ value: v })} label={`${dream.title} progress`} disabled={disabled} />
      <div className="row-wrap dci-under">
        <span className="small tnum"><b>{draft.value}%</b>{diff != null && <span className="muted"> · {diff === 0 ? 'same as before' : `${diff > 0 ? '+' : '−'}${plural(Math.abs(diff), 'pt')}`}</span>}</span>
      </div>
      <TextArea value={draft.note} onChange={(e) => onChange({ note: e.target.value })} placeholder="What moved, or what got in the way? (optional)" aria-label={`${dream.title} note`} rows={2} maxLength={4000} disabled={disabled} data-testid={`checkin-dream-note-${dream.id}`} />
      <div className="row-wrap dc-privacy-row">
        <span data-testid={`checkin-dream-privacy-${dream.id}`}><PrivacyToggle size="sm" value={draft.isPrivate} onChange={(v) => onChange({ isPrivate: v })} labels={['Progress shared with coach', 'Progress private']} /></span>
        {hasNote && <span data-testid={`checkin-dream-note-privacy-${dream.id}`}>{draft.isPrivate ? <NotePrivateWith parent="update" /> : <PrivacyToggle size="sm" value={draft.notePrivate} onChange={(v) => onChange({ notePrivate: v })} labels={['Note shared with coach', 'Note private']} />}</span>}
      </div>
    </Card>
  );
}
