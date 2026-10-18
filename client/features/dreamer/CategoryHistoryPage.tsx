/**
 * One CARE (or program) category over time (/care/:category). Trend chart with
 * session vs self markers, a quick "Rate now" composer, and every entry with its
 * note, grouped by month and interleaved with the reflections written alongside.
 * The dreamer can edit, re-share or make private their own self entries; session
 * values stay the coach's to change (the dreamer may delete one while it is private),
 * but privacy and notes are always the dreamer's call.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthContext';
import { useCategoryHistory, useCreateCheckIn, useDeleteRating, useDreams, useSessions, useUpdateRating } from '@/api/hooks';
import { ApiRequestError, errorMessage } from '@/api/client';
import { useToast } from '@/components/toast';
import { Button, Card, CardHead, CategoryChip, ConfirmDialog, Dropdown, EmptyState, LoadingPage, PageHeader, PrivacyToggle, PrivateChip, RatingInput, SourceChip, TextArea } from '@/components/ui';
import { SourceLegend, TrendChart } from '@/components/charts';
import { IconArrowLeft, IconArrowRight, IconChart, IconCompass, IconEdit, IconInfo, IconLock, IconMore, IconPen, IconSparkle, IconTrash, IconUnlock } from '@/components/icons';
import { JournalEntryCard } from '@/features/shared/Timeline';
import { UnlockDialog } from '@/features/shared/PrivacyControl';
import { CATEGORY_META, RATING_CATEGORIES, isRatingCategory, type RatingCategory } from '@shared/care';
import type { CategoryHistory, CoachingSession, JournalEntry, RatingEntry } from '@shared/types';
import { fmtDate, fmtDateTime, fmtMonthLong, plural } from '@/lib/format';
import { NotePrivateWith, PRIVATE_HIDDEN_MSG, SessionDelta, ValueBadge, byTimeAsc, catVars, coachNameFor, rangeInsight, savedToast, toTrendPoint, useTouch } from './CareShared';

type Item = { kind: 'rating'; at: string; entry: RatingEntry } | { kind: 'reflection'; at: string; entry: JournalEntry };

/* ---------- Page ---------- */

export function CategoryHistoryPage() {
  const { category: param } = useParams();
  const category = isRatingCategory(param) ? param : null;
  const history = useCategoryHistory('me', category);
  const dreams = useDreams('me');
  const sessions = useSessions('me');
  const tabs = useRef<HTMLElement>(null);

  // On phones the tabs scroll sideways: bring the current one into view.
  useEffect(() => {
    const nav = tabs.current;
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !tab) return;
    const n = nav.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    nav.scrollLeft += t.left - n.left - (n.width - t.width) / 2;
  }, [category]);

  if (!category) {
    return (
      <div className="page page-narrow">
        <EmptyState icon={<IconCompass />} title="That area doesn’t exist" action={<Link to="/care" className="btn btn-primary">Back to your wheel</Link>}>
          CARE covers Contribution, Alignment, Relationships and Energy, plus Commitment and Satisfaction.
        </EmptyState>
      </div>
    );
  }

  const m = CATEGORY_META[category];

  return (
    <div className="page dc-page" data-testid="category-page" data-category={category} style={catVars(category)}>
      <Link to="/care" className="dc-back" data-testid="category-back"><IconArrowLeft /> CARE · Wheel of Life</Link>
      <nav className="tabs dc-tabs" aria-label="Categories" ref={tabs}>
        {RATING_CATEGORIES.map((c) => (
          <Link key={c} to={`/care/${c}`} className={`tab${c === category ? ' active' : ''}`} aria-current={c === category ? 'page' : undefined} style={catVars(c)} data-testid={`category-tab-${c}`}>
            <span className="dc-tab-dot" aria-hidden />{CATEGORY_META[c].label}
          </Link>
        ))}
      </nav>

      <PageHeader
        eyebrow={<span className="row"><CategoryChip category={category} />{m.areas.length > 0 && <span className="muted">{m.areas.join(' · ')}</span>}</span>}
        title={m.label}
        lead={m.prompt}
      />

      {history.isLoading ? (
        <LoadingPage label={`Loading your ${m.label.toLowerCase()} history…`} />
      ) : history.error || !history.data ? (
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(history.error)}</span></div>
      ) : (
        <HistoryBody category={category} history={history.data} dreams={dreams.data ?? []} sessions={[...(sessions.data ?? [])].sort(byTimeAsc)} />
      )}
    </div>
  );
}

