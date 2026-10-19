/**
 * The live one-on-one workspace. Modelled on the coach's spreadsheet: months sit
 * side by side in the grid and the current session's column is editable. The
 * six-step sequence (CARE → dreams → review actions → commitment → new focus &
 * actions → satisfaction) is a checklist in the sidebar, not a wizard — the coach
 * can enter anything in any order during a 15-minute conversation.
 *
 * Staff page: numeric dreamer id from the route; the server returns only what the
 * coach may see, so nothing here filters or mentions privacy.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CARE_CATEGORIES, CATEGORY_META, type RatingCategory } from '@shared/care';
import type { ActionItem, CheckIn, CoachingSession, JournalEntry, SessionGrid } from '@shared/types';
import { useActions, useCheckIns, useDeleteSession, useDreams, useGrid, useJournal, useOverview, useSession, useSetSessionProgress, useSetSessionRating, useUpdateSession } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { presentPath, staffDreamerPath } from '@/app/routes';
import { useToast } from '@/components/toast';
import { Avatar, Bar, Button, Card, CardHead, CategoryChip, Chip, ConfirmDialog, EmptyState, Field, LoadingPage, Modal, SourceChip, TextArea, TextInput } from '@/components/ui';
import { IconArrowLeft, IconCalendar, IconCheck, IconClock, IconEdit, IconInfo, IconPresent, IconRotate, IconTrash } from '@/components/icons';
import { dayKey, fmtDate, fmtDateTime, fmtTime, fromLocalInputValue, relativeTime, toLocalInputValue } from '@/lib/format';
import { ActionComposer, ActionList, type ActionComposerHandle, type OpenActionEdit } from '@/features/shared/ActionItems';
import { SessionGridView } from './SessionGridView';
import { activityAt, isSessionValueNote } from './journalActivity';
import { textShade } from '@/lib/color';

/* ---------- Autosave (700 ms debounce) ---------- */

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
const STATUS_RANK: Record<SaveStatus, number> = { idle: 0, saved: 1, pending: 2, saving: 3, error: 4 };
const combineStatus = (a: SaveStatus, b: SaveStatus): SaveStatus => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

function useAutosave(serverValue: string, save: (value: string) => Promise<unknown>, delay = 700) {
  const [text, setText] = useState(serverValue);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const dirty = useRef(false);
  const saving = useRef(false);
  const latest = useRef(serverValue);
  const timer = useRef<number | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty.current) { setText(serverValue); latest.current = serverValue; }
  }, [serverValue]);

  const flush = useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    // While a save is on its way, newer text is picked up when it lands.
    if (!dirty.current || saving.current) return;
    const v = latest.current;
    saving.current = true;
    setStatus('saving');
    const run = (async () => {
      try {
        await saveRef.current(v);
        if (latest.current === v) { dirty.current = false; setStatus('saved'); }
        else { setStatus('pending'); timer.current = window.setTimeout(() => void flush(), delay); }
      } catch {
        setStatus('error');
      } finally {
        saving.current = false;
      }
    })();
    inflight.current = run;
    await run;
  }, [delay]);

  /** Waits for a save on its way, then sends anything newer (or what failed); resolves whether the text is saved. */
  const settle = useCallback(async () => {
    while (saving.current && inflight.current) await inflight.current;
    if (dirty.current) await flush();
    return !dirty.current;
  }, [flush]);

  const onChange = useCallback((v: string) => {
    setText(v);
    latest.current = v;
    dirty.current = true;
    setStatus('pending');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), delay);
  }, [delay, flush]);

  // Never lose a half-typed note when the page unmounts (e.g. Complete → navigate).
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); if (dirty.current) void saveRef.current(latest.current); }, []);

  // Closing or reloading the tab unmounts nothing: save as soon as the tab is hidden or about to
  // go, and let the browser ask before leaving while the text isn't saved yet.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirty.current) { void flush(); e.preventDefault(); } };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flush]);

  return { text, onChange, status, flush, settle, isDirty: () => dirty.current };
}

function SaveIndicator({ status, testId }: { status: SaveStatus; testId?: string }) {
  if (status === 'idle') return null;
  const label = status === 'saving' ? 'Saving…' : status === 'pending' ? 'Unsaved changes' : status === 'error' ? 'Couldn’t save — check your connection' : 'Saved';
  return (
    <span className={`cs-save cs-save-${status}`} role="status" aria-live="polite" data-testid={testId}>
      {status === 'saved' && <IconCheck />}
      {label}
    </span>
  );
}

/** "A value in the grid and the session notes" — what didn't save, as the start of a sentence. */
function unsavedList(items: string[]) {
  const text = new Intl.ListFormat('en', { type: 'conjunction' }).format(items);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The question before completing or leaving with typed work: an action not added yet, edits not saved. */
function typedQuestion(draft: string, edits: string[], when: 'completing' | 'leaving') {
  if (draft && edits.length === 0) return `Add “${draft}” before ${when}?`;
  if (!draft && edits.length === 1) return `Save the change to “${edits[0]}” before ${when}?`;
  if (!draft) return `Save the changes to ${edits.length} actions before ${when}?`;
  return `Add “${draft}” and save your changes before ${when}?`;
}

/* ---------- Session date (datetime-local, inline) ---------- */

// Like the server, allow a few minutes' clock drift but no future dates (usually a mistyped year).
const FUTURE_SLACK_MS = 5 * 60_000;

function SessionDateEditor({ value, onChange, busy }: { value: string; onChange: (iso: string) => void; busy: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(toLocalInputValue(value));
  useEffect(() => { if (!editing) setDraft(toLocalInputValue(value)); }, [value, editing]);

  const commit = () => {
    if (draft && !Number.isNaN(new Date(draft).getTime())) {
      const iso = fromLocalInputValue(draft);
      if (Date.parse(iso) > Date.now() + FUTURE_SLACK_MS) toast('A session can’t be dated in the future. Pick today or an earlier date.', 'error');
      else if (iso !== value) onChange(iso);
    }
    setEditing(false);
  };

  if (!editing) {
    return (
      <button type="button" className="cs-date-btn" onClick={() => setEditing(true)} title="Change the session date and time. Sessions are numbered by date." aria-label={`Session date ${fmtDateTime(value)}. Change`} data-testid="session-date" disabled={busy}>
        <IconCalendar />
        <span>{fmtDate(value, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtTime(value)}</span>
      </button>
    );
  }
  return (
    <input
      type="datetime-local"
      className="cs-date-input"
      value={draft}
      max={toLocalInputValue(new Date().toISOString())}
      autoFocus
      aria-label="Session date and time"
      data-testid="session-date-input"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setDraft(toLocalInputValue(value)); setEditing(false); }
      }}
    />
  );
}

