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
import { Bar, Button, Card, CardHead, ConfirmDialog, Delta, Dropdown, EmptyState, Field, LoadingPage, Modal, PercentInput, PrivacyToggle, PrivateChip, Segmented, SourceChip, TextArea } from '@/components/ui';
import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconCompass, IconEdit, IconInfo, IconLock, IconMore, IconPen, IconPlus, IconTarget, IconTrash, IconUnlock } from '@/components/icons';
import { SourceLegend, TrendChart, type TrendPoint } from '@/components/charts';
import { useToast } from '@/components/toast';
import { fmtDate, fmtDateTime, firstName, plural, relativeTime } from '@/lib/format';
import { ActionComposer, ActionList } from '@/features/shared/ActionItems';
import { JournalEntryCard } from '@/features/shared/Timeline';
import { UnlockDialog } from '@/features/shared/PrivacyControl';
import type { Dream, DreamHistory, ProgressEntry } from '@shared/types';
import { DREAM_COLOR, DreamsProgressDialog, privacyToast } from './DreamsProgressDialog';
import { DreamsEditForm } from './DreamsEditDialog';
import { AchievedChip } from './DreamsPage';
import { SessionDelta, dreamBaseline } from './HomePage';

export function DreamDetailPage() {
  const params = useParams();
  const dreamId = Number(params.dreamId);
  const validId = Number.isInteger(dreamId) && dreamId > 0;
  const history = useDreamHistory('me', validId ? dreamId : null);
  const dreams = useDreams('me');
  const overview = useOverview('me');

  if (!validId || (history.isError && history.error instanceof ApiRequestError && history.error.status === 404)) {
    return (
      <div className="page page-narrow">
        <EmptyState icon={<IconCompass />} title="That dream isn’t here" action={<Link to="/dreams" className="btn btn-primary">Back to your dreams</Link>}>
          It may have been a mistyped link. Your four dreams are waiting on the dreams page.
        </EmptyState>
      </div>
    );
  }
  if (history.isPending) return <LoadingPage label="Opening your dream…" />;
  if (history.isError) {
    return (
      <div className="page page-narrow">
        <Link to="/dreams" className="dd-back"><IconArrowLeft /> All dreams</Link>
        <div className="callout callout-muted" role="alert" style={{ marginTop: 16 }}><IconInfo /><span>{errorMessage(history.error)}</span></div>
      </div>
    );
  }

  const all = dreams.data ?? [];
  const guidance = overview.data?.dreamer.program.slotGuidance[history.data.dream.slot - 1];
  return <DreamDetail history={history.data} dreams={all} guidance={guidance} />;
}