/* ---------- Body ---------- */

function HistoryBody({ category, history, dreams, sessions }: { category: RatingCategory; history: CategoryHistory; dreams: { id: number; title: string; slot: 1 | 2 | 3 | 4 }[]; sessions: CoachingSession[] }) {
  const m = CATEGORY_META[category];
  const entries = history.entries;
  const latest = entries[entries.length - 1];
  const previous = entries[entries.length - 2];
  const insight = useMemo(() => rangeInsight(category, entries), [category, entries]);
  const points = useMemo(() => entries.map(toTrendPoint), [entries]);
  const [composing, setComposing] = useState(false);
  const touch = useTouch();
  // Sessions whose cell holds a shared value: a value hidden from one of them can't be shared back.
  const sharedSessions = useMemo(() => new Set(entries.filter((e) => e.source === 'session' && !e.isPrivate).map((e) => e.sessionId)), [entries]);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      ...entries.map((e) => ({ kind: 'rating' as const, at: e.occurredAt, entry: e })),
      ...history.reflections.map((r) => ({ kind: 'reflection' as const, at: r.occurredAt, entry: r })),
    ];
    return list.sort((a, b) => b.at.localeCompare(a.at) || (a.kind === 'rating' ? -1 : 1));
  }, [entries, history.reflections]);

  const months = useMemo(() => {
    const groups: { key: string; label: string; items: Item[] }[] = [];
    for (const it of items) {
      const key = it.at.slice(0, 7);
      const g = groups[groups.length - 1];
      if (g && g.key === key) g.items.push(it);
      else groups.push({ key, label: fmtMonthLong(it.at), items: [it] });
    }
    return groups;
  }, [items]);

  const fromSessions = entries.filter((e) => e.source === 'session').length;

  return (
    <>
      <Card className="dc-hero" data-testid="category-hero">
        <div className="dc-hero-main">
          <div className="dc-hero-value">
            <span className="dc-cat-value tnum" data-testid="category-latest">{latest ? latest.value : '–'}</span>
            <span className="dc-cat-of">/ 10</span>
            {latest && <SessionDelta entry={latest} sessions={sessions} />}
          </div>
          <div className="dc-hero-meta">
            {latest ? (
              <>
                <div className="row-wrap">
                  <SourceChip source={latest.source} coachName={coachNameFor(latest)} />
                  {latest.isPrivate && <PrivateChip />}
                  <span className="muted small">{fmtDateTime(latest.occurredAt)}</span>
                </div>
                {previous && <div className="muted small">Before that: {previous.value} on {fmtDate(previous.occurredAt)}</div>}
              </>
            ) : (
              <div className="muted small">Nothing recorded for {m.label.toLowerCase()} yet. Your first rating will show here.</div>
            )}
          </div>
        </div>
        <div className="dc-hero-actions">
          <Button variant={composing ? 'secondary' : 'primary'} onClick={() => setComposing((v) => !v)} aria-expanded={composing} data-testid="category-rate-now"><IconSparkle /> {composing ? 'Close' : 'Rate now'}</Button>
          <Link to={`/check-in?category=${category}`} className="btn btn-ghost" data-testid="category-full-checkin">Full check-in <IconArrowRight /></Link>
        </div>
        {composing && <RateNow category={category} latest={latest} onDone={() => setComposing(false)} />}
      </Card>

      <Card className="dc-section" data-testid="category-chart">
        <CardHead title="Trend" sub={entries.length ? `${plural(entries.length, 'entry', 'entries')} · ${fromSessions} from coaching sessions, ${entries.length - fromSessions} self check-in${entries.length - fromSessions === 1 ? '' : 's'}` : 'Each rating becomes a point here'} />
        {entries.length ? (
          <>
            <TrendChart points={points} max={10} color={m.color} height={260} />
            <div className="spread dc-chart-foot">
              <SourceLegend color={m.color} />
              <span className="muted tiny">{touch ? 'Tap a point to see its note' : 'Hover a point for its note'}</span>
            </div>
          </>
        ) : (
          <EmptyState icon={<IconChart />} title="No entries yet">Rate {m.label.toLowerCase()} once and this chart will start to fill in.</EmptyState>
        )}
        {insight && <p className="dc-insight" data-testid="category-insight">{insight}</p>}
      </Card>

      <section className="dc-section" aria-labelledby="dc-entries-head">
        <div className="spread">
          <h2 id="dc-entries-head" className="dc-section-title">Entries</h2>
          {items.length > 0 && <span className="muted small">Newest first</span>}
        </div>
        {items.length === 0 ? (
          <Card>
            <EmptyState icon={<IconPen />} title="Your story here starts with one rating" action={<Button variant="primary" onClick={() => setComposing(true)}>Rate now</Button>}>
              Numbers and words together: every rating can carry a note, and reflections written at check-in time appear alongside.
            </EmptyState>
          </Card>
        ) : (
          months.map((g) => (
            <div key={g.key} className="dc-month" data-testid="category-month">
              <h3 className="dc-month-head">{g.label}</h3>
              <Card pad={false} className="dc-entries">
                {g.items.map((it) =>
                  it.kind === 'rating' ? (
                    <EntryRow key={`r${it.entry.id}`} entry={it.entry} cellTaken={it.entry.sessionId != null && sharedSessions.has(it.entry.sessionId)} />
                  ) : (
                    <div key={`j${it.entry.id}`} className="dc-entry dc-entry-reflection" data-testid="category-reflection">
                      <div className="dc-entry-label"><IconPen /> {it.entry.checkInId != null ? 'Check-in reflection' : `Reflection tagged ${m.label}`}</div>
                      <JournalEntryCard entry={it.entry} dreamerRef="me" mode="dreamer" dreams={dreams} compact />
                    </div>
                  ),
                )}
              </Card>
            </div>
          ))
        )}
      </section>
    </>
  );
}

