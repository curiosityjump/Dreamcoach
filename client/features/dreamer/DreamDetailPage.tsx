/**
 * /dreams/:dreamId — one dream in depth: editable header, progress hero, trend
 * chart, full progress history with notes and privacy controls, related actions and
 * reflections, and prev/next navigation across the four dream slots.
 */
import { useMemo, useRef, useState, type FocusEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '@/auth/AuthContext';
import { useCreateJournal, useDeleteProgress, useDreamHistory, useDreams, useOverview, useSessions, useUpdateProgress } from '@/api/hooks';
import { ApiRequestError, errorMessage } from '@/api/client';
import { Bar, Button, Card, CardHead, ConfirmDialog, Delta, Dropdown, EmptyState, Field, LoadingPage, Modal, PercentInput, PrivacyToggle, PrivateChip, Segmented, Skeleton, SourceChip, TextArea } from '@/components/ui';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconCompass, IconEdit, IconInfo, IconLock, IconMore, IconPen, IconPlus, IconTarget, IconTrash, IconUnlock } from '@/components/icons';
import { SourceLegend, TrendChart, type TrendPoint } from '@/components/charts';
import { useToast } from '@/components/toast';
import { fmtDate, fmtDateTime, firstName, plural, relativeTime } from '@/lib/format';
import { ActionComposer, ActionList } from '@/features/shared/ActionItems';
import { JournalEntryCard } from '@/features/shared/Timeline';
import { UnlockDialog } from '@/features/shared/PrivacyControl';
import type { ActionItem, Dream, DreamHistory, JournalEntry, ProgressEntry } from '@shared/types';
import { DREAM_COLOR, DreamsProgressDialog, privacyToast } from './DreamsProgressDialog';
import { DreamsEditForm } from './DreamsEditDialog';
import { AchievedChip, SessionDelta, dreamBaseline } from './HomePage';
import { CoveredDraft, KeepDrafts, useCovered, useKeptDraft, useLastKnown, useLoadedOnce } from './drafts';

const NO_ENTRIES: ProgressEntry[] = [];
const NO_ACTIONS: ActionItem[] = [];
const NO_REFLECTIONS: JournalEntry[] = [];

export function DreamDetailPage() {
  const params = useParams();
  const dreamId = Number(params.dreamId);
  const validId = Number.isInteger(dreamId) && dreamId > 0;
  const history = useDreamHistory('me', validId ? dreamId : null);
  const dreams = useDreams('me');
  const overview = useOverview('me');
  // Hiding private entries loads all of this again. The page stays meanwhile (its forms keep what's typed),
  // showing the dream by its title and description, which are never private.
  const loaded = useLoadedOnce(!!history.data, dreamId);
  const dream = useLastKnown(history.data?.dream, dreamId);
  const allDreams = useLastKnown(dreams.data);

  if (!validId || (history.isError && history.error instanceof ApiRequestError && history.error.status === 404)) {
    return (
      <div className="page page-narrow">
        <EmptyState icon={<IconCompass />} title="That dream isn’t here" action={<Link to="/dreams" className="btn btn-primary">Back to your dreams</Link>}>
          It may have been a mistyped link. Your four dreams are waiting on the dreams page.
        </EmptyState>
      </div>
    );
  }
  if (!loaded || !dream) {
    if (!history.isError) return <LoadingPage label="Opening your dream…" />;
    return (
      <div className="page page-narrow">
        <Link to="/dreams" className="dd-back"><IconArrowLeft /> All dreams</Link>
        <div className="callout callout-muted" role="alert" style={{ marginTop: 16 }}><IconInfo /><span>{errorMessage(history.error)}</span></div>
      </div>
    );
  }

  const guidance = overview.data?.dreamer.program.slotGuidance[dream.slot - 1];
  return (
    <KeepDrafts key={dreamId}>
      <DreamDetail key={dreamId} history={history.data} dream={dream} dreams={allDreams ?? []} guidance={guidance} />
    </KeepDrafts>
  );
}

