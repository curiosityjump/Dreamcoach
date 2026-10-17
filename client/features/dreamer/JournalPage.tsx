/**
 * Journal (/journal) — the dreamer's reflections and notes, grouped by day, plus
 * an "Everything" view that mixes in ratings, progress updates, actions and
 * sessions. Write a new reflection at the top (optionally tagged with a dream or
 * CARE area, shared or private); edit, re-share or delete entries inline.
 *
 * Privacy: the server decides what is visible. The only client-side privacy
 * filter here is the "Private only" chip, which narrows the already-visible list
 * and exists only while private entries are unlocked.
 */
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { CARE_CATEGORIES, CATEGORY_META, PROGRAM_CATEGORIES, isCareCategory, type CareCategory, type RatingCategory } from '@shared/care';
import type { Dream, JournalEntry, TimelineItem } from '@shared/types';
import { useCreateJournal, useDreams, useJournal, useOverview, useTimeline } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/toast';
import { Button, Card, EmptyState, PageHeader, PrivacyToggle, Segmented, Skeleton, TextArea } from '@/components/ui';
import { IconInfo, IconLock, IconPen, IconSearch, IconStar, IconUnlock } from '@/components/icons';
import { JournalEntryCard, TimelineFeed } from '@/features/shared/Timeline';
import { dayHeading, dayKey, firstName, plural } from '@/lib/format';

type View = 'reflections' | 'everything';
type DreamRef = Pick<Dream, 'id' | 'title' | 'slot'>;

const PAGE = 30;
const PRIVATE_HIDDEN_MSG = 'Saved as private — private entries are currently hidden.';

interface Filters {
  dreamId: number | null;
  category: RatingCategory | null;
  privateOnly: boolean;
  search: string;
}
const NO_FILTERS: Filters = { dreamId: null, category: null, privateOnly: false, search: '' };
const anyFilter = (f: Filters) => f.dreamId != null || f.category != null || f.privateOnly || f.search.trim().length > 0;

/* ---------- Filtering (text search is client-side; privacy is decided by the server) ---------- */

const norm = (s: string) => s.toLowerCase();

function entryMatches(e: JournalEntry, f: Filters, dreams: DreamRef[], q: string): boolean {
  if (f.dreamId != null && e.dreamId !== f.dreamId) return false;
  if (f.category != null && e.category !== f.category) return false;
  if (f.privateOnly && !e.isPrivate) return false;
  if (q) {
    const hay = [e.body, e.category ? CATEGORY_META[e.category].label : '', e.dreamId != null ? dreams.find((d) => d.id === e.dreamId)?.title ?? '' : '', e.author.name].join(' ');
    if (!norm(hay).includes(q)) return false;
  }
  return true;
}

function itemMatches(it: TimelineItem, f: Filters, dreams: DreamRef[], q: string): boolean {
  const dreamId = it.kind === 'progress' ? it.item.dreamId : it.kind === 'journal' || it.kind === 'action' ? it.item.dreamId : null;
  const category = it.kind === 'rating' || it.kind === 'journal' || it.kind === 'action' ? it.item.category : null;
  const isPrivate = it.kind === 'session' ? false : it.item.isPrivate;
  if (f.dreamId != null && dreamId !== f.dreamId) return false;
  if (f.category != null && category !== f.category) return false;
  if (f.privateOnly && !isPrivate) return false;
  if (q) {
    const parts: string[] = [];
    if (category) parts.push(CATEGORY_META[category].label);
    if (dreamId != null) parts.push(dreams.find((d) => d.id === dreamId)?.title ?? '');
    switch (it.kind) {
      case 'rating': parts.push(it.item.note?.body ?? '', it.item.source === 'session' ? 'session' : 'check-in', it.item.recordedBy.name); break;
      case 'progress': parts.push(it.dreamTitle, it.item.note?.body ?? '', it.item.source === 'session' ? 'session' : 'check-in'); break;
      case 'journal': parts.push(it.item.body, it.item.author.name); break;
      case 'action': parts.push(it.item.title, it.item.details, 'action'); break;
      case 'session': parts.push(`session ${it.item.number}`, it.item.coach.name, it.item.focus, it.item.notes); break;
    }
    if (!norm(parts.join(' ')).includes(q)) return false;
  }
  return true;
}

/* ---------- Page ---------- */