function DreamDetail({ history, dreams, guidance }: { history: DreamHistory; dreams: Dream[]; guidance?: string }) {
  const { dream, entries, actions, reflections } = history;
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

      <Card className="dd-hero" data-testid="dream-hero">
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
              <span>{latest.source === 'session' ? `Recorded in a coaching session with ${firstName(latest.recordedBy.name)}` : 'From a self check-in'}</span>
            </>
          ) : (
            <span>Record your first update to start this dream’s story.</span>
          )}
          <span>{activeCount === 0 ? 'No active actions' : plural(activeCount, 'active action')}</span>
        </div>
        {achieved && <p className="dd-achieved-note">Achieved on {fmtDate(dream.achievedAt!, { month: 'long', day: 'numeric' })}. You made this one real — it stays here as a reminder of what you can do.</p>}
      </Card>

      <div className="dd-detail-grid">
        <div className="stack dd-col">
          <Card data-testid="dream-chart">
            <CardHead title="Progress over time" sub={entries.length ? `${plural(entries.length, 'update')} · solid dots are coaching sessions, hollow dots are your own check-ins` : 'Your updates will draw a line here'} />
            <div className="dd-chart-wrap">
              <TrendChart points={points} max={100} unit="%" color={DREAM_COLOR} height={240} emptyLabel="No progress recorded yet" />
            </div>
            {entries.length > 0 && <div style={{ marginTop: 10 }}><SourceLegend color={DREAM_COLOR} /></div>}
          </Card>

          <Card data-testid="dream-history">
            <CardHead title="Progress history" sub={entries.length ? 'Newest first. Notes travel with the update they belong to.' : undefined} />
            {newestFirst.length === 0 ? (
              <EmptyState icon={<IconTarget />} title="No progress recorded yet" action={<Button variant="primary" onClick={() => setUpdating(true)} data-testid="dream-history-first">Record your first update</Button>}>
                Every update you or your coach record will appear here, with its notes.
              </EmptyState>
            ) : (
              <div className="list dd-entries">
                {newestFirst.map((e, i) => (
                  <ProgressRow key={e.id} entry={e} previous={newestFirst[i + 1] ?? null} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack dd-col">
          <Card data-testid="dream-actions">
            <CardHead
              title="Actions for this dream"
              sub={actions.length ? `${activeCount} active · ${completedCount} completed` : 'Small steps that move this dream'}
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
              <ActionList
                dreamerRef="me"
                actions={actions}
                dreams={dreamRefs}
                mode="dreamer"
                filter={actionFilter}
                emptyTitle={actionFilter === 'active' ? 'No active actions' : actionFilter === 'completed' ? 'Nothing completed yet' : 'No actions yet'}
                emptyBody={actionFilter === 'active' ? 'Add a small next step for this dream — something you could do this week.' : actionFilter === 'completed' ? 'Completed actions linked to this dream will gather here.' : 'Actions you link to this dream will show up here.'}
              />
            </div>
          </Card>

          <Card data-testid="dream-reflections">
            <CardHead title="Reflections about this dream" sub={reflections.length ? plural(reflections.length, 'reflection') : 'Thoughts, worries, wins — tagged with this dream'} />
            <ReflectionComposer dreamId={dream.id} />
            {reflections.length === 0 ? (
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

      <DreamsProgressDialog dream={dream} open={updating} onClose={() => setUpdating(false)} />
    </div>
  );
}

/* ---------- Progress history row ---------- */

/** A 409 the dreamer can act on (a hidden note, a value that can't be shared back) reads as information, not an alarm. */
const isConflict = (e: unknown) => e instanceof ApiRequestError && e.code === 'conflict';

function ProgressRow({ entry, previous }: { entry: ProgressEntry; previous: ProgressEntry | null }) {
  const { auth, unlockPrivate } = useAuth();
  const { toast } = useToast();
  const update = useUpdateProgress('me');
  const remove = useDeleteProgress('me');
  const [confirmHide, setConfirmHide] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const reopenEditor = useRef(false);
  const isSession = entry.source === 'session';
  // A private session value whose session was later deleted: it belongs to no session any more.
  const detached = isSession && entry.sessionId == null;
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
  // The editor asked to show private entries (a note is hidden under it): unlock, then open it again on the real note.
  const askUnlock = () => { setEditingNote(false); setUnlocking(true); };
  const onUnlockClosed = () => {
    setUnlocking(false);
    if (reopenEditor.current) { reopenEditor.current = false; setEditingNote(true); }
  };

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
        {!detached && (
          <button type="button" className="menu-item" onClick={() => (entry.isPrivate ? void setPrivacy(false) : isSession ? setConfirmHide(true) : void setPrivacy(true))} data-testid="progress-entry-privacy">
            {entry.isPrivate ? <><IconUnlock /> Share update with coach</> : <><IconLock /> Make update private</>}
          </button>
        )}
        <button type="button" className="menu-item" onClick={() => setEditingNote(true)} data-testid="progress-entry-edit">
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
      </Dropdown>

      <ConfirmDialog
        open={confirmHide}
        onClose={() => setConfirmHide(false)}
        onConfirm={() => { setConfirmHide(false); void setPrivacy(true); }}
        title="Make this session value private?"
        body={`This ${entry.value}% was recorded in a coaching session with ${entry.recordedBy.name}. Making it private removes it from your coach’s views — their charts, the session grid and your shared history. You can share it again at any time.`}
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
      {/* Keyed by the note under it: if a hidden note comes into view, the editor starts again from it rather than writing over it. */}
      {editingNote && <EntryEditDialog key={entry.note?.id ?? 'no-note'} entry={entry} onClose={() => setEditingNote(false)} onShowPrivate={askUnlock} />}
      <UnlockDialog
        open={unlocking}
        onClose={onUnlockClosed}
        onUnlock={async (password) => { const a = await unlockPrivate(password); reopenEditor.current = true; return a; }}
      />
    </div>
  );
}

/** Edit an entry: value (own self check-ins only) and the attached note with its privacy. */
function EntryEditDialog({ entry, onClose, onShowPrivate }: { entry: ProgressEntry; onClose: () => void; onShowPrivate: () => void }) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const update = useUpdateProgress('me');
  const isSession = entry.source === 'session';
  const unlocked = !!auth?.privateUnlocked;
  const [value, setValue] = useState(entry.value);
  const [note, setNote] = useState(entry.note?.body ?? '');
  const [notePrivate, setNotePrivate] = useState(entry.note?.isPrivate ?? false);
  const [error, setError] = useState<string | null>(null);
  // With private entries hidden, a note the dreamer can't see may already sit under this entry.
  const [hiddenNote, setHiddenNote] = useState(false);
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
        <Field label="Note" htmlFor={`dd-entry-note-${entry.id}`} hint={entry.note ? 'Clear the text to remove the note.' : undefined}>
          <TextArea id={`dd-entry-note-${entry.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What was behind this number?" data-testid="entry-edit-note" />
        </Field>
        {hasNote && !entry.isPrivate && (
          <div className="spread dd-privacy-row">
            <span className="small">Your note</span>
            <span data-testid="entry-edit-note-private"><PrivacyToggle value={notePrivate} onChange={setNotePrivate} /></span>
          </div>
        )}
        {hasNote && entry.isPrivate && <div className="muted tiny">This update is private, so its note is private too.</div>}
        {hiddenNote && (
          <div className="callout callout-private dd-hidden-note" role="status" data-testid="entry-edit-hidden-note">
            <IconLock />
            <div className="dd-hidden-note-body">
              <span>This update already has a note that is hidden right now. Show private entries to see it and edit it here.</span>
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
      {expanded && (
        // Pressing a control here keeps focus in the text box (some browsers never focus a pressed button).
        <div className="spread dd-reflect-foot fade-in" onMouseDown={(e) => e.preventDefault()}>
          <span data-testid="reflection-private"><PrivacyToggle value={isPrivate} onChange={setIsPrivate} size="sm" /></span>
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