/* ---------- Rate now composer ---------- */

function RateNow({ category, latest, onDone }: { category: RatingCategory; latest: RatingEntry | undefined; onDone: () => void }) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const create = useCreateCheckIn('me');
  const m = CATEGORY_META[category];
  const [value, setValue] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [priv, setPriv] = useState(false);
  const [notePriv, setNotePriv] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (value == null || create.isPending) return;
    const text = note.trim();
    const anyPrivate = priv || (!!text && notePriv);
    create.mutate({ ratings: [{ category, value, isPrivate: priv, ...(text ? { note: text, notePrivate: notePriv || priv } : {}) }] }, {
      onSuccess: () => {
        const [msg, kind] = savedToast(auth, anyPrivate, `${m.label} saved: ${value}.`, `${m.label} saved as private — only you can see it.`, priv ? undefined : `${m.label} saved: ${value}. Your private note is hidden right now.`);
        toast(msg, kind);
        onDone();
      },
      onError: (e) => setError(errorMessage(e)),
    });
  };

  return (
    <div className="dc-ratenow" data-testid="category-ratenow">
      <div className="spread">
        <div className="dc-ratenow-prompt">{m.prompt}</div>
        {latest && value == null && (
          <button type="button" className="dc-text-btn" onClick={() => setValue(latest.value)} data-testid="category-ratenow-keep">Same as last ({latest.value})</button>
        )}
      </div>
      <RatingInput value={value} onChange={setValue} category={category} label={`${m.label} rating`} />
      <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What’s behind this number? (optional)" aria-label="Note" rows={2} maxLength={4000} disabled={create.isPending} data-testid="category-ratenow-note" />
      <div className="row-wrap dc-privacy-row">
        <span data-testid="category-ratenow-privacy"><PrivacyToggle size="sm" value={priv} onChange={setPriv} labels={['Rating shared with coach', 'Rating private']} /></span>
        {note.trim() && <span data-testid="category-ratenow-note-privacy">{priv ? <NotePrivateWith parent="rating" /> : <PrivacyToggle size="sm" value={notePriv} onChange={setNotePriv} labels={['Note shared with coach', 'Note private']} />}</span>}
      </div>
      {error && <div className="callout callout-muted" role="alert"><IconInfo /><span>{error}</span></div>}
      <div className="dc-pending-actions">
        <Button variant="ghost" onClick={onDone} disabled={create.isPending}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={value == null} loading={create.isPending} data-testid="category-ratenow-save">Save rating</Button>
      </div>
    </div>
  );
}