/* ---------- Page ---------- */

export function SessionWorkspacePage() {
  const params = useParams();
  const id = Number(params.dreamerId);
  const sid = Number(params.sessionId);
  const valid = Number.isInteger(id) && id > 0 && Number.isInteger(sid) && sid > 0;
  const nav = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const overview = useOverview(id, { enabled: valid });
  const grid = useGrid(id);
  const session = useSession(id, valid ? sid : null);
  const actions = useActions(id, 'all');
  const dreams = useDreams(id);
  const checkIns = useCheckIns(id);
  const journal = useJournal(id);

  const setRating = useSetSessionRating(id);
  const setProgress = useSetSessionProgress(id);
  const updateSession = useUpdateSession(id);
  // Notes/focus autosave runs on its own mutation: a blur-triggered save must never put
  // "Complete session" into its loading state (disabled, shrunk) in the middle of a click.
  const autosaveSession = useUpdateSession(id);
  const deleteSession = useDeleteSession(id);

  const [editValues, setEditValues] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [gridStatus, setGridStatus] = useState<SaveStatus>('idle');
  const [dateBusy, setDateBusy] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);

  const s = session.data;

  // Put the server's answer straight into the cache so the checklist and grid update at once.
  const applySession = useCallback((data: CoachingSession) => {
    qc.setQueryData(['dreamer', id, 'session', sid], data);
    qc.setQueryData<SessionGrid>(['dreamer', id, 'grid'], (g) => (g ? { ...g, sessions: g.sessions.map((x) => (x.id === data.id ? data : x)) } : g));
  }, [qc, id, sid]);

  const { mutateAsync: patchSession } = autosaveSession;
  const saveNotes = useCallback((value: string) => patchSession({ sessionId: sid, notes: value }).then((data) => { applySession(data); return data; }), [patchSession, sid, applySession]);
  const saveFocus = useCallback((value: string) => patchSession({ sessionId: sid, focus: value }).then((data) => { applySession(data); return data; }), [patchSession, sid, applySession]);
  const notes = useAutosave(s?.notes ?? '', saveNotes);
  const focus = useAutosave(s?.focus ?? '', saveFocus);
  const notesStatus = combineStatus(notes.status, focus.status);

  // "Review previous actions" is the one step nothing can be inferred from, so its tick is saved
  // with the session. It shows at once and comes back from the server if the save fails.
  const reviewed = s?.actionsReviewed ?? false;
  const setReviewed = (value: boolean) => {
    if (!s) return;
    applySession({ ...s, actionsReviewed: value });
    // The hook's input type predates `actionsReviewed`; the body is passed to the PATCH as is.
    const body: Parameters<typeof patchSession>[0] & { actionsReviewed: boolean } = { sessionId: sid, actionsReviewed: value };
    patchSession(body).then(applySession, (e) => { toast(errorMessage(e), 'error'); void session.refetch(); });
  };

  // Each grid write reports on its own, so in fast entry a failure is never hidden behind the next save.
  // A value that didn't save stays marked on its cell until it goes through, and Complete sends it again.
  const gridWrites = useRef({ inflight: new Set<Promise<unknown>>(), seq: new Map<string, number>(), failed: new Map<string, () => Promise<unknown>>(), toastedAt: 0 });
  const [gridUnsaved, setGridUnsaved] = useState(0);
  const writeGrid = (key: string, write: () => Promise<CoachingSession>): Promise<CoachingSession> => {
    const w = gridWrites.current;
    const n = (w.seq.get(key) ?? 0) + 1;
    w.seq.set(key, n);
    setGridStatus('saving');
    const settle = () => {
      w.inflight.delete(p);
      setGridUnsaved(w.failed.size);
      if (w.inflight.size === 0) setGridStatus(w.failed.size > 0 ? 'error' : 'saved');
    };
    const p = write().then(
      (data) => {
        applySession(data);
        if (w.seq.get(key) === n) w.failed.delete(key);
        settle();
        return data;
      },
      (e: unknown) => {
        // Only the newest write for a cell counts: an older one failing after it changes nothing.
        if (w.seq.get(key) === n) {
          w.failed.set(key, () => writeGrid(key, write));
          // Once per burst, not once per keystroke: the cells and the status say the rest.
          if (Date.now() - w.toastedAt > 5000) {
            w.toastedAt = Date.now();
            toast(`${errorMessage(e).replace(/\.$/, '')}. That value isn’t saved — it’s marked in the grid so you can try again.`, 'error');
          }
        }
        settle();
        throw e;
      },
    );
    w.inflight.add(p);
    return p;
  };
  const onRating = (category: RatingCategory, value: number | null) =>
    writeGrid(`rating-${category}`, () => setRating.mutateAsync({ sessionId: sid, category, value }));
  const onProgress = (dreamId: number, value: number | null) =>
    writeGrid(`progress-${dreamId}`, () => setProgress.mutateAsync({ sessionId: sid, dreamId, value }));
  /** Waits for every grid value on its way, then sends again any that failed; resolves whether all of them saved. */
  const settleGrid = async () => {
    const w = gridWrites.current;
    if (w.inflight.size === 0 && w.failed.size === 0) return true;
    // Whoever is waiting says what didn't save, so the per-cell toast stays quiet.
    w.toastedAt = Date.now();
    await Promise.allSettled([...w.inflight]);
    if (w.failed.size === 0) return true;
    return Promise.all([...w.failed.values()].map((retry) => retry())).then(() => true, () => false);
  };

  // Typed work the coach hasn't saved is never dropped silently: an action typed in "New actions" but not
  // added yet, or an inline edit of an action with changes. Completing the session or leaving the page asks first.
  const composerRef = useRef<ActionComposerHandle>(null);
  const [actionDraft, setActionDraft] = useState('');
  const draftTitle = actionDraft.trim();
  const draftRef = useRef('');
  draftRef.current = draftTitle;
  const openEdits = useRef(new Map<number, OpenActionEdit>());
  const [editTitles, setEditTitles] = useState<string[]>([]);
  const onEditChange = useCallback((actionId: number, edit: OpenActionEdit | null) => {
    if (edit) openEdits.current.set(actionId, edit);
    else openEdits.current.delete(actionId);
    setEditTitles([...openEdits.current.values()].map((x) => x.title));
  }, []);
  const hasTyped = () => draftRef.current !== '' || openEdits.current.size > 0;
  const [typedAsk, setTypedAsk] = useState(false);
  const [typedBusy, setTypedBusy] = useState(false);
  /** Adds the typed action and saves the open edits; resolves whether all of it saved (what didn't says why). */
  const saveTyped = async () => {
    const results = await Promise.all([
      draftRef.current ? composerRef.current?.submit() ?? Promise.resolve(false) : Promise.resolve(true),
      ...[...openEdits.current.values()].map((x) => x.save()),
    ]);
    return results.every(Boolean);
  };
  const discardTyped = () => {
    composerRef.current?.discard();
    for (const x of [...openEdits.current.values()]) x.discard();
  };
  // An action added on this page makes the session non-empty before the session itself is fetched again.
  const addedHere = useRef(false);
  const onActionAdded = useCallback(() => { addedHere.current = true; }, []);

  /** Something saved as the coach works is still on its way, or didn't save: a grid value, the focus or notes, an action. */
  const hasUnsaved = () => {
    const w = gridWrites.current;
    return w.inflight.size > 0 || w.failed.size > 0 || focus.isDirty() || notes.isDirty() || !!composerRef.current?.hasUnsaved();
  };
  /**
   * Waits for every save on its way (grid values, focus and notes, actions being added) and sends again
   * whatever failed. Resolves with what still isn't saved — nothing, when all of it is.
   */
  const settleAll = async (): Promise<string[]> => {
    const [gridOk, focusOk, notesOk, notAdded] = await Promise.all([settleGrid(), focus.settle(), notes.settle(), composerRef.current?.settle() ?? Promise.resolve([])]);
    return [
      ...(gridOk ? [] : ['a value in the grid']),
      ...(focusOk ? [] : ['the focus']),
      ...(notesOk ? [] : ['the session notes']),
      ...notAdded.map((title) => `the action “${title}”`),
    ];
  };

  // Set just before this page navigates away itself (completed, deleted), once nothing is left to ask about.
  const leaving = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !leaving.current && currentLocation.pathname !== nextLocation.pathname && (hasTyped() || hasUnsaved()));
  const leave = (to: string) => { leaving.current = true; nav(to); };
  // What still hadn't saved when the coach tried to leave: the page asks whether to leave anyway.
  const [leaveUnsaved, setLeaveUnsaved] = useState<string[] | null>(null);
  /** Leaves once everything on its way has saved; otherwise says what hasn't. */
  const finishLeaving = async (b: typeof blocker) => {
    const missing = await settleAll();
    if (b.state !== 'blocked') return;
    if (missing.length === 0) b.proceed();
    else setLeaveUnsaved(missing);
  };
  useEffect(() => {
    if (blocker.state !== 'blocked') { setLeaveUnsaved(null); return; }
    // Typed work gets its question first; saves still on their way just get a moment to land.
    if (!hasTyped()) void finishLeaving(blocker);
  }, [blocker.state]);

  // Closing or reloading the tab: let the browser ask while any of that is unsaved.
  const unsavedNow = useRef<() => boolean>(() => false);
  unsavedNow.current = () => hasTyped() || hasUnsaved();
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (qc.isMutating() > 0 || unsavedNow.current()) e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [qc]);

  const onDate = (iso: string) => {
    const before = s?.number;
    setDateBusy(true);
    updateSession.mutate({ sessionId: sid, occurredAt: iso }, {
      onSuccess: (data) => {
        applySession(data);
        toast(data.number !== before ? `Session date updated. Sessions are numbered by date, so this one is now Session ${data.number}.` : 'Session date updated.');
      },
      onError: (e) => toast(errorMessage(e), 'error'),
      onSettled: () => setDateBusy(false),
    });
  };

  // Judged like the server does, on what the coach can see: values, notes, focus, actions chosen here, and
  // reflections staff wrote in this session (the dreamer's own words are theirs, not the session's).
  // Typed-but-unsaved notes count too, so the delete button goes away while typing rather than when the
  // autosave lands (which would shift "Complete session" under the pointer).
  const journalHere = (journal.data ?? []).some((j) => j.sessionId === sid && j.author.role !== 'dreamer');
  const recordedNothing = (x: CoachingSession) => Object.keys(x.ratings).length === 0 && Object.keys(x.progress).length === 0 && !notes.text.trim() && !focus.text.trim() && x.actionsCreated === 0 && !journalHere;
  const nothingRecorded = !!s && recordedNothing(s) && gridUnsaved === 0 && gridStatus !== 'saving';
  const isEmpty = nothingRecorded && !draftTitle;

  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const complete = async ({ anyway = false, typed }: { anyway?: boolean; typed?: 'save' | 'discard' } = {}) => {
    if (!s || finishingRef.current) return;
    if (hasTyped()) {
      if (!typed) { setTypedAsk(true); return; }
      if (typed === 'save') {
        setTypedBusy(true);
        const ok = await saveTyped();
        setTypedBusy(false);
        setTypedAsk(false);
        // What didn't save keeps its words and says why; the session stays open.
        if (!ok) { toast('Not everything typed could be saved, so the session is still open.', 'error'); return; }
      } else {
        discardTyped();
        setTypedAsk(false);
      }
    }
    finishingRef.current = true;
    setFinishing(true);
    try {
      // Everything on its way lands first and anything that failed goes again: the record is never completed
      // without it. Only then is it clear whether anything was recorded.
      const missing = await settleAll();
      if (missing.length > 0) { toast(`${unsavedList(missing)} didn’t save, so the session is still open. Check your connection and try again.`, 'error'); return; }
      const latest = qc.getQueryData<CoachingSession>(['dreamer', id, 'session', sid]) ?? s;
      // An empty session would still count as a session run (and the dreamer as seen), so ask first.
      if (!anyway && !addedHere.current && recordedNothing(latest)) { setConfirmEmpty(true); return; }
      setConfirmEmpty(false);
      updateSession.mutate(
        { sessionId: sid, status: 'completed', ...(notes.isDirty() ? { notes: notes.text } : {}), ...(focus.isDirty() ? { focus: focus.text } : {}) },
        {
          onSuccess: (data) => { applySession(data); toast(`Session ${data.number} completed.`); leave(staffDreamerPath(id, 'sessions')); },
          onError: (e) => toast(errorMessage(e), 'error'),
        },
      );
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  };

  // Leaving with typed work: the same question, then carry on once everything has saved (or stay).
  const leaveWithTyped = async (choice: 'save' | 'discard' | 'stay') => {
    if (blocker.state !== 'blocked') return;
    if (choice === 'stay') { blocker.reset(); return; }
    if (choice === 'discard') discardTyped();
    else {
      setTypedBusy(true);
      const ok = await saveTyped();
      setTypedBusy(false);
      if (!ok) { blocker.reset(); toast('Not everything typed could be saved, so you’re still on this page.', 'error'); return; }
    }
    await finishLeaving(blocker);
  };
  const reopen = () => {
    updateSession.mutate({ sessionId: sid, status: 'in_progress' }, {
      onSuccess: (data) => { applySession(data); setEditValues(false); toast('Session reopened.'); },
      onError: (e) => toast(errorMessage(e), 'error'),
    });
  };
  const remove = () => {
    deleteSession.mutate(sid, {
      onSuccess: () => { setConfirmDelete(false); setConfirmEmpty(false); toast('Session deleted.', 'info'); leave(staffDreamerPath(id)); },
      onError: (e) => { setConfirmDelete(false); setConfirmEmpty(false); toast(errorMessage(e), 'error'); },
    });
  };

  /* ---- derived ---- */
  const dreamList = useMemo(() => [...(grid.data?.dreams ?? dreams.data ?? [])].sort((a, b) => a.slot - b.slot), [grid.data?.dreams, dreams.data]);
  const dreamRefs = useMemo(() => (dreams.data ?? dreamList).map((d) => ({ id: d.id, title: d.title, slot: d.slot })), [dreams.data, dreamList]);
  const allActions = actions.data ?? [];
  // In the order they were chosen, as they were agreed in the conversation.
  const sessionActions = useMemo(
    () => allActions.filter((a) => a.sessionId === sid).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
    [allActions, sid],
  );

  // Sessions arrive oldest → newest. The previous session is the last completed one before this column;
  // the next is whatever session comes after it (when an earlier session has been opened again).
  const { previousSession, nextSession } = useMemo(() => {
    if (!grid.data || !s) return { previousSession: null, nextSession: null };
    const all = grid.data.sessions;
    const idx = all.findIndex((x) => x.id === s.id);
    const before = (idx >= 0 ? all.slice(0, idx) : all.filter((x) => x.id !== s.id)).filter((x) => x.status === 'completed');
    return { previousSession: before[before.length - 1] ?? null, nextSession: idx >= 0 ? all[idx + 1] ?? null : null };
  }, [grid.data, s]);

  // The stretch of time this session looks back on: from the end of the previous session (what was done
  // during that one belongs to it) to the end of this one. That is when it was completed; while it is in
  // progress, now — unless a later session exists (an earlier session opened again), whose start ends it.
  const span = useMemo(() => {
    const from = previousSession ? previousSession.completedAt ?? previousSession.occurredAt : null;
    const to = s?.status === 'completed' ? s.completedAt ?? s.occurredAt : nextSession ? nextSession.occurredAt : null;
    return {
      fromIso: from,
      from: from ? Date.parse(from) : -Infinity,
      to: to ? Date.parse(to) : Infinity,
      start: s ? Date.parse(s.occurredAt) : Infinity,
      // Looking back on a session that is over (or followed by another), rather than one happening now.
      past: to != null,
    };
  }, [previousSession, nextSession, s]);

  // Actions to review: what was open when this session began, plus whatever was completed or set aside in
  // its span — by the dreamer in between, or in this conversation — so there is something to celebrate.
  // Never actions chosen later. An action closed after the span still shows (with what happened to it
  // since) under the group it was in at the time, so ticking one off in a past session never hides it.
  const closedAtOf = (a: ActionItem) => (a.status === 'completed' ? a.completedAt : a.status === 'archived' ? a.archivedAt : null);
  const closedInSpan = useCallback((a: ActionItem) => {
    const closedAt = closedAtOf(a);
    if (closedAt == null) return false;
    const t = Date.parse(closedAt);
    return t > span.from && t <= span.to;
  }, [span]);
  const reviewActions = useMemo(() => allActions.filter((a) => {
    if (a.sessionId === sid || Date.parse(a.createdAt) > span.to) return false;
    const closedAt = closedAtOf(a);
    return closedAt == null || Date.parse(closedAt) > span.start || closedInSpan(a);
  }), [allActions, sid, span, closedInSpan]);
  const reviewGroupOf = useCallback((a: ActionItem) => (closedInSpan(a) ? a.status : 'active'), [closedInSpan]);

  // The dreamer's shared check-ins and reflections in this session's span. A note of theirs on a value recorded
  // in a session counts as a reflection, dated when they wrote it (as on the dashboard's "Last self activity").
  const since = useMemo(() => {
    const inRange = (iso: string) => { const t = Date.parse(iso); return t > span.from && t <= span.to; };
    return {
      checkIns: (checkIns.data ?? []).filter((c) => inRange(c.occurredAt)),
      reflections: (journal.data ?? []).filter((j) => (isSessionValueNote(j) || (j.checkInId == null && j.sessionId == null && j.ratingId == null && j.progressId == null)) && inRange(activityAt(j))),
    };
  }, [span, checkIns.data, journal.data]);
  // What a note on a session value is about: the value, and the session it was recorded in.
  const noteSubject = useCallback((j: JournalEntry): NoteSubject | null => {
    const sess = grid.data?.sessions.find((x) => x.id === j.sessionId);
    if (!sess) return null;
    if (j.ratingId != null && j.category) return { session: sess.number, category: j.category, value: sess.ratings[j.category] ?? null };
    if (j.progressId != null && j.dreamId != null) return { session: sess.number, dreamId: j.dreamId, value: sess.progress[j.dreamId] ?? null };
    return null;
  }, [grid.data]);

  // "Since last session" names the boundary it really uses: when the previous session was completed, which
  // is a later day than it took place when it was recorded after the fact.
  const sinceLabel = !previousSession || span.fromIso == null ? 'before the first session'
    : dayKey(span.fromIso) === dayKey(previousSession.occurredAt) ? `after Session ${previousSession.number} · ${fmtDate(span.fromIso)}`
    : `after Session ${previousSession.number} · completed ${fmtDate(span.fromIso)}`;
  const sinceUntil = s?.status !== 'completed' && nextSession ? ` · until Session ${nextSession.number}` : '';
  // Values of an earlier session are that session's, not "today's".
  const isToday = !!s && dayKey(s.occurredAt) === dayKey(new Date().toISOString());

  // A new conversation starts with the CARE ratings, so the cursor waits in the first empty one —
  // on a laptop only: on a phone or tablet it would pop up the keyboard before anyone asked.
  const autoFocused = useRef(false);
  useEffect(() => {
    if (autoFocused.current || !s || !grid.data || !overview.data) return;
    autoFocused.current = true;
    if (s.status !== 'in_progress' || !window.matchMedia('(pointer: fine)').matches) return;
    const first = CARE_CATEGORIES.find((c) => s.ratings[c] == null);
    if (first) gridRef.current?.querySelector<HTMLInputElement>(`input[data-cs-cell="rating-${first}"]`)?.focus({ preventScroll: true });
  }, [s, grid.data, overview.data]);

  const careDone = !!s && CARE_CATEGORIES.every((c) => s.ratings[c] != null);
  const progressDone = !!s && dreamList.length > 0 && dreamList.every((d) => s.progress[d.id] != null);
  const commitmentDone = s?.ratings.commitment != null;
  const satisfactionDone = s?.ratings.satisfaction != null;
  const focusDone = (focus.text.trim().length > 0) || sessionActions.length > 0;
  const isCompleted = s?.status === 'completed';
  const editable = !!s && (!isCompleted || editValues);

  const scrollTo = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Straight to the first action to review (or "Mark reviewed" when there is none), like the other steps.
  const focusReview = () => {
    scrollTo(reviewRef.current);
    window.setTimeout(() => {
      const root = reviewRef.current;
      (root?.querySelector<HTMLElement>('[data-testid="action-check"] button') ?? root?.querySelector<HTMLElement>('[data-testid="review-toggle"]'))?.focus({ preventScroll: true });
    }, 350);
  };
  const focusCell = (cell: string) => {
    scrollTo(gridRef.current);
    const input = gridRef.current?.querySelector<HTMLInputElement>(`input[data-cs-cell="${cell}"]`);
    window.setTimeout(() => input?.focus({ preventScroll: true }), 350);
  };

  const steps: { n: number; label: string; hint: string; done: boolean; manual?: boolean; go: () => void; testId: string }[] = [
    { n: 1, label: 'CARE ratings', hint: 'The four areas, 0–10', done: careDone, go: () => focusCell('rating-contribution'), testId: 'step-care' },
    { n: 2, label: 'Dream progress', hint: 'Where each dream stands today', done: progressDone, go: () => focusCell(dreamList[0] ? `progress-${dreamList[0].id}` : 'rating-contribution'), testId: 'step-dreams' },
    { n: 3, label: 'Review previous actions', hint: 'Celebrate, complete, or set aside', done: reviewed, manual: true, go: focusReview, testId: 'step-review' },
    { n: 4, label: 'Commitment', hint: 'How committed right now, 0–10', done: !!commitmentDone, go: () => focusCell('rating-commitment'), testId: 'step-commitment' },
    { n: 5, label: 'New focus & actions', hint: 'What matters for the coming period', done: focusDone, go: () => { scrollTo(newRef.current); window.setTimeout(() => document.getElementById('cs-focus')?.focus({ preventScroll: true }), 350); }, testId: 'step-focus' },
    { n: 6, label: 'Satisfaction', hint: 'Satisfaction with progress, 0–10', done: !!satisfactionDone, go: () => focusCell('rating-satisfaction'), testId: 'step-satisfaction' },
  ];
  const doneCount = steps.filter((x) => x.done).length;

  /* ---- states ---- */
  if (!valid) {
    return (
      <div className="page">
        <div className="callout callout-muted"><IconInfo /><span>That session link doesn’t look right. <Link to="/coach">Back to my dreamers</Link></span></div>
      </div>
    );
  }
  if (overview.isLoading || session.isLoading || grid.isLoading) return <LoadingPage label="Opening the session…" />;
  const err = session.error ?? overview.error ?? grid.error;
  if (err || !s || !overview.data || !grid.data) {
    return (
      <div className="page">
        <Link to={staffDreamerPath(id)} className="cs-back"><IconArrowLeft /> Back</Link>
        <div className="callout callout-muted" role="alert" style={{ marginTop: 12 }}>
          <IconInfo />
          <span>{err ? errorMessage(err) : 'Session not found.'} <Link to={staffDreamerPath(id, 'sessions')}>See all sessions</Link></span>
        </div>
      </div>
    );
  }

  const dreamer = overview.data.dreamer;
  const busy = updateSession.isPending || deleteSession.isPending;

  return (
    <div className="page page-wide cs-page" data-testid="session-workspace" data-session-status={s.status}>
      {/* ---------- header ---------- */}
      <header className="cs-head">
        <Link to={staffDreamerPath(id)} className="cs-back" data-testid="session-back"><IconArrowLeft /> {dreamer.name}</Link>
        <div className="cs-head-row">
          <div className="cs-head-who">
            <Avatar initials={dreamer.initials} size="lg" />
            <div className="cs-head-text">
              <h1 className="cs-title">{dreamer.name}</h1>
              {dreamer.about && <div className="cs-about muted small">{dreamer.about}</div>}
              <div className="cs-head-meta">
                <span className="cs-session-label">Session {s.number}</span>
                <span className="cs-sep" aria-hidden>·</span>
                <SessionDateEditor value={s.occurredAt} onChange={onDate} busy={dateBusy} />
                <Chip className={isCompleted ? 'chip-success' : 'chip-warning'} data-testid="session-status">{isCompleted ? 'Completed' : 'In progress'}</Chip>
              </div>
            </div>
          </div>
          <div className="cs-head-actions">
            <a className="btn btn-secondary" href={presentPath(id, sid)} target="_blank" rel="noopener noreferrer" data-testid="session-present" title="Open the presentation view in a new tab for screen sharing">
              <IconPresent /> Present
            </a>
            {isCompleted ? (
              <Button variant="secondary" onClick={reopen} loading={updateSession.isPending} data-testid="session-reopen"><IconRotate /> Reopen</Button>
            ) : (
              <Button variant="primary" onClick={() => void complete()} loading={finishing || updateSession.isPending} data-testid="session-complete"><IconCheck /> Complete session</Button>
            )}
            {!isCompleted && isEmpty && (
              <Button variant="ghost" icon onClick={() => setConfirmDelete(true)} aria-label="Delete this empty session" title="Delete this empty session" data-testid="session-delete"><IconTrash /></Button>
            )}
          </div>
        </div>
      </header>

      <div className="cs-layout">
        {/* ---------- sidebar (first in the DOM so the session flow leads the tab order; CSS puts it on the right) ---------- */}
        <aside className="cs-side">
          <Card className="cs-card cs-steps-card" pad="sm" data-testid="session-steps">
            <div className="cs-steps-head">
              <h3>Session flow</h3>
              <span className="cs-steps-count tnum" data-testid="steps-count">{doneCount} of {steps.length}</span>
            </div>
            <ol className="cs-steps">
              {steps.map((st) => (
                <li key={st.n} className={`cs-step${st.done ? ' is-done' : ''}`}>
                  <button type="button" className="cs-step-btn" onClick={st.go} data-testid={st.testId} data-done={st.done}>
                    <span className="cs-step-mark" aria-hidden>{st.done ? <IconCheck /> : st.n}</span>
                    <span className="cs-step-text">
                      <span className="cs-step-label">{st.label}</span>
                      <span className="cs-step-hint">{st.hint}</span>
                    </span>
                  </button>
                  {st.manual && (
                    <button type="button" className="cs-step-toggle" role="checkbox" aria-checked={st.done} aria-label={st.done ? 'Mark previous actions as not yet reviewed' : 'Mark previous actions as reviewed'} onClick={() => setReviewed(!reviewed)} data-testid="step-review-toggle">
                      {st.done ? 'Undo' : 'Done'}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          <Card className="cs-card" pad="sm" data-testid="since-last-session">
            <div className="cs-side-head">
              <h3>Since last session</h3>
              <span className="muted tiny" data-testid="since-window">{sinceLabel}{sinceUntil}</span>
            </div>
            <SinceList checkIns={since.checkIns} reflections={since.reflections} dreams={dreamList} noteSubject={noteSubject} loading={checkIns.isLoading || journal.isLoading} />
          </Card>

          <Card className="cs-card" pad="sm" data-testid="dreams-glance">
            <div className="cs-side-head">
              <h3>Dreams at a glance</h3>
              <span className="muted tiny">{previousSession ? `S${previousSession.number} → ${isToday ? 'today' : `S${s.number}`}` : isToday ? 'today' : `Session ${s.number}`}</span>
            </div>
            <ul className="cs-glance">
              {dreamList.map((d) => {
                const now = s.progress[d.id] ?? null;
                const prev = previousSession?.progress[d.id] ?? null;
                return (
                  <li key={d.id} className="cs-glance-item">
                    <div className="cs-glance-top">
                      <span className="cs-glance-title" title={d.title}>{d.title}</span>
                      <span className="cs-glance-vals tnum">
                        {prev != null && <span className="muted">{prev}% →</span>} <b>{now == null ? '–' : `${now}%`}</b>
                      </span>
                    </div>
                    <Bar value={now} color="var(--gold)" label={`${d.title} progress ${isToday ? 'today' : `in Session ${s.number}`}`} />
                  </li>
                );
              })}
            </ul>
          </Card>
        </aside>

        {/* ---------- main column ---------- */}
        <div className="cs-main">
          <div ref={gridRef} className="cs-anchor" data-testid="section-grid">
          <Card className="cs-card cs-grid-card">
            <CardHead
              title="Session grid"
              sub={isCompleted && !editValues ? 'This session is complete. Values are shown read-only.' : `Months side by side — ${isToday ? 'today’s' : `Session ${s.number}’s`} column is open for entry.`}
              actions={
                <>
                  <SaveIndicator status={gridStatus} testId="grid-save-status" />
                  {isCompleted && (
                    <Button variant={editValues ? 'secondary' : 'ghost'} size="sm" onClick={() => setEditValues((v) => !v)} data-testid="grid-edit-toggle">
                      <IconEdit /> {editValues ? 'Done editing' : 'Edit values'}
                    </Button>
                  )}
                </>
              }
            />
            <SessionGridView grid={grid.data} currentSessionId={sid} editable={editable} showDeltas onRating={onRating} onProgress={onProgress} />
            <p className="cs-hint muted small" data-testid="grid-hint">
              {editable ? (
                <>
                  <span className="cs-hint-keys">Type a number, then <span className="kbd">Enter</span> or <span className="kbd">↓</span> moves down. </span>
                  <span className="cs-hint-touch">Tap a cell to enter a number. </span>
                  Changes save instantly.
                </>
              ) : 'Reopen the session or choose “Edit values” to change a number.'}
            </p>
          </Card>
          </div>

          <div ref={reviewRef} className="cs-anchor" data-testid="section-review">
          <Card className="cs-card">
            <CardHead
              title="Review previous actions"
              sub={!previousSession ? 'Actions already on the list — complete, set aside, or edit inline.'
                : span.past ? `Open at the time, plus anything completed or set aside between Session ${previousSession.number} and ${isCompleted || !nextSession ? 'this one' : `Session ${nextSession.number}`}.`
                : `Still open, plus anything completed or set aside since Session ${previousSession.number}.`}
              actions={
                <Button variant={reviewed ? 'secondary' : 'ghost'} size="sm" onClick={() => setReviewed(!reviewed)} aria-pressed={reviewed} data-testid="review-toggle">
                  <IconCheck /> {reviewed ? 'Reviewed' : 'Mark reviewed'}
                </Button>
              }
            />
            {previousSession && <PreviousSessionRecap session={previousSession} />}
            {actions.isLoading ? (
              <LoadingPage label="Loading actions…" />
            ) : actions.error ? (
              <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(actions.error)}</span></div>
            ) : (
              <ActionList
                dreamerRef={id}
                actions={reviewActions}
                dreams={dreamRefs}
                mode="staff"
                filter="all"
                compact
                groupOf={reviewGroupOf}
                groupLabels={span.past ? { active: 'Open at the time' } : undefined}
                onEditChange={onEditChange}
                emptyTitle="No open actions to review"
                emptyBody={`Everything chosen before ${isToday ? 'today' : 'this session'} has been completed or set aside. A good moment to celebrate before choosing what comes next.`}
              />
            )}
          </Card>
          </div>

          <div ref={newRef} className="cs-anchor" data-testid="section-new">
          <Card className="cs-card">
            <CardHead title="New actions for the coming period" sub="Small, concrete steps chosen together. They appear on the dreamer’s list right away." />
            <div className="cs-composer">
              <ActionComposer ref={composerRef} dreamerRef={id} dreams={dreamRefs} mode="staff" sessionId={sid} autoFocus={false} onDraftChange={setActionDraft} onDone={onActionAdded} />
            </div>
            {sessionActions.length > 0 && (
              <div className="cs-session-actions" data-testid="session-actions">
                <ActionList dreamerRef={id} actions={sessionActions} dreams={dreamRefs} mode="staff" filter="all" compact onEditChange={onEditChange} />
              </div>
            )}
          </Card>
          </div>

          <Card className="cs-card" data-testid="section-notes">
            <CardHead title="Focus & notes" sub="Visible to the dreamer as part of their session record." actions={<SaveIndicator status={notesStatus} testId="notes-save-status" />} />
            <div className="stack">
              <Field label="Focus for the coming period" htmlFor="cs-focus" hint="One line the dreamer can hold on to until next time.">
                <TextInput id="cs-focus" value={focus.text} onChange={(e) => focus.onChange(e.target.value)} onBlur={() => void focus.flush()} placeholder="e.g. Relationships — reconnect with people who matter" maxLength={2000} data-testid="session-focus" />
              </Field>
              <Field label="Session notes" htmlFor="cs-notes">
                <TextArea id="cs-notes" className="cs-notes" value={notes.text} onChange={(e) => notes.onChange(e.target.value)} onBlur={() => void notes.flush()} rows={6} placeholder="What came up, what moved, what you noticed…" maxLength={20000} data-testid="session-notes" />
              </Field>
            </div>
            {/* The conversation ends here, far below the header's button. */}
            {!isCompleted && (
              <div className="cs-notes-foot">
                <Button variant="primary" onClick={() => void complete()} loading={finishing || updateSession.isPending} data-testid="session-complete-end"><IconCheck /> Complete session</Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this session?"
        body="Nothing has been recorded yet, so this only removes the empty session. You can start a new one any time."
        confirmLabel="Delete session"
        danger
        loading={deleteSession.isPending}
      />

      <Modal
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        title="Complete an empty session?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmEmpty(false)} data-testid="complete-empty-cancel">Keep working</Button>
            <Button variant="danger" onClick={remove} loading={deleteSession.isPending} disabled={busy} data-testid="complete-empty-delete"><IconTrash /> Delete instead</Button>
            <Button variant="primary" onClick={() => void complete({ anyway: true })} loading={finishing || updateSession.isPending} disabled={busy} data-testid="complete-empty-confirm">Complete anyway</Button>
          </>
        }
      >
        <p style={{ color: 'var(--ink-2)' }}>Nothing has been recorded in this session yet. Complete it anyway? It will count as a session held. If it didn’t happen, delete it instead.</p>
      </Modal>

      <Modal
        open={(typedAsk || blocker.state === 'blocked') && (!!draftTitle || editTitles.length > 0)}
        onClose={() => (blocker.state === 'blocked' ? void leaveWithTyped('stay') : setTypedAsk(false))}
        title={typedQuestion(draftTitle, editTitles, blocker.state === 'blocked' ? 'leaving' : 'completing')}
        footer={blocker.state === 'blocked' ? (
          <>
            <Button variant="secondary" onClick={() => void leaveWithTyped('stay')} disabled={typedBusy} data-testid="draft-action-cancel">Stay</Button>
            <Button variant="ghost" onClick={() => void leaveWithTyped('discard')} disabled={typedBusy} data-testid="draft-action-discard">Discard</Button>
            <Button variant="primary" onClick={() => void leaveWithTyped('save')} loading={typedBusy} data-testid="draft-action-add">{draftTitle ? 'Add' : 'Save'} and leave</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setTypedAsk(false)} disabled={typedBusy || busy} data-testid="draft-action-cancel">Cancel</Button>
            <Button variant="ghost" onClick={() => void complete({ typed: 'discard' })} disabled={typedBusy || busy} data-testid="draft-action-discard">Discard</Button>
            <Button variant="primary" onClick={() => void complete({ typed: 'save' })} loading={typedBusy || finishing || updateSession.isPending} data-testid="draft-action-add">{draftTitle ? 'Add' : 'Save'} and complete</Button>
          </>
        )}
      >
        <div className="stack" style={{ color: 'var(--ink-2)' }}>
          {draftTitle && <p>This action is typed in “New actions” but hasn’t been added yet, so the dreamer won’t see it.</p>}
          {editTitles.length > 0 && <p>{editTitles.length === 1 ? 'The action is still open for editing, and the change isn’t saved yet.' : `${editTitles.length} actions are still open for editing, and the changes aren’t saved yet.`}</p>}
        </div>
      </Modal>

      <Modal
        open={blocker.state === 'blocked' && leaveUnsaved != null}
        onClose={() => blocker.reset?.()}
        title="Leave without saving everything?"
        footer={
          <>
            <Button variant="secondary" onClick={() => blocker.reset?.()} data-testid="leave-unsaved-stay">Stay</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()} data-testid="leave-unsaved-leave">Leave anyway</Button>
          </>
        }
      >
        <p style={{ color: 'var(--ink-2)' }}>{unsavedList(leaveUnsaved ?? [])} didn’t save. Stay to try again once the connection is back, or leave without it.</p>
      </Modal>
    </div>
  );
}

/* ---------- Last session's focus and notes, for the review step ---------- */

function PreviousSessionRecap({ session: p }: { session: CoachingSession }) {
  const [showNotes, setShowNotes] = useState(false);
  const notes = p.notes.trim();
  if (!p.focus.trim() && !notes) return null;
  return (
    <div className="cs-recap" data-testid="previous-session-recap">
      <div className="cs-recap-head muted tiny">Session {p.number} · {fmtDate(p.occurredAt)}</div>
      {p.focus.trim() && (
        <div className="cs-recap-focus" data-testid="previous-session-focus">
          <span className="cs-recap-label">Focus</span>
          <span>{p.focus}</span>
        </div>
      )}
      {notes && (
        <>
          {showNotes && <div className="cs-recap-notes" data-testid="previous-session-notes">{notes}</div>}
          <button type="button" className="cs-text-btn" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes} data-testid="previous-session-notes-toggle">
            {showNotes ? 'Hide notes' : `Show Session ${p.number} notes`}
          </button>
        </>
      )}
    </div>
  );
}

/* ---------- "Since last session" list ---------- */

type NoteSubject = { session: number; value: number | null } & ({ category: RatingCategory } | { dreamId: number });
type SinceItem = { kind: 'checkin'; at: string; item: CheckIn } | { kind: 'reflection'; at: string; item: JournalEntry };

function SinceList({ checkIns, reflections, dreams, noteSubject, loading }: {
  checkIns: CheckIn[];
  reflections: JournalEntry[];
  dreams: { id: number; title: string }[];
  noteSubject: (j: JournalEntry) => NoteSubject | null;
  loading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const items = useMemo<SinceItem[]>(() => {
    const all: SinceItem[] = [
      ...checkIns.map((c): SinceItem => ({ kind: 'checkin', at: c.occurredAt, item: c })),
      ...reflections.map((j): SinceItem => ({ kind: 'reflection', at: activityAt(j), item: j })),
    ];
    return all.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [checkIns, reflections]);

  if (loading) return <div className="muted small" style={{ padding: '6px 0' }}>Loading…</div>;
  if (items.length === 0) {
    return (
      <EmptyState icon={<IconClock />} title="Nothing new between sessions">
        Self check-ins and reflections the dreamer adds between sessions show up here, ready to bring into the conversation.
      </EmptyState>
    );
  }
  const shown = showAll ? items : items.slice(0, 6);
  const dreamTitle = (dreamId: number) => dreams.find((d) => d.id === dreamId)?.title ?? 'Dream';

  return (
    <div className="cs-since">
      <ul className="cs-since-list">
        {shown.map((it) => (
          <li key={`${it.kind}-${it.item.id}`} className="cs-since-item" data-testid="since-item" data-kind={it.kind}>
            <div className="cs-since-head">
              <SourceChip source="self" reflection={it.kind !== 'checkin'} />
              <time className="muted tiny tnum" dateTime={it.at} title={fmtDateTime(it.at)}>{relativeTime(it.at)}</time>
            </div>
            {it.kind === 'checkin' ? <CheckInBody c={it.item} dreamTitle={dreamTitle} /> : (
              <>
                {isSessionValueNote(it.item) && <NoteSubjectLine subject={noteSubject(it.item)} dreamTitle={dreamTitle} />}
                <div className="cs-since-body">{it.item.body}</div>
              </>
            )}
          </li>
        ))}
      </ul>
      {items.length > 6 && (
        <button type="button" className="cs-text-btn" onClick={() => setShowAll((v) => !v)} data-testid="since-more">
          {showAll ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/** "Note on Session 10 · [E] 9": what a dreamer's note on a session value is about. */
function NoteSubjectLine({ subject, dreamTitle }: { subject: NoteSubject | null; dreamTitle: (id: number) => string }) {
  if (!subject) return <div className="cs-since-about muted tiny" data-testid="since-note-subject">Note on a session value</div>;
  return (
    <div className="cs-since-vals cs-since-about" data-testid="since-note-subject">
      <span className="muted tiny">Note on Session {subject.session}</span>
      {'category' in subject ? (
        <span className="cs-since-val"><CategoryChip category={subject.category} short />{subject.value != null && <b className="tnum">{subject.value}</b>}</span>
      ) : (
        <span className="cs-since-val cs-since-prog" title={dreamTitle(subject.dreamId)}>
          <span className="cs-since-prog-title">{dreamTitle(subject.dreamId)}</span>
          {subject.value != null && <b className="tnum">{subject.value}%</b>}
        </span>
      )}
    </div>
  );
}

function CheckInBody({ c, dreamTitle }: { c: CheckIn; dreamTitle: (id: number) => string }) {
  const notes: ReactNode[] = [];
  for (const r of c.ratings) if (r.note?.body) notes.push(<div key={`rn-${r.id}`} className="cs-since-note"><span className="cs-since-note-tag" style={{ color: textShade(CATEGORY_META[r.category].color) }}>{CATEGORY_META[r.category].label}</span>{r.note.body}</div>);
  for (const p of c.progress) if (p.note?.body) notes.push(<div key={`pn-${p.id}`} className="cs-since-note"><span className="cs-since-note-tag">{dreamTitle(p.dreamId)}</span>{p.note.body}</div>);
  return (
    <>
      {(c.ratings.length > 0 || c.progress.length > 0) && (
        <div className="cs-since-vals">
          {c.ratings.map((r) => (
            <span key={r.id} className="cs-since-val" data-testid="since-rating">
              <CategoryChip category={r.category} short />
              <b className="tnum">{r.value}</b>
            </span>
          ))}
          {c.progress.map((p) => (
            <span key={p.id} className="cs-since-val cs-since-prog" title={dreamTitle(p.dreamId)}>
              <span className="cs-since-prog-title">{dreamTitle(p.dreamId)}</span>
              <b className="tnum">{p.value}%</b>
            </span>
          ))}
        </div>
      )}
      {notes}
      {c.reflection && <div className="cs-since-body">{c.reflection.body}</div>}
    </>
  );
}