export function JournalPage() {
  const { auth } = useAuth();
  const [params, setParams] = useSearchParams();
  const composeParam = params.get('compose') === '1';

  const journal = useJournal('me');
  const timeline = useTimeline('me');
  const dreams = useDreams('me');
  const overview = useOverview('me');
  const dreamRefs: DreamRef[] = useMemo(() => (dreams.data ?? []).map((d) => ({ id: d.id, title: d.title, slot: d.slot })).sort((a, b) => a.slot - b.slot), [dreams.data]);
  const coachName = overview.data?.dreamer.coach?.name ?? null;

  const [view, setView] = useState<View>('reflections');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [shownCount, setShownCount] = useState(PAGE);

  // Composer: open when asked for (?compose=1), when the journal is still empty, or when the dreamer taps the prompt.
  const [composerOpen, setComposerOpen] = useState<boolean | null>(composeParam ? true : null);
  const [focusComposer, setFocusComposer] = useState(composeParam);
  const journalEmpty = journal.isSuccess && journal.data.length === 0;
  const composerExpanded = composerOpen ?? journalEmpty;

  const openComposer = () => { setComposerOpen(true); setFocusComposer(true); };
  const closeComposer = () => {
    setComposerOpen(false);
    setFocusComposer(false);
    if (composeParam) { const next = new URLSearchParams(params); next.delete('compose'); setParams(next, { replace: true }); }
  };

  // Private entries can lock again mid-visit; a stale "Private only" filter would otherwise hide everything.
  useEffect(() => { if (!auth?.privateUnlocked && filters.privateOnly) setFilters((f) => ({ ...f, privateOnly: false })); }, [auth?.privateUnlocked, filters.privateOnly]);

  const q = norm(filters.search.trim());
  const filtersKey = `${view}|${filters.dreamId}|${filters.category}|${filters.privateOnly}|${q}`;
  useEffect(() => { setShownCount(PAGE); }, [filtersKey]);

  const entries = useMemo(() => {
    const all = [...(journal.data ?? [])].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    return all.filter((e) => entryMatches(e, filters, dreamRefs, q));
  }, [journal.data, filters, dreamRefs, q]);
  const items = useMemo(() => (timeline.data ?? []).filter((it) => itemMatches(it, filters, dreamRefs, q)), [timeline.data, filters, dreamRefs, q]);

  // Which CARE/program categories to offer as chips: the four CARE areas always, Commitment/Satisfaction only when tagged somewhere.
  const categoryChips: RatingCategory[] = useMemo(() => {
    const used = new Set<RatingCategory>();
    for (const e of journal.data ?? []) if (e.category) used.add(e.category);
    for (const it of timeline.data ?? []) if (it.kind === 'rating') used.add(it.item.category);
    return [...CARE_CATEGORIES, ...PROGRAM_CATEGORIES.filter((c) => used.has(c))];
  }, [journal.data, timeline.data]);

  const active = view === 'reflections' ? journal : timeline;
  const total = view === 'reflections' ? entries.length : items.length;
  const visibleEntries = entries.slice(0, shownCount);
  const visibleItems = items.slice(0, shownCount);
  const hasMore = total > shownCount;
  const filtering = anyFilter(filters);

  return (
    <div className="page page-narrow dj-page" data-testid="journal-page">
      <PageHeader
        eyebrow="Your space"
        title="Journal"
        lead="Reflections, notes, and the story behind your numbers."
      />

      <Composer
        dreams={dreamRefs}
        coachName={coachName}
        expanded={composerExpanded}
        autoFocus={focusComposer}
        onOpen={openComposer}
        onClose={closeComposer}
        canClose={!journalEmpty}
      />

      <div className="dj-toolbar">
        <div data-testid="journal-view">
          <Segmented<View> value={view} onChange={setView} ariaLabel="What to show" options={[{ value: 'reflections', label: 'Reflections' }, { value: 'everything', label: 'Everything' }]} />
        </div>
        {active.isSuccess && (
          <span className="dj-count muted small tnum" data-testid="journal-count">
            {hasMore ? `Showing ${Math.min(shownCount, total)} of ${total}` : view === 'reflections' ? plural(total, 'reflection') : plural(total, 'moment')}
            {filtering && total > 0 ? ' · filtered' : ''}
          </span>
        )}
      </div>

      <FilterBar filters={filters} onChange={setFilters} dreams={dreamRefs} categories={categoryChips} showPrivate={!!auth?.privateUnlocked} />

      {active.isLoading ? (
        <div className="stack" aria-busy data-testid="journal-loading">
          <Skeleton h={14} w={120} />
          <Skeleton h={96} />
          <Skeleton h={72} />
          <Skeleton h={88} />
        </div>
      ) : active.error ? (
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(active.error)}</span></div>
      ) : view === 'reflections' ? (
        entries.length === 0 ? (
          <Card>
            {filtering ? (
              <EmptyState icon={<IconSearch />} title="Nothing matches" action={<Button variant="secondary" onClick={() => setFilters(NO_FILTERS)} data-testid="journal-filters-clear-empty">Clear filters</Button>}>
                Try a different word, or clear the filters to see every reflection again.
              </EmptyState>
            ) : (
              <EmptyState icon={<IconPen />} title="Your journal starts here" action={!composerExpanded ? <Button variant="primary" onClick={openComposer} data-testid="journal-empty-write"><IconPen /> Write a reflection</Button> : undefined}>
                A few lines about how things are going — a win, a worry, a thought worth keeping. Notes you add to ratings and progress updates gather here too.
              </EmptyState>
            )}
          </Card>
        ) : (
          <ReflectionsList entries={visibleEntries} dreams={dreamRefs} />
        )
      ) : (
        <Card data-testid="journal-everything">
          <TimelineFeed
            items={visibleItems}
            dreamerRef="me"
            mode="dreamer"
            dreams={dreamRefs}
            groupByDay
            emptyTitle={filtering ? 'Nothing matches' : 'Nothing here yet'}
            emptyBody={filtering ? 'Try a different word, or clear the filters to see everything again.' : 'Your ratings, progress updates, reflections, actions and sessions will appear here as they happen.'}
          />
        </Card>
      )}

      {active.isSuccess && total > 0 && (
        <div className="dj-more">
          {hasMore ? (
            <>
              <Button variant="secondary" onClick={() => setShownCount((n) => n + PAGE)} data-testid="journal-load-more">Show {Math.min(PAGE, total - shownCount)} more</Button>
              <span className="muted tiny tnum">{total - shownCount} earlier {view === 'reflections' ? 'reflections' : 'moments'}</span>
            </>
          ) : total > PAGE ? (
            <span className="muted tiny" data-testid="journal-end">That’s everything — back to where your story began.</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------- Reflections grouped by day ---------- */

function ReflectionsList({ entries, dreams }: { entries: JournalEntry[]; dreams: DreamRef[] }) {
  const days = useMemo(() => {
    const out: { key: string; at: string; items: JournalEntry[] }[] = [];
    for (const e of entries) {
      const key = dayKey(e.occurredAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, at: e.occurredAt, items: [e] });
    }
    return out;
  }, [entries]);
  return (
    <div data-testid="journal-reflections">
      {days.map((d) => (
        <section key={d.key} className="dj-day" data-testid="journal-day">
          <h3 className="dj-day-head">{dayHeading(d.at)}</h3>
          <div className="dj-day-list">
            {d.items.map((e) => <JournalEntryCard key={e.id} entry={e} dreamerRef="me" mode="dreamer" dreams={dreams} dateFormat="time" />)}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------- Filters ---------- */

function FilterBar({ filters, onChange, dreams, categories, showPrivate }: { filters: Filters; onChange: (f: Filters) => void; dreams: DreamRef[]; categories: RatingCategory[]; showPrivate: boolean }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const clearable = anyFilter(filters);
  return (
    <div className="dj-filters" data-testid="journal-filters">
      <div className="dj-search">
        <IconSearch />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search your reflections"
          aria-label="Search"
          autoComplete="off"
          data-testid="journal-search"
        />
      </div>
      <div className="dj-chips" role="group" aria-label="Filter by">
        {clearable && (
          <button type="button" className="dj-text-btn" onClick={() => onChange(NO_FILTERS)} data-testid="journal-filters-clear">Clear</button>
        )}
        {dreams.map((d) => (
          <button
            key={d.id}
            type="button"
            className="dj-filter-chip dj-filter-dream"
            aria-pressed={filters.dreamId === d.id}
            onClick={() => set({ dreamId: filters.dreamId === d.id ? null : d.id })}
            title={d.title}
            data-testid={`journal-filter-dream-${d.id}`}
          >
            <IconStar /><span className="dj-filter-text">{d.title}</span>
          </button>
        ))}
        {categories.map((c) => {
          const m = CATEGORY_META[c];
          return (
            <button
              key={c}
              type="button"
              className="dj-filter-chip dj-filter-cat"
              aria-pressed={filters.category === c}
              onClick={() => set({ category: filters.category === c ? null : c })}
              style={{ '--dj-color': m.color, '--dj-tint': m.tint } as CSSProperties}
              data-testid={`journal-filter-category-${c}`}
            >
              <span className="chip-dot" />{m.label}
            </button>
          );
        })}
        {showPrivate && (
          <button type="button" className="dj-filter-chip dj-filter-private" aria-pressed={filters.privateOnly} onClick={() => set({ privateOnly: !filters.privateOnly })} data-testid="journal-filter-private">
            <IconLock /> Private only
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Composer ---------- */

function Composer({ dreams, coachName, expanded, autoFocus, onOpen, onClose, canClose }: {
  dreams: DreamRef[];
  coachName: string | null;
  expanded: boolean;
  autoFocus: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** With an empty journal the composer stays open — there is nothing else to look at yet. */
  canClose: boolean;
}) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const create = useCreateJournal('me');
  const [body, setBody] = useState('');
  const [dreamId, setDreamId] = useState<number | null>(null);
  const [category, setCategory] = useState<CareCategory | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !create.isPending;

  const reset = () => { setBody(''); setDreamId(null); setCategory(null); setIsPrivate(false); setError(null); };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setError(null);
    create.mutate(
      { body: trimmed, isPrivate, dreamId, category },
      {
        onSuccess: (entry) => {
          if (entry.isPrivate) toast(auth?.privateUnlocked ? 'Saved as a private reflection — only you can see it.' : PRIVATE_HIDDEN_MSG, 'private');
          else toast('Reflection saved.');
          reset();
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  const cancel = () => { reset(); onClose(); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && canClose) { e.preventDefault(); cancel(); }
  };

  if (!expanded) {
    return (
      <Card className="dj-composer-card" pad="sm">
        <button type="button" className="dj-composer-open" onClick={onOpen} data-testid="journal-composer-open">
          <IconPen /><span>What’s on your mind?</span>
        </button>
      </Card>
    );
  }

  const who = coachName ? firstName(coachName) : 'your coach';
  return (
    <Card className="dj-composer-card">
      <form className="dj-composer" onSubmit={submit} data-testid="journal-composer" aria-busy={create.isPending || undefined}>
        <TextArea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKey}
          placeholder="What’s on your mind?"
          aria-label="New reflection"
          rows={4}
          maxLength={8000}
          autoFocus={autoFocus}
          disabled={create.isPending}
          data-testid="journal-body-input"
        />
        <div className="dj-composer-options">
          <select
            className={`dj-select dj-select-dream${dreamId != null ? ' is-set' : ''}`}
            value={dreamId ?? ''}
            onChange={(e) => setDreamId(e.target.value ? Number(e.target.value) : null)}
            disabled={create.isPending || dreams.length === 0}
            aria-label="Tag a dream"
            data-testid="journal-dream-select"
          >
            <option value="">Tag a dream</option>
            {dreams.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <select
            className={`dj-select${category ? ' is-set' : ''}`}
            value={category ?? ''}
            onChange={(e) => setCategory(isCareCategory(e.target.value) ? e.target.value : null)}
            disabled={create.isPending}
            aria-label="Tag a CARE area"
            style={category ? ({ '--dj-color': CATEGORY_META[category].color, '--dj-tint': CATEGORY_META[category].tint } as CSSProperties) : undefined}
            data-testid="journal-category-select"
          >
            <option value="">CARE area</option>
            {CARE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
          </select>
          <span data-testid="journal-privacy-toggle"><PrivacyToggle value={isPrivate} onChange={setIsPrivate} size="sm" /></span>
          <div className="dj-composer-actions">
            {canClose && <Button type="button" variant="ghost" onClick={cancel} disabled={create.isPending} data-testid="journal-cancel">Cancel</Button>}
            <Button type="submit" variant="primary" disabled={!canSubmit} loading={create.isPending} data-testid="journal-save">Save</Button>
          </div>
        </div>
        <p className="dj-composer-hint muted tiny" data-testid="journal-composer-hint">
          {isPrivate ? <><IconLock /> Only you can see this reflection.</> : <><IconUnlock /> {who === 'your coach' ? 'Your coach' : who} can read this — switch to Private to keep it to yourself.</>}
          <span className="hide-mobile"> · Cmd/Ctrl + Enter saves.</span>
        </p>
        {error && <div className="callout callout-muted" role="alert"><IconInfo /><span>{error}</span></div>}
      </form>
    </Card>
  );
}