/* ---------- Entry row ---------- */

type EditError = { message: string; hiddenNote: boolean };

function EntryRow({ entry, cellTaken }: { entry: RatingEntry; cellTaken: boolean }) {
  const { auth, unlockPrivate } = useAuth();
  const { toast } = useToast();
  const update = useUpdateRating('me');
  const remove = useDeleteRating('me');
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<EditError | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);

  const own = entry.source === 'self';
  const orphan = entry.source === 'session' && entry.sessionId == null;
  // Session values: the dreamer may remove one while it is private (staff can't see it) or once its session is gone,
  // and may share a hidden one back only while its session cell is free.
  const canDelete = own || entry.isPrivate || orphan;
  const shareBlocked = entry.isPrivate && !own && (orphan || cellTaken);
  // A note on a private rating is private with it, whatever its own switch says.
  const notePrivate = !!entry.note && (entry.note.isPrivate || entry.isPrivate);
  const busy = update.isPending || remove.isPending;
  const m = CATEGORY_META[entry.category];
  // Once private entries are showing, the hidden note is in the editor and the message no longer applies.
  const shownError = editError && !(editError.hiddenNote && auth?.privateUnlocked) ? editError : null;

  const patch = (body: Omit<Parameters<typeof update.mutate>[0], 'ratingId'>, message: string, kind: 'success' | 'info' | 'private' = 'success', after?: () => void) =>
    update.mutate({ ratingId: entry.id, ...body }, {
      onSuccess: () => { toast(message, kind); after?.(); },
      onError: (e) => toast(errorMessage(e), isConflict(e) ? 'info' : 'error'),
    });

  const saveEdit = (body: EntryEdit) => {
    setEditError(null);
    update.mutate({ ratingId: entry.id, ...body }, {
      onSuccess: () => {
        // Judged from the request, never the response: whatever was just made private disappears while private
        // entries are hidden, so the toast says why.
        const nowPrivate = body.isPrivate === true || body.notePrivate === true;
        const [msg, kind] = savedToast(auth, nowPrivate, 'Entry updated.', 'Entry updated — the private parts are only visible to you.');
        toast(msg, kind);
        setEditing(false);
      },
      // Shown in the editor, which keeps what was typed; a note hidden right now can be shown from there.
      onError: (e) => setEditError({ message: errorMessage(e), hiddenNote: isConflict(e) }),
    });
  };
  const startEdit = () => { setEditError(null); setEditing(true); };
  const makePrivate = () => patch({ isPrivate: true }, auth?.privateUnlocked ? 'Now private — only you can see this rating.' : PRIVATE_HIDDEN_MSG, 'private', () => setConfirmHide(false));
  const share = () => patch({ isPrivate: false }, 'Rating shared with your coach.');
  const noteMakePrivate = () => patch({ notePrivate: true }, auth?.privateUnlocked ? 'Note is now private — the rating stays as it was.' : PRIVATE_HIDDEN_MSG, 'private');
  const noteShare = () => patch({ notePrivate: false }, 'Note shared with your coach.');
  const confirmRemove = () =>
    remove.mutate(entry.id, {
      onSuccess: () => { setConfirmDelete(false); toast('Entry deleted.', 'info'); },
      onError: (e) => { setConfirmDelete(false); toast(errorMessage(e), 'error'); },
    });

  return (
    <div className={`dc-entry${busy ? ' is-busy' : ''}`} data-testid="category-entry" data-entry-id={entry.id} data-source={entry.source} aria-busy={busy || undefined}>
      <ValueBadge category={entry.category} value={entry.value} />
      <div className="dc-entry-body">
        {editing ? (
          <EntryEditor
            entry={entry}
            pending={update.isPending}
            error={shownError}
            onShowPrivate={shownError?.hiddenNote ? () => setUnlocking(true) : undefined}
            onCancel={() => setEditing(false)}
            onSave={saveEdit}
          />
        ) : (
          <>
            <div className="dc-entry-meta">
              <SourceChip source={entry.source} coachName={coachNameFor(entry)} />
              <span className="muted small">{fmtDateTime(entry.occurredAt)}</span>
              {entry.isPrivate && <PrivateChip />}
            </div>
            {entry.note && (
              <div className={`note-block${notePrivate ? ' private' : ''}`} data-testid="category-entry-note">
                {notePrivate && <span className="dc-note-private"><IconLock /> {entry.note.isPrivate ? 'Private note' : 'Private with its rating'}</span>}
                {entry.note.body}
              </div>
            )}
          </>
        )}
      </div>
      {!editing && (
        <div className="dc-entry-menu">
          <Dropdown
            trigger={(open) => (
              <Button variant="ghost" icon size="sm" aria-label={`Options for ${m.label} ${entry.value} on ${fmtDate(entry.occurredAt)}`} aria-haspopup="menu" aria-expanded={open} disabled={busy} data-testid="category-entry-menu"><IconMore /></Button>
            )}
          >
            <button type="button" className="menu-item" onClick={startEdit} data-testid="category-entry-edit"><IconEdit /> {own ? 'Edit value or note' : entry.note ? 'Edit note' : 'Add a note'}</button>
            {entry.isPrivate
              ? !shareBlocked && <button type="button" className="menu-item" onClick={share} data-testid="category-entry-share"><IconUnlock /> Share rating with coach</button>
              : <button type="button" className="menu-item" onClick={() => (own ? makePrivate() : setConfirmHide(true))} data-testid="category-entry-make-private"><IconLock /> Make rating private</button>}
            {entry.note && !entry.isPrivate && (entry.note.isPrivate
              ? <button type="button" className="menu-item" onClick={noteShare} data-testid="category-entry-note-share"><IconUnlock /> Share note with coach</button>
              : <button type="button" className="menu-item" onClick={noteMakePrivate} data-testid="category-entry-note-make-private"><IconLock /> Make note private</button>)}
            {canDelete && (
              <>
                <div className="divider" />
                <button type="button" className="menu-item dc-menu-danger" onClick={() => setConfirmDelete(true)} data-testid="category-entry-delete"><IconTrash /> Delete entry</button>
              </>
            )}
            {!own && (
              <div className="dc-menu-note muted tiny" data-testid="category-entry-menu-note">
                {orphan
                  ? 'Its coaching session was later removed, so this value stays private.'
                  : shareBlocked
                    ? 'Your coach recorded a new value for this session after you hid this one, so this one stays private.'
                    : 'Recorded by your coach — the value itself is changed in a session.'}
              </div>
            )}
          </Dropdown>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={confirmRemove}
        title="Delete this entry?"
        body={own
          ? <>Your {m.label} rating of <b>{entry.value}</b> from {fmtDate(entry.occurredAt)}{entry.note ? ' and its note' : ''} will be removed for good.</>
          : <>This {m.label} value of <b>{entry.value}</b>, recorded in a coaching session on {fmtDate(entry.occurredAt)}{entry.note ? ', and your note on it' : ','} will be removed for good.{entry.isPrivate ? ' It’s private, so nothing changes in your coach’s views.' : ''}</>}
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
      />
      <ConfirmDialog
        open={confirmHide}
        onClose={() => setConfirmHide(false)}
        onConfirm={makePrivate}
        title="Make this session value private?"
        body={<>This {m.label} rating of <b>{entry.value}</b> was recorded in a coaching session. Making it private hides the value from your coach — it will no longer appear in their view of that session. Only you will see it here. You can share it again later, unless your coach records a new value for that session in the meantime.</>}
        confirmLabel="Make private"
        loading={update.isPending}
      />
      <UnlockDialog open={unlocking} onClose={() => setUnlocking(false)} onUnlock={unlockPrivate} />
    </div>
  );
}

const isConflict = (e: unknown) => e instanceof ApiRequestError && e.code === 'conflict';

type EntryEdit = { value?: number; note?: string | null; isPrivate?: boolean; notePrivate?: boolean };

/** Self entries: value, note and privacy. Session entries: the dreamer's own note only (privacy has its own warning in the menu). */
function EntryEditor({ entry, pending, error, onShowPrivate, onSave, onCancel }: {
  entry: RatingEntry;
  pending: boolean;
  error: EditError | null;
  /** Set when saving found a note that is hidden right now: offers to show private entries. */
  onShowPrivate?: () => void;
  onSave: (body: EntryEdit) => void;
  onCancel: () => void;
}) {
  const own = entry.source === 'self';
  const [value, setValue] = useState<number | null>(entry.value);
  const [note, setNote] = useState(entry.note?.body ?? '');
  const [priv, setPriv] = useState(entry.isPrivate);
  const [notePriv, setNotePriv] = useState(entry.note?.isPrivate ?? false);
  // Private entries were shown while editing, so a note that was hidden is here now: start from it (and its
  // privacy), keeping anything typed meanwhile below it. Saving can then never overwrite a note unseen.
  const [seenNote, setSeenNote] = useState(entry.note);
  if (entry.note?.id !== seenNote?.id) {
    const typed = note.trim() !== (seenNote?.body ?? '') ? note.trim() : '';
    setSeenNote(entry.note);
    setNote([entry.note?.body, typed].filter(Boolean).join('\n\n'));
    setNotePriv(entry.note?.isPrivate ?? false);
  }
  const text = note.trim();
  const original = entry.note?.body ?? '';
  const dirty = value !== entry.value || text !== original || priv !== entry.isPrivate || (!!text && !priv && notePriv !== (entry.note?.isPrivate ?? false));

  const submit = () => {
    if (value == null) return;
    if (!dirty) { onCancel(); return; }
    const body: Parameters<typeof onSave>[0] = {};
    if (value !== entry.value) body.value = value;
    if (text !== original) body.note = text || null;
    if (priv !== entry.isPrivate) body.isPrivate = priv;
    // A new note on a private rating is private too; an existing note keeps its own switch unless changed here.
    if (text && !entry.note) body.notePrivate = notePriv || priv;
    else if (text && entry.note && !priv && notePriv !== entry.note.isPrivate) body.notePrivate = notePriv;
    onSave(body);
  };

  return (
    <div className="dc-editor" data-testid="category-entry-editor" aria-busy={pending || undefined}>
      <div className="row-wrap">
        <SourceChip source={entry.source} coachName={coachNameFor(entry)} />
        <span className="muted small">{fmtDateTime(entry.occurredAt)}</span>
      </div>
      {own
        ? <RatingInput value={value} onChange={setValue} category={entry.category} compact />
        : <div className="muted small">{entry.sessionId == null ? `The ${entry.value} was recorded in a coaching session that was later removed.` : `The ${entry.value} was recorded in your coaching session; the value itself is changed in a session.`} You can add your own note to it.</div>}
      <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for this rating (optional)" aria-label="Note" rows={2} maxLength={4000} disabled={pending} data-testid="category-entry-edit-note" />
      {(own || text) && (
        <div className="row-wrap dc-privacy-row">
          {own && <span data-testid="category-entry-edit-privacy"><PrivacyToggle size="sm" value={priv} onChange={setPriv} labels={['Rating shared with coach', 'Rating private']} /></span>}
          {text && <span data-testid="category-entry-edit-note-privacy">{priv ? <NotePrivateWith parent="rating" /> : <PrivacyToggle size="sm" value={notePriv} onChange={setNotePriv} labels={['Note shared with coach', 'Note private']} />}</span>}
        </div>
      )}
      {error && (
        <div className={`callout ${error.hiddenNote ? 'callout-private' : 'callout-muted'}`} role="alert" data-testid="category-entry-edit-error">
          {error.hiddenNote ? <IconLock /> : <IconInfo />}
          <div className="dc-callout-body">
            <span>{error.message}{onShowPrivate ? ' What you typed stays here.' : ''}</span>
            {onShowPrivate && <Button variant="secondary" size="sm" onClick={onShowPrivate} data-testid="category-entry-edit-show-private">Show private entries</Button>}
          </div>
        </div>
      )}
      <div className="dc-pending-actions">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending} data-testid="category-entry-edit-cancel">Cancel</Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={value == null} loading={pending} data-testid="category-entry-edit-save">Save</Button>
      </div>
    </div>
  );
}