/**
 * `history` is undefined while it loads again; `dream` is then the last one loaded, used only for what is never
 * private (title, description, slot, achieved).
 */
function DreamDetail({ history, dream: known, dreams, guidance }: { history: DreamHistory | undefined; dream: Dream; dreams: Dream[]; guidance?: string }) {
  const refreshing = !history;
  const dream = history?.dream ?? known;
  const entries = history?.entries ?? NO_ENTRIES;
  const actions = history?.actions ?? NO_ACTIONS;
  const reflections = history?.reflections ?? NO_REFLECTIONS;
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [actionFilter, setActionFilter] = useState<'active' | 'completed' | 'all'>('active');
  const [composing, setComposing] = useState(false);
  const sessions = useSessions('me');

  const sorted = useMemo(() => [...dreams].sort((a, b) => a.slot - b.slot), [dreams]);
  const idx = sorted.findIndex((d) => d.id === dream.id);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  // The server lists entries oldest first (ties by when they were written); reversing keeps that order for ties.
  const newestFirst = useMemo(() => [...entries].reverse().sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()), [entries]);
  const latest = newestFirst[0] ?? null;
  const points: TrendPoint[] = useMemo(() => entries.map((e) => ({ at: e.occurredAt, value: e.value, source: e.source, isPrivate: e.isPrivate, note: e.note?.body ?? null })), [entries]);
  const base = dreamBaseline(sessions.data ?? [], dream);
  const achieved = !!dream.achievedAt;
  const activeCount = actions.filter((a) => a.status === 'active').length;
  const completedCount = actions.filter((a) => a.status === 'completed').length;
  const dreamRefs = useMemo(() => sorted.map((d) => ({ id: d.id, title: d.title, slot: d.slot })), [sorted]);
  // Sessions whose cell holds a shared value: a value hidden from one of them can't be shared back.
  const sharedSessions = useMemo(() => new Set(entries.filter((e) => e.source === 'session' && !e.isPrivate).map((e) => e.sessionId)), [entries]);

  return (
    <div className="page dd-page dd-detail" data-testid="dream-detail" data-dream-id={dream.id}>
      <div className="spread dd-detail-nav">
        <Link to="/dreams" className="dd-back" data-testid="dream-back"><IconArrowLeft /> All dreams</Link>
        {sorted.length > 1 && (
          <div className="row dd-pager">
            <span className="muted small tnum">Dream {idx + 1} of {sorted.length}</span>
            {prev ? <Link to={`/dreams/${prev.id}`} className="btn btn-ghost btn-icon btn-sm" aria-label={`Previous dream: ${prev.title}`} title={prev.title} data-testid="dream-prev"><IconChevronLeft /></Link> : <span className="btn btn-ghost btn-icon btn-sm dd-pager-disabled" aria-hidden><IconChevronLeft /></span>}
            {next ? <Link to={`/dreams/${next.id}`} className="btn btn-ghost btn-icon btn-sm" aria-label={`Next dream: ${next.title}`} title={next.title} data-testid="dream-next"><IconChevronRight /></Link> : <span className="btn btn-ghost btn-icon btn-sm dd-pager-disabled" aria-hidden><IconChevronRight /></span>}
          </div>
        )}
      </div>

      <header className="dd-head">
        <div className="row-wrap dd-head-eyebrow">
          <span className="eyebrow dd-eyebrow">{dream.slotLabel}</span>
          {achieved && <AchievedChip achievedAt={dream.achievedAt!} />}
        </div>
        {editing ? (
          <Card soft className="dd-head-edit">
            <DreamsEditForm dream={dream} guidance={guidance} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
          </Card>
        ) : (
          <div className="dd-head-text">
            <button type="button" className="dd-head-title-btn" onClick={() => setEditing(true)} title="Click to edit" data-testid="dream-title">
              <h1 className="dd-head-title">{dream.title}</h1>
              <span className="dd-head-pencil" aria-hidden><IconEdit /></span>
            </button>
            <p className={`dd-head-desc${dream.description ? '' : ' muted'}`}>{dream.description || 'Add a line or two about what this dream looks like when it’s real.'}</p>
            <div className="row-wrap dd-head-actions">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)} data-testid="dream-edit-inline"><IconEdit /> Edit title or description</Button>
              {guidance && <span className="muted small dd-guidance">{guidance}</span>}
            </div>
          </div>
        )}
      </header>

      <Card className="dd-hero" data-testid="dream-hero" aria-busy={refreshing || undefined}>
        {refreshing ? (
          <div className="stack"><Skeleton h={60} w={150} /><Skeleton h={12} /><Skeleton h={14} w="60%" /></div>
        ) : (
          <>
            <div className="dd-hero-main">
              <div className="dd-hero-numbers">
                <span className="dd-hero-value tnum" data-testid="dream-hero-value">{dream.progress == null ? '—' : `${dream.progress}%`}</span>
                <div className="dd-hero-sub">
                  {dream.progress == null ? (
                    <span className="muted small">Nothing recorded yet</span>
                  ) : base ? (
                    <SessionDelta value={dream.progress} base={base} suffix=" pts" />
                  ) : entries.length === 1 ? (
                    <span className="muted small">First update</span>
                  ) : null}
                  {dream.progressIsPrivate && <span data-testid="dream-hero-private"><PrivateChip /></span>}
                </div>
              </div>
              <div className="dd-hero-cta">
                <Button variant="primary" size="lg" onClick={() => setUpdating(true)} data-testid="dream-hero-update"><IconTarget /> Update progress</Button>
              </div>
            </div>
            <Bar value={dream.progress} color={DREAM_COLOR} large label={`${dream.title} progress`} />
            <div className="dd-meta muted small">
              {latest ? (
                <>
                  <span>Last updated {fmtDate(latest.occurredAt)} ({relativeTime(latest.occurredAt)})</span>
                  <span>{latest.source === 'self' ? 'From a self check-in' : latest.sessionId == null ? 'Recorded in a coaching session that was later removed' : `Recorded in a coaching session with ${firstName(latest.recordedBy.name)}`}</span>
                </>
              ) : (
                <span>Record your first update to start this dream’s story.</span>
              )}
              <span>{activeCount === 0 ? 'No active actions' : plural(activeCount, 'active action')}</span>
            </div>
            {achieved && <p className="dd-achieved-note">Achieved on {fmtDate(dream.achievedAt!, { month: 'long', day: 'numeric' })}. You made this one real — it stays here as a reminder of what you can do.</p>}
          </>
        )}
      </Card>

      <div className="dd-detail-grid">
        <div className="stack dd-col">
          <Card data-testid="dream-chart">
            <CardHead title="Progress over time" sub={refreshing ? undefined : entries.length ? `${plural(entries.length, 'update')} · solid dots are coaching sessions, hollow dots are your own check-ins` : 'Your updates will draw a line here'} />
            <div className="dd-chart-wrap">
              {refreshing ? <Skeleton h={240} /> : <TrendChart points={points} max={100} unit="%" color={DREAM_COLOR} height={240} emptyLabel="No progress recorded yet" />}
            </div>
            {entries.length > 0 && <div style={{ marginTop: 10 }}><SourceLegend color={DREAM_COLOR} /></div>}
          </Card>

          <Card data-testid="dream-history">
            <CardHead title="Progress history" sub={entries.length ? 'Newest first. Notes travel with the update they belong to.' : undefined} />
            {refreshing ? <ListSkeleton /> : newestFirst.length === 0 ? (
              <EmptyState icon={<IconTarget />} title="No progress recorded yet" action={<Button variant="primary" onClick={() => setUpdating(true)} data-testid="dream-history-first">Record your first update</Button>}>
                Every update you or your coach record will appear here, with its notes.
              </EmptyState>
            ) : (
              <div className="list dd-entries">
                {newestFirst.map((e, i) => (
                  <ProgressRow key={e.id} entry={e} previous={newestFirst[i + 1] ?? null} cellTaken={e.sessionId != null && sharedSessions.has(e.sessionId)} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack dd-col">
          <Card className="dd-actions-card" data-testid="dream-actions">
            <CardHead
              title="Actions for this dream"
              sub={refreshing ? undefined : actions.length ? `${activeCount} active · ${completedCount} completed` : 'Small steps that move this dream'}
              actions={
                <Segmented
                  value={actionFilter}
                  onChange={setActionFilter}
                  ariaLabel="Filter actions"
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'all', label: 'All' },
                  ]}
                />
              }
            />
            <div className="stack">
              {composing ? (
                <div className="dd-composer-wrap" data-testid="dream-action-composer">
                  <ActionComposer dreamerRef="me" dreams={dreamRefs} mode="dreamer" defaultDreamId={dream.id} autoFocus onDone={() => { setComposing(false); }} onCancel={() => setComposing(false)} />
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setComposing(true)} data-testid="dream-add-action"><IconPlus /> Add an action for this dream</Button>
              )}
              {refreshing ? <ListSkeleton /> : <ActionList
                dreamerRef="me"
                actions={actions}
                dreams={dreamRefs}
                mode="dreamer"
                filter={actionFilter}
                emptyTitle={actionFilter === 'active' ? 'No active actions' : actionFilter === 'completed' ? 'Nothing completed yet' : 'No actions yet'}
                emptyBody={actionFilter === 'active' ? 'Add a small next step for this dream — something you could do this week.' : actionFilter === 'completed' ? 'Completed actions linked to this dream will gather here.' : 'Actions you link to this dream will show up here.'}
              />}
            </div>
          </Card>

          <Card data-testid="dream-reflections">
            <CardHead title="Reflections about this dream" sub={refreshing ? undefined : reflections.length ? plural(reflections.length, 'reflection') : 'Thoughts, worries, wins — tagged with this dream'} />
            <ReflectionComposer dreamId={dream.id} />
            {refreshing ? <ListSkeleton /> : reflections.length === 0 ? (
              <EmptyState icon={<IconPen />} title="Nothing written yet">Reflections you tag with this dream will gather here — alongside the numbers, your words.</EmptyState>
            ) : (
              <div className="stack dd-reflections">
                {reflections.map((r) => (
                  <JournalEntryCard key={r.id} entry={r} dreamerRef="me" mode="dreamer" dreams={dreamRefs} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {(prev || next) && (
        <nav className="dd-pager-bottom" aria-label="Other dreams">
          {prev ? (
            <Link to={`/dreams/${prev.id}`} className="card dd-pager-card" data-testid="dream-prev-card">
              <span className="muted tiny dd-pager-dir"><IconChevronLeft /> Previous · {prev.slotLabel}</span>
              <span className="dd-pager-title">{prev.title}</span>
            </Link>
          ) : <span />}
          {next ? (
            <Link to={`/dreams/${next.id}`} className="card dd-pager-card dd-pager-card-next" data-testid="dream-next-card">
              <span className="muted tiny dd-pager-dir">Next · {next.slotLabel} <IconChevronRight /></span>
              <span className="dd-pager-title">{next.title}</span>
            </Link>
          ) : <span />}
        </nav>
      )}

      <DreamsProgressDialog dream={dream} refreshing={refreshing} open={updating} onClose={() => setUpdating(false)} />
    </div>
  );
}

function ListSkeleton() {
  return <div className="stack" aria-busy><Skeleton h={22} w="70%" /><Skeleton h={22} w="55%" /></div>;
}

/* ---------- Progress history row ---------- */

/** A 409 the dreamer can act on (a hidden note, a value that can't be shared back) reads as information, not an alarm. */
const isConflict = (e: unknown) => e instanceof ApiRequestError && e.code === 'conflict';

/**
 * What the editor holds, kept by the page while it is open (through a list reload, or showing private entries from
 * it). `seenNote` is the note it started from; `hiddenNote`: saving found a note hidden right now; `merged`: a note
 * that came into view since was put above what was typed.
 */
type EditDraft = { value: number; note: string; notePrivate: boolean; hiddenNote: boolean; seenNote: ProgressEntry['note']; merged: boolean };
const editDraftOf = (e: ProgressEntry): EditDraft => ({ value: e.value, note: e.note?.body ?? '', notePrivate: e.note?.isPrivate ?? false, hiddenNote: false, seenNote: e.note, merged: false });
/** A private note, or a draft holding a private note's words. */
const editDraftPrivate = (d: EditDraft) => (d.notePrivate && d.note.trim().length > 0) || !!d.seenNote?.isPrivate;

function ProgressRow({ entry, previous, cellTaken }: { entry: ProgressEntry; previous: ProgressEntry | null; cellTaken: boolean }) {
  const { auth, unlockPrivate } = useAuth();
  const { toast } = useToast();
  const update = useUpdateProgress('me');
  const remove = useDeleteProgress('me');
  const [confirmHide, setConfirmHide] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { draft, setDraft, patchDraft, covered } = useKeptDraft<EditDraft>(`progress-${entry.id}`, editDraftPrivate);
  const [unlocking, setUnlocking] = useState(false);
  const editingNote = draft !== null && !unlocking;
  // Private entries were shown from the editor, so a note that was hidden is in view now: start from it (and its
  // privacy), keeping anything typed below it. Saving can then never write over a note unseen. A note going out of
  // view while the draft isn't covered takes its text with it, since it may hold its words.
  if (draft && !covered && entry.note?.id !== draft.seenNote?.id) {
    const typed = entry.note && draft.note.trim() !== (draft.seenNote?.body ?? '') ? draft.note.trim() : '';
    setDraft({ ...draft, seenNote: entry.note, note: [entry.note?.body, typed].filter(Boolean).join('\n\n'), notePrivate: entry.note?.isPrivate ?? false, merged: !!typed });
  }
  const isSession = entry.source === 'session';
  // A private session value whose session was later deleted: it belongs to no session any more.
  const detached = isSession && entry.sessionId == null;
  // A hidden session value can be shared back only while its session has no shared value for this dream (DECISIONS #14).
  const shareBlocked = isSession && entry.isPrivate && (detached || cellTaken);
  const delta = previous ? entry.value - previous.value : null;
  const unlocked = !!auth?.privateUnlocked;
  // Private session values (and detached ones) are the dreamer's to remove: staff can't see them.
  const canDelete = !isSession || entry.isPrivate;

  const setPrivacy = async (isPrivate: boolean) => {
    try {
      await update.mutateAsync({ progressId: entry.id, isPrivate });
      privacyToast(toast, isPrivate, unlocked, isSession ? 'This update is shared with your coach again.' : 'This update is shared with your coach.', 'This update is now private.');
    } catch (e) {
      toast(errorMessage(e), isConflict(e) ? 'info' : 'error');
    }
  };
  const setNotePrivacy = async (notePrivate: boolean) => {
    try {
      await update.mutateAsync({ progressId: entry.id, notePrivate });
      privacyToast(toast, notePrivate, unlocked, 'Your note is shared with your coach.', 'Your note is now private.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const doDelete = async () => {
    try {
      await remove.mutateAsync(entry.id);
      setConfirmDelete(false);
      toast('Update removed.', 'info');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  // The editor asked to show private entries (a note is hidden under it, or its draft is covered). It makes way for
  // the password dialog and then opens again with what was typed (below the note once it is in view).
  const askUnlock = () => setUnlocking(true);
  const onUnlockClosed = () => setUnlocking(false);
  const closeEditor = () => setDraft(null);

  const recorded = detached
    ? `in a coaching session with ${entry.recordedBy.name} that was later removed`
    : `in a coaching session with ${entry.recordedBy.name} on ${fmtDate(entry.occurredAt)}`;
  const deleteBody = isSession
    ? `This removes the ${entry.value}% recorded ${recorded}${entry.note ? ', and your note on it' : ''}. It is private, so your coach doesn’t see it and nothing changes for them. This can’t be undone.`
    : `This removes the ${entry.value}% recorded on ${fmtDate(entry.occurredAt)}${entry.note ? ' and its note' : ''}. This can’t be undone.`;

  return (
    <div className={`list-item dd-entry${entry.isPrivate ? ' dd-entry-private' : ''}`} data-testid="progress-entry" data-entry-id={entry.id} data-source={entry.source}>
      <div className="dd-entry-value">
        <span className="dd-entry-pct tnum">{entry.value}%</span>
        {delta != null ? <Delta value={delta} digits={0} suffix=" pts" /> : <span className="muted tiny">first</span>}
      </div>
      <div className="grow dd-entry-body">
        <div className="row-wrap dd-entry-meta">
          <SourceChip source={entry.source} coachName={isSession && !detached ? entry.recordedBy.name : undefined} />
          {entry.isPrivate && <PrivateChip />}
          <span className="muted small tnum">{fmtDateTime(entry.occurredAt)}</span>
        </div>
        {entry.note && (
          // A note on a private update is private along with it; the update's own chip says so.
          <div className={`note-block${entry.note.isPrivate || entry.isPrivate ? ' private' : ''}`} data-testid="progress-entry-note">
            {entry.note.isPrivate && !entry.isPrivate && <span className="dd-note-lock" title="Only you can see this note"><IconLock /> Private note</span>}
            {entry.note.body}
          </div>
        )}
      </div>
      <Dropdown
        trigger={(open) => (
          <Button variant="ghost" icon size="sm" aria-label="Options for this update" aria-expanded={open} data-testid="progress-entry-menu" loading={update.isPending && !editingNote}><IconMore /></Button>
        )}
      >
        {!detached && !shareBlocked && (
          <button type="button" className="menu-item" onClick={() => (entry.isPrivate ? void setPrivacy(false) : isSession ? setConfirmHide(true) : void setPrivacy(true))} data-testid="progress-entry-privacy">
            {entry.isPrivate ? <><IconUnlock /> Share update with coach</> : <><IconLock /> Make update private</>}
          </button>
        )}
        <button type="button" className="menu-item" onClick={() => setDraft(editDraftOf(entry))} data-testid="progress-entry-edit">
          <IconEdit /> {entry.note ? (isSession ? 'Edit note' : 'Edit value or note') : isSession ? 'Add a note' : 'Edit value or add a note'}
        </button>
        {entry.note && !entry.isPrivate && (
          <button type="button" className="menu-item" onClick={() => void setNotePrivacy(!entry.note!.isPrivate)} data-testid="progress-entry-note-privacy">
            {entry.note.isPrivate ? <><IconUnlock /> Share note with coach</> : <><IconLock /> Make note private</>}
          </button>
        )}
        {canDelete && (
          <>
            <div className="divider" />
            <button type="button" className="menu-item dd-menu-danger" onClick={() => setConfirmDelete(true)} data-testid="progress-entry-delete"><IconTrash /> Delete update</button>
          </>
        )}
        {isSession && (
          <div className="dd-menu-note muted tiny" data-testid="progress-entry-menu-note">
            {detached
              ? 'Its coaching session was later removed, so this value stays private.'
              : shareBlocked
                ? 'Your coach recorded a new value for this session after you hid this one, so this one stays private.'
                : 'Recorded by your coach — the value itself is changed in a session.'}
          </div>
        )}
      </Dropdown>

      <ConfirmDialog
        open={confirmHide}
        onClose={() => setConfirmHide(false)}
        onConfirm={() => { setConfirmHide(false); void setPrivacy(true); }}
        title="Make this session value private?"
        body={`This ${entry.value}% was recorded in a coaching session with ${entry.recordedBy.name}. Making it private removes it from your coach’s views — their charts, the session grid and your shared history. You can share it again later, unless your coach records a new value for that session in the meantime.`}
        confirmLabel="Make private"
        loading={update.isPending}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
        title="Delete this update?"
        body={deleteBody}
        confirmLabel="Delete update"
        danger
        loading={remove.isPending}
      />
      {editingNote && <EntryEditDialog entry={entry} draft={draft} onChange={patchDraft} covered={covered} onClose={closeEditor} onShowPrivate={askUnlock} />}
      <UnlockDialog open={unlocking} onClose={onUnlockClosed} onUnlock={unlockPrivate} />
    </div>
  );
}

/** Edit an entry: value (own self check-ins only) and the attached note with its privacy. The draft is the row's. */
function EntryEditDialog({ entry, draft, onChange, covered, onClose, onShowPrivate }: {
  entry: ProgressEntry;
  draft: EditDraft;
  onChange: (patch: Partial<EditDraft>) => void;
  /** The draft held a private note when private entries went out of view: it waits, covered, until they're shown. */
  covered: boolean;
  onClose: () => void;
  onShowPrivate: () => void;
}) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const update = useUpdateProgress('me');
  const isSession = entry.source === 'session';
  const unlocked = !!auth?.privateUnlocked;
  // With private entries hidden, a note the dreamer can't see may already sit under this entry (`hiddenNote`).
  const { value, note, notePrivate, hiddenNote, merged } = draft;
  const setValue = (v: number) => onChange({ value: v });
  const setNote = (v: string) => onChange({ note: v });
  const setNotePrivate = (v: boolean) => onChange({ notePrivate: v });
  const setHiddenNote = (v: boolean) => onChange({ hiddenNote: v });
  const [error, setError] = useState<string | null>(null);
  const hasNote = note.trim().length > 0;

  const save = async () => {
    setError(null);
    setHiddenNote(false);
    const patch: { progressId: number; value?: number; note?: string | null; notePrivate?: boolean } = { progressId: entry.id };
    if (!isSession && value !== entry.value) patch.value = value;
    const trimmed = note.trim();
    if (trimmed !== (entry.note?.body ?? '')) patch.note = trimmed ? trimmed : null;
    if (trimmed && notePrivate !== (entry.note?.isPrivate ?? false)) patch.notePrivate = notePrivate;
    // A new note on a private update is private too, so it stays private if the update is shared later.
    if (trimmed && !entry.note) patch.notePrivate = notePrivate || entry.isPrivate;
    if (patch.value === undefined && patch.note === undefined && patch.notePrivate === undefined) { onClose(); return; }
    try {
      await update.mutateAsync(patch);
      // Judge by what was asked for, never by the response: it only carries what can be seen right now.
      const madePrivate = !entry.isPrivate && patch.notePrivate === true && !entry.note?.isPrivate;
      privacyToast(toast, madePrivate, unlocked, patch.note === null ? 'Note removed.' : 'Update saved.', 'Saved — your note is private.');
      onClose();
    } catch (e) {
      if (isConflict(e) && !unlocked) setHiddenNote(true);
      else setError(errorMessage(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isSession ? (entry.note ? 'Edit note' : 'Add a note') : 'Edit update'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={update.isPending} data-testid="entry-edit-save">Save</Button>
        </>
      }
    >
      <div className="stack dd-dialog" data-testid="entry-edit-dialog">
        <div className="row-wrap">
          <SourceChip source={entry.source} coachName={isSession && entry.sessionId != null ? entry.recordedBy.name : undefined} />
          <span className="muted small">{fmtDateTime(entry.occurredAt)}</span>
        </div>
        {isSession ? (
          <div className="callout callout-muted">
            <IconInfo />
            <span>
              {entry.sessionId == null
                ? `The ${entry.value}% was recorded by ${entry.recordedBy.name} in a coaching session that was later removed. You can add your own note to it, or delete it from the menu.`
                : `The ${entry.value}% was recorded by ${entry.recordedBy.name} during your session. You can add your own note to it; the value itself is changed in a session.`}
            </span>
          </div>
        ) : (
          <Field label="Progress">
            <PercentInput value={value} onChange={setValue} color={DREAM_COLOR} label="Progress" />
          </Field>
        )}
        {covered ? <CoveredDraft onShowPrivate={onShowPrivate} testId="entry-edit-covered" /> : (
          <Field label="Note" htmlFor={`dd-entry-note-${entry.id}`} hint={entry.note ? 'Clear the text to remove the note.' : undefined}>
            <TextArea id={`dd-entry-note-${entry.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What was behind this number?" data-testid="entry-edit-note" />
          </Field>
        )}
        {merged && !covered && <div className="muted tiny" data-testid="entry-edit-kept">Your private note is back, with what you typed below it.</div>}
        {hasNote && !covered && !entry.isPrivate && (
          <div className="spread dd-privacy-row">
            <span className="small">Your note</span>
            <span data-testid="entry-edit-note-private"><PrivacyToggle value={notePrivate} onChange={setNotePrivate} /></span>
          </div>
        )}
        {hasNote && entry.isPrivate && <div className="muted tiny">This update is private, so its note is private too.</div>}
        {hiddenNote && !unlocked && (
          <div className="callout callout-private dd-hidden-note" role="status" data-testid="entry-edit-hidden-note">
            <IconLock />
            <div className="dd-hidden-note-body">
              <span>This update already has a note that is hidden right now. Show private entries to see it and edit it here — what you typed stays.</span>
              <Button variant="secondary" size="sm" onClick={onShowPrivate} data-testid="entry-edit-show-private"><IconUnlock /> Show private entries</Button>
            </div>
          </div>
        )}
        {error && <div className="callout callout-muted" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/* ---------- Reflection composer ---------- */

function ReflectionComposer({ dreamId }: { dreamId: number }) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const create = useCreateJournal('me');
  const [body, setBody] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const hasText = body.trim().length > 0;
  const expanded = focused || hasText;
  // A private reflection being written stays here, covered, while private entries are hidden.
  const covered = useCovered(isPrivate && hasText);

  // Fold away and let go of focus (the buttons below keep it in the text box while pressed).
  const reset = () => { setBody(''); setIsPrivate(false); setFocused(false); box.current?.blur(); };
  const save = async () => {
    setError(null);
    try {
      await create.mutateAsync({ body: body.trim(), isPrivate, dreamId });
      privacyToast(toast, isPrivate, !!auth?.privateUnlocked, 'Reflection saved.', 'Reflection saved as private.');
      reset();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  // Stay open while focus moves within the composer (to the privacy switch or its buttons); fold away once it leaves empty.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!hasText && !e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
  };

  return (
    <div className={`dd-reflect${expanded ? ' expanded' : ''}`} onBlur={onBlur} data-testid="reflection-composer">
      {covered ? <CoveredDraft testId="reflection-covered" /> : (
        <TextArea
          ref={box}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => setFocused(true)}
          rows={expanded ? 3 : 1}
          placeholder="Write about this dream…"
          aria-label="Write about this dream"
          data-testid="reflection-body"
        />
      )}
      {expanded && (
        // Pressing a control here keeps focus in the text box (some browsers never focus a pressed button).
        <div className="spread dd-reflect-foot fade-in" onMouseDown={(e) => e.preventDefault()}>
          {covered ? <span /> : <span data-testid="reflection-private"><PrivacyToggle value={isPrivate} onChange={setIsPrivate} size="sm" /></span>}
          <div className="row">
            <Button variant="ghost" size="sm" onClick={reset} disabled={create.isPending}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={!hasText} loading={create.isPending} data-testid="reflection-save">Save reflection</Button>
          </div>
        </div>
      )}
      {error && <div className="callout callout-muted" role="alert" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
