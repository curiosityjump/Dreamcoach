/**
 * Shared timeline/journal rendering used by the dreamer Home and Journal pages,
 * dream/category history pages and staff views.
 *
 * Privacy: the server only ever returns rows the viewer may see, so nothing here
 * filters by `isPrivate`. `isPrivate` can only be true on the dreamer's own rows
 * while their session is unlocked; staff mode shows no privacy UI or wording at all.
 */
import { useMemo, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CARE_CATEGORIES, CATEGORY_META, isRatingCategory, type RatingCategory } from '@shared/care';
import type { ActionItem, CoachingSession, Dream, JournalEntry, ProgressEntry, RatingEntry, TimelineItem } from '@shared/types';
import { useDeleteJournal, useUpdateJournal, type DreamerRef } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/toast';
import { staffDreamerPath } from '@/app/routes';
import { Button, CategoryChip, Chip, ConfirmDialog, Dropdown, EmptyState, PrivacyToggle, PrivateChip, SourceChip, TextArea } from '@/components/ui';
import { IconArchive, IconCheck, IconClock, IconEdit, IconInfo, IconLock, IconMessage, IconMore, IconPen, IconPlus, IconStar, IconTrash, IconUnlock } from '@/components/icons';
import { dayHeading, dayKey, firstName, fmtDateTime, fmtTime } from '@/lib/format';

export type TimelineMode = 'dreamer' | 'staff';
type DreamRef = Pick<Dream, 'id' | 'title' | 'slot'>;

const PRIVATE_HIDDEN_MSG = 'Saved as private — private entries are currently hidden.';

/* ======================================================================
   TimelineFeed
   ====================================================================== */

export interface TimelineFeedProps {
  items: TimelineItem[];
  dreamerRef: DreamerRef;
  /** dreamer: entries are editable (own journal), privacy visible. staff: read-only, no privacy UI. */
  mode: TimelineMode;
  /** For labelling dream links. */
  dreams?: Pick<Dream, 'id' | 'title' | 'slot'>[];
  /** Group items under day headings (default true; in `compact` mode the default is false). */
  groupByDay?: boolean;
  /** Show at most this many items (with no "more" control — callers paginate). */
  limit?: number;
  /** Denser layout. */
  compact?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}

const itemKey = (it: TimelineItem) => `${it.kind}-${it.item.id}${it.kind === 'action' ? `-${it.event}` : ''}`;

/** Newest first; ties keep the server's order. */
function sortNewestFirst(items: TimelineItem[]): TimelineItem[] {
  return items
    .map((it, i) => ({ it, i, t: Date.parse(it.at) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.it);
}

function groupByDays(items: TimelineItem[]): { key: string; at: string; items: TimelineItem[] }[] {
  const out: { key: string; at: string; items: TimelineItem[] }[] = [];
  for (const it of items) {
    const key = dayKey(it.at);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(it);
    else out.push({ key, at: it.at, items: [it] });
  }
  return out;
}

/** Chronological feed mixing ratings, progress updates, reflections, action events and sessions. */
export function TimelineFeed({ items, dreamerRef, mode, dreams, groupByDay, limit, compact, emptyTitle, emptyBody }: TimelineFeedProps) {
  const grouped = groupByDay ?? !compact;
  const sorted = useMemo(() => {
    const s = sortNewestFirst(items);
    return limit != null ? s.slice(0, Math.max(0, limit)) : s;
  }, [items, limit]);

  if (sorted.length === 0) {
    return (
      <EmptyState icon={<IconClock />} title={emptyTitle ?? 'Nothing here yet'}>
        {emptyBody ?? 'Ratings, progress updates, reflections, actions and sessions will appear here as they happen.'}
      </EmptyState>
    );
  }

  const cls = `dj-tl${compact ? ' dj-tl-compact' : ''}`;
  const row = (it: TimelineItem) => <TimelineRow key={itemKey(it)} it={it} dreamerRef={dreamerRef} mode={mode} dreams={dreams} compact={!!compact} showDate={!grouped} />;

  if (!grouped) {
    return (
      <div className={cls} data-testid="timeline-feed" data-mode={mode}>
        <ol className="timeline dj-tl-list">{sorted.map(row)}</ol>
      </div>
    );
  }

  return (
    <div className={cls} data-testid="timeline-feed" data-mode={mode}>
      {groupByDays(sorted).map((day) => (
        <section key={day.key} className="dj-tl-day" data-testid="timeline-day">
          <h3 className="dj-tl-day-head">{dayHeading(day.at)}</h3>
          <ol className="timeline dj-tl-list">{day.items.map(row)}</ol>
        </section>
      ))}
    </div>
  );
}

/* ---------- Rows ---------- */

interface RowCtx {
  dreamerRef: DreamerRef;
  mode: TimelineMode;
  dreams?: DreamRef[];
  compact: boolean;
  /** Show the full date (no day heading above) instead of just the time. */
  showDate: boolean;
}

function TimelineRow({ it, ...ctx }: { it: TimelineItem } & RowCtx) {
  switch (it.kind) {
    case 'rating': return <RatingRow entry={it.item} {...ctx} />;
    case 'progress': return <ProgressRow entry={it.item} dreamTitle={it.dreamTitle} {...ctx} />;
    case 'journal': return <JournalRow entry={it.item} {...ctx} />;
    case 'action': return <ActionRow action={it.item} event={it.event} {...ctx} />;
    case 'session': return <SessionRow session={it.item} {...ctx} />;
  }
}

function Row({ kind, dot, dotClass, dotStyle, children, testid }: { kind: TimelineItem['kind']; dot: ReactNode; dotClass?: string; dotStyle?: CSSProperties; children: ReactNode; testid?: string }) {
  return (
    <li className={`timeline-item dj-tl-item dj-tl-${kind}`} data-testid={testid ?? 'timeline-item'} data-kind={kind}>
      <span className={`timeline-dot dj-tl-dot${dotClass ? ` ${dotClass}` : ''}`} style={dotStyle} aria-hidden>{dot}</span>
      <div className="timeline-body dj-tl-body">{children}</div>
    </li>
  );
}

function When({ at, showDate }: { at: string; showDate: boolean }) {
  return <time className="dj-tl-when" dateTime={at}>{showDate ? fmtDateTime(at) : fmtTime(at)}</time>;
}

/** Attached note on a rating/progress entry. The 'private' class only ever applies in dreamer mode. */
function NoteBlock({ note, mode }: { note: RatingEntry['note']; mode: TimelineMode }) {
  if (!note) return null;
  const priv = mode === 'dreamer' && note.isPrivate;
  return (
    <div className={`note-block${priv ? ' private' : ''}`} data-testid="timeline-note">
      {priv && <span className="dj-note-lock"><IconLock /> Private note</span>}
      {note.body}
    </div>
  );
}

function RatingRow({ entry: r, mode, compact, showDate }: { entry: RatingEntry } & RowCtx) {
  const m = CATEGORY_META[r.category];
  const isDreamer = mode === 'dreamer';
  return (
    <Row kind="rating" dot={<span className="dj-tl-swatch" />} dotStyle={{ '--dj-color': m.color, '--dj-tint': m.tint } as CSSProperties}>
      <div className="dj-tl-head">
        <span className="dj-tl-text">Rated <b>{m.label}</b> <span className="dj-tl-value tnum" data-testid="timeline-rating-value">{r.value}</span></span>
        <SourceChip source={r.source} coachName={!compact && r.source === 'session' ? r.recordedBy.name : undefined} />
        {isDreamer && r.isPrivate && <PrivateChip compact={compact} />}
        <span className="dj-tl-end">
          <When at={r.occurredAt} showDate={showDate} />
          {isDreamer && <Link to={`/care/${r.category}`} className="dj-tl-link" data-testid="timeline-care-link">History</Link>}
        </span>
      </div>
      <NoteBlock note={r.note} mode={mode} />
    </Row>
  );
}

function ProgressRow({ entry: p, dreamTitle, mode, compact, showDate }: { entry: ProgressEntry; dreamTitle: string } & RowCtx) {
  const isDreamer = mode === 'dreamer';
  const title = isDreamer ? <Link to={`/dreams/${p.dreamId}`} className="dj-tl-dream" data-testid="timeline-dream-link">‘{dreamTitle}’</Link> : <b>‘{dreamTitle}’</b>;
  return (
    <Row kind="progress" dot={<IconStar />} dotClass="dj-dot-gold">
      <div className="dj-tl-head">
        <span className="dj-tl-text">Updated {title} to <span className="dj-tl-value tnum">{p.value}%</span></span>
        <SourceChip source={p.source} coachName={!compact && p.source === 'session' ? p.recordedBy.name : undefined} />
        {isDreamer && p.isPrivate && <PrivateChip compact={compact} />}
        <span className="dj-tl-end"><When at={p.occurredAt} showDate={showDate} /></span>
      </div>
      <NoteBlock note={p.note} mode={mode} />
    </Row>
  );
}

function JournalRow({ entry, dreamerRef, mode, dreams, compact, showDate }: { entry: JournalEntry } & RowCtx) {
  return (
    <Row kind="journal" dot={<IconPen />} dotClass="dj-dot-ink">
      <JournalEntryCard entry={entry} dreamerRef={dreamerRef} mode={mode} dreams={dreams} compact={compact} dateFormat={showDate ? 'full' : 'time'} />
    </Row>
  );
}

const ACTION_VERB = { created: 'Added', completed: 'Completed', archived: 'Set aside' } as const;

function ActionRow({ action: a, event, mode, dreams, compact, showDate }: { action: ActionItem; event: 'created' | 'completed' | 'archived' } & RowCtx) {
  const isDreamer = mode === 'dreamer';
  const dream = a.dreamId != null ? dreams?.find((d) => d.id === a.dreamId) : undefined;
  const icon = event === 'completed' ? <IconCheck /> : event === 'archived' ? <IconArchive /> : <IconPlus />;
  const dotClass = event === 'completed' ? 'dj-dot-success' : 'dj-dot-muted';
  return (
    <Row kind="action" dot={icon} dotClass={dotClass}>
      <div className="dj-tl-head">
        <span className="dj-tl-text">{ACTION_VERB[event]} <b>{a.title}</b></span>
        {dream && <DreamChip dream={dream} link={isDreamer} />}
        {a.category && <CategoryChip category={a.category} />}
        {a.sessionId != null && <Chip className="chip-session" title="Chosen together in a coaching session">Coaching session</Chip>}
        {isDreamer && a.isPrivate && <PrivateChip compact={compact} />}
        <span className="dj-tl-end"><When at={event === 'completed' && a.completedAt ? a.completedAt : event === 'archived' && a.archivedAt ? a.archivedAt : a.createdAt} showDate={showDate} /></span>
      </div>
    </Row>
  );
}

function SessionRow({ session: s, dreamerRef, mode, compact, showDate }: { session: CoachingSession } & RowCtx) {
  const isDreamer = mode === 'dreamer';
  const to = isDreamer ? `/sessions/${s.id}` : staffDreamerPath(typeof dreamerRef === 'number' ? dreamerRef : s.dreamerId, 'sessions');
  return (
    <Row kind="session" dot={<IconMessage />} dotClass="dj-dot-accent">
      <div className="dj-tl-head">
        <span className="dj-tl-text">Coaching session <b>{s.number}</b> with {compact ? firstName(s.coach.name) : s.coach.name}</span>
        {s.status === 'in_progress' && <Chip className="chip-warning">In progress</Chip>}
        <span className="dj-tl-end">
          <When at={s.occurredAt} showDate={showDate} />
          <Link to={to} className="dj-tl-link" data-testid="timeline-session-link">{isDreamer ? 'Open' : 'Sessions'}</Link>
        </span>
      </div>
      {s.focus && !compact && (
        <div className="dj-tl-focus"><span className="dj-tl-eyebrow">Focus</span><span>{s.focus}</span></div>
      )}
    </Row>
  );
}

function DreamChip({ dream, link }: { dream: DreamRef; link: boolean }) {
  if (link) {
    return (
      <Link to={`/dreams/${dream.id}`} className="chip dj-chip-dream" title={dream.title} data-testid="journal-dream-link">
        <IconStar /><span className="dj-chip-text">{dream.title}</span>
      </Link>
    );
  }
  return <Chip className="dj-chip-dream" title={dream.title}><IconStar /><span className="dj-chip-text">{dream.title}</span></Chip>;
}

/* ======================================================================
   JournalEntryCard
   ====================================================================== */

export interface JournalEntryCardProps {
  entry: JournalEntry;
  dreamerRef: DreamerRef;
  mode: TimelineMode;
  dreams?: Pick<Dream, 'id' | 'title' | 'slot'>[];
  /** Hide the date line (when a parent already shows it). */
  hideDate?: boolean;
  compact?: boolean;
  /** 'full' (default) shows date and time; 'time' shows only the time (when a day heading already gives the date). */
  dateFormat?: 'full' | 'time';
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** One reflection: body, tags (dream/category), source, privacy chip; in dreamer mode: edit, toggle privacy, delete. */
export function JournalEntryCard({ entry, dreamerRef, mode, dreams, hideDate, compact, dateFormat = 'full' }: JournalEntryCardProps) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const update = useUpdateJournal(dreamerRef);
  const remove = useDeleteJournal(dreamerRef);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDreamer = mode === 'dreamer';

  // Reflect the server's latest answer (or the in-flight change) immediately, before the list refetches.
  const shown = useMemo(() => {
    let e = entry;
    if (update.data && update.data.id === entry.id && update.data.updatedAt >= entry.updatedAt) e = update.data;
    if (update.isPending && update.variables && update.variables.journalId === entry.id && update.variables.isPrivate !== undefined) e = { ...e, isPrivate: update.variables.isPrivate };
    return e;
  }, [entry, update.data, update.isPending, update.variables]);

  const busy = update.isPending || remove.isPending;
  const attached = shown.ratingId != null || shown.progressId != null;
  const parentNoun = shown.ratingId != null ? 'rating' : 'progress update';
  // A note on a private rating or progress update is private with it, whatever its own switch says
  // (the server only tells the owner, and only while private entries are shown).
  const privateWithParent = isDreamer && attached && !!shown.parentPrivate;
  const isPrivate = isDreamer && (shown.isPrivate || privateWithParent);
  const dream = shown.dreamId != null ? dreams?.find((d) => d.id === shown.dreamId) : undefined;
  const coachAuthored = shown.author.role !== 'dreamer';
  const standalone = !attached && shown.checkInId == null;

  const contextText: string | null =
    shown.ratingId != null
      ? shown.category ? `Note on ${article(CATEGORY_META[shown.category].label)} ${CATEGORY_META[shown.category].label} rating` : 'Note on a rating'
      : shown.progressId != null ? 'Note on a progress update' : null;

  const patch = (body: Omit<Parameters<typeof update.mutate>[0], 'journalId'>, message: string, kind: 'success' | 'info' | 'private' = 'success', after?: () => void) =>
    update.mutate({ journalId: entry.id, ...body }, {
      onSuccess: () => { toast(message, kind); after?.(); },
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const makePrivate = () => patch({ isPrivate: true }, auth?.privateUnlocked ? 'Now private — only you can see this.' : PRIVATE_HIDDEN_MSG, 'private');
  const share = () => patch({ isPrivate: false }, 'Shared with your coach.');
  const confirmRemove = () =>
    remove.mutate(entry.id, {
      onSuccess: () => { setConfirmDelete(false); toast(attached ? 'Note deleted.' : 'Reflection deleted.', 'info'); },
      onError: (e) => { setConfirmDelete(false); toast(errorMessage(e), 'error'); },
    });

  const onSave = (changes: { body?: string; isPrivate?: boolean; dreamId?: number | null; category?: RatingCategory | null }) => {
    const turningPrivate = changes.isPrivate === true && !shown.isPrivate;
    const message = turningPrivate ? (auth?.privateUnlocked ? 'Saved as private — only you can see this.' : PRIVATE_HIDDEN_MSG) : changes.isPrivate === false && shown.isPrivate ? 'Saved and shared with your coach.' : 'Saved.';
    patch(changes, message, turningPrivate ? 'private' : 'success', () => setEditing(false));
  };

  const when = !hideDate && (
    <time className="dj-entry-when" dateTime={shown.occurredAt} data-testid="journal-entry-when">{dateFormat === 'time' ? fmtTime(shown.occurredAt) : fmtDateTime(shown.occurredAt)}</time>
  );

  return (
    <article
      className={`dj-entry${compact ? ' dj-entry-compact' : ''}${isPrivate ? ' is-private' : ''}${busy ? ' is-busy' : ''}${editing ? ' is-editing' : ''}`}
      data-testid="journal-entry"
      data-entry-id={entry.id}
      data-mode={mode}
      aria-busy={busy || undefined}
    >
      <div className="dj-entry-main">
        {editing ? (
          <JournalEditForm entry={shown} dreams={dreams} attached={attached} privateWith={privateWithParent ? parentNoun : null} pending={update.isPending} onSave={onSave} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <div className="dj-entry-body" data-testid="journal-entry-body">{shown.body}</div>
            <div className="dj-entry-meta" data-testid="journal-entry-meta">
              {when}
              {/* A reflection written on its own is a "Reflection"; "Self check-in" is kept for what was written in one. */}
              <SourceChip source={shown.source} reflection={standalone} coachName={shown.source === 'session' && coachAuthored ? shown.author.name : undefined} />
              {contextText && (
                isDreamer && shown.ratingId != null && shown.category
                  ? <Link to={`/care/${shown.category}`} className="dj-entry-context" data-testid="journal-entry-context">{contextText}</Link>
                  : <span className="dj-entry-context" data-testid="journal-entry-context">{contextText}</span>
              )}
              {dream && <DreamChip dream={dream} link={isDreamer} />}
              {shown.category && <CategoryChip category={shown.category} />}
              {!isDreamer && coachAuthored && shown.source !== 'session' && <Chip className="chip-muted">Written by {firstName(shown.author.name)}</Chip>}
              {isPrivate && <PrivateChip compact={compact} />}
            </div>
          </>
        )}
      </div>

      {isDreamer && !editing && (
        <div className="dj-entry-menu">
          <Dropdown
            trigger={(open) => (
              <Button variant="ghost" icon size="sm" aria-label={attached ? 'Options for this note' : 'Options for this reflection'} aria-haspopup="menu" aria-expanded={open} disabled={busy} data-testid="journal-entry-menu">
                <IconMore />
              </Button>
            )}
          >
            <button type="button" className="menu-item" onClick={() => setEditing(true)} data-testid="journal-entry-edit"><IconEdit /> Edit</button>
            {!privateWithParent && (shown.isPrivate
              ? <button type="button" className="menu-item" onClick={share} data-testid="journal-entry-share"><IconUnlock /> Share with coach</button>
              : <button type="button" className="menu-item" onClick={makePrivate} data-testid="journal-entry-make-private"><IconLock /> Make private</button>)}
            <div className="divider" />
            <button type="button" className="menu-item dj-menu-danger" onClick={() => setConfirmDelete(true)} data-testid="journal-entry-delete"><IconTrash /> Delete</button>
          </Dropdown>
        </div>
      )}

      {isDreamer && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={confirmRemove}
          title={attached ? 'Delete this note?' : 'Delete this reflection?'}
          body={attached
            ? `The ${parentNoun} it belongs to stays; only the note is removed. This cannot be undone.`
            : isPrivate
              ? 'It will be gone for good. This cannot be undone.'
              : <>It will be gone for good. If you’d rather keep it to yourself, <b>Make private</b> keeps it in your journal where only you can see it.</>}
          confirmLabel="Delete"
          danger
          loading={remove.isPending}
        />
      )}
    </article>
  );
}

/* ---------- Inline edit form ---------- */

function JournalEditForm({ entry, dreams, attached, privateWith, pending, onSave, onCancel }: {
  entry: JournalEntry;
  dreams?: DreamRef[];
  /** Notes attached to a rating/progress entry keep their context; only body and privacy can change. */
  attached: boolean;
  /** Set when the note is private because its rating / progress update is: its own switch then has no say. */
  privateWith: string | null;
  pending: boolean;
  onSave: (changes: { body?: string; isPrivate?: boolean; dreamId?: number | null; category?: RatingCategory | null }) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(entry.body);
  const [isPrivate, setIsPrivate] = useState(entry.isPrivate);
  const [dreamId, setDreamId] = useState<number | null>(entry.dreamId);
  const [category, setCategory] = useState<RatingCategory | null>(entry.category);
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const sortedDreams = useMemo(() => [...(dreams ?? [])].sort((a, b) => a.slot - b.slot), [dreams]);
  const categoryOptions: RatingCategory[] = entry.category && !CARE_CATEGORIES.includes(entry.category as (typeof CARE_CATEGORIES)[number]) ? [...CARE_CATEGORIES, entry.category] : [...CARE_CATEGORIES];

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (pending) return;
    if (!trimmed) { setError('A reflection can’t be empty. Delete it instead if you no longer want it.'); return; }
    const changes: Parameters<typeof onSave>[0] = {};
    if (trimmed !== entry.body) changes.body = trimmed;
    if (isPrivate !== entry.isPrivate) changes.isPrivate = isPrivate;
    if (!attached && dreamId !== entry.dreamId) changes.dreamId = dreamId;
    if (!attached && category !== entry.category) changes.category = category;
    if (Object.keys(changes).length === 0) { onCancel(); return; }
    onSave(changes);
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  return (
    <form className="dj-edit" onSubmit={submit} onKeyDown={onKey} data-testid="journal-entry-edit-form" aria-busy={pending || undefined}>
      <TextArea
        value={body}
        onChange={(e) => { setBody(e.target.value); if (error) setError(null); }}
        autoFocus
        onFocus={(e) => { const el = e.currentTarget; el.setSelectionRange(el.value.length, el.value.length); }}
        rows={3}
        maxLength={8000}
        disabled={pending}
        aria-label="Edit reflection"
        data-testid="journal-entry-edit-body"
      />
      <div className="dj-edit-options">
        {!attached && (
          <>
            <select
              className={`dj-select dj-select-dream${dreamId != null ? ' is-set' : ''}`}
              value={dreamId ?? ''}
              onChange={(e) => setDreamId(e.target.value ? Number(e.target.value) : null)}
              disabled={pending || sortedDreams.length === 0}
              aria-label="Tag a dream"
              data-testid="journal-entry-edit-dream"
            >
              <option value="">No dream tag</option>
              {sortedDreams.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            <select
              className={`dj-select${category ? ' is-set' : ''}`}
              value={category ?? ''}
              onChange={(e) => setCategory(isRatingCategory(e.target.value) ? e.target.value : null)}
              disabled={pending}
              aria-label="Tag a CARE area"
              style={category ? ({ '--dj-color': CATEGORY_META[category].color, '--dj-tint': CATEGORY_META[category].tint } as CSSProperties) : undefined}
              data-testid="journal-entry-edit-category"
            >
              <option value="">No CARE tag</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
            </select>
          </>
        )}
        {privateWith
          ? <Chip className="chip-private" title={`Share the ${privateWith} to share this note too.`} data-testid="journal-entry-edit-privacy-with"><IconLock /> Private with its {privateWith}</Chip>
          : <span data-testid="journal-entry-edit-privacy"><PrivacyToggle value={isPrivate} onChange={setIsPrivate} size="sm" /></span>}
        <div className="dj-edit-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending} data-testid="journal-entry-edit-cancel">Cancel</Button>
          <Button type="submit" variant="primary" size="sm" disabled={pending || !trimmed} loading={pending} data-testid="journal-entry-edit-save">Save</Button>
        </div>
      </div>
      {error && <div className="callout callout-muted" role="alert"><IconInfo /><span>{error}</span></div>}
    </form>
  );
}
