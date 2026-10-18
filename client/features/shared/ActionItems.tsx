/**
 * Shared action-item components used by the dreamer Actions page, the staff
 * dreamer page and the live session workspace.
 *
 * Privacy: the server only ever returns rows the viewer may see, so nothing here
 * filters by `isPrivate`. `isPrivate` can only be true on the dreamer's own rows
 * while their session is unlocked; staff mode shows no privacy UI or wording at all.
 */
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { CARE_CATEGORIES, CATEGORY_META, isCareCategory, type CareCategory } from '@shared/care';
import type { ActionItem, ActionStatus, Dream } from '@shared/types';
import { useCreateAction, useDeleteAction, useDreams, useUpdateAction, type DreamerRef } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/toast';
import { Button, CategoryChip, Check, Chip, ConfirmDialog, Dropdown, EmptyState, Field, PrivacyToggle, PrivateChip, TextArea } from '@/components/ui';
import { IconArchive, IconEdit, IconInfo, IconList, IconLock, IconMore, IconPlus, IconRotate, IconStar, IconTrash, IconUnlock } from '@/components/icons';
import { firstName, fmtDate } from '@/lib/format';

export type ActionMode = 'dreamer' | 'staff';
type DreamRef = Pick<Dream, 'id' | 'title' | 'slot'>;

export interface ActionListProps {
  /** 'me' for the dreamer's own pages, numeric id for staff pages. */
  dreamerRef: DreamerRef;
  /** Already-fetched actions (any statuses); the list filters by `filter`. */
  actions: ActionItem[];
  /** The dreamer's dreams, for linking/labels. */
  dreams: DreamRef[];
  /** dreamer: privacy toggle + delete available. staff: coach controls only (no privacy UI). */
  mode: ActionMode;
  /** Inside a live session: new actions are tagged with this session. */
  sessionId?: number | null;
  /** Which statuses to show (default 'active'). */
  filter?: 'active' | 'completed' | 'archived' | 'all';
  /** Render the inline "Add action" composer at the top. */
  showAdd?: boolean;
  /** Denser layout for sidebars/workspaces. */
  compact?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  /** With filter 'all': which group an action is listed under (default: its status). */
  groupOf?: (action: ActionItem) => ActionStatus;
  /** With filter 'all': group headings other than the status names. */
  groupLabels?: Partial<Record<ActionStatus, string>>;
}

export interface ActionComposerProps {
  dreamerRef: DreamerRef;
  dreams: DreamRef[];
  mode: ActionMode;
  sessionId?: number | null;
  /** Preselect a dream or category (e.g. from a dream detail page). */
  defaultDreamId?: number | null;
  defaultCategory?: ActionItem['category'];
  /** Called once the action is saved (the reply is null for a private action while private entries are hidden). */
  onDone?: (action: ActionItem | null) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Told whenever the typed title changes, so a page can tell when an action is typed but not yet added. */
  onDraftChange?: (title: string) => void;
  /** Lets a page add or discard what's typed (e.g. before it completes a session). */
  ref?: Ref<ActionComposerHandle>;
}

export interface ActionComposerHandle {
  /** Adds what's typed; resolves false if the save failed (the text and the error stay in the form). */
  submit: () => Promise<boolean>;
  /** Clears the form. */
  discard: () => void;
}

/* ---------- Shared helpers ---------- */

const STATUS_LABEL: Record<ActionStatus, string> = { active: 'Active', completed: 'Completed', archived: 'Set aside' };
const PRIVATE_HIDDEN_MSG = 'Saved as private — private entries are currently hidden.';

interface DreamLabel { title: string; slotLabel: string }

/**
 * Callers pass `{ id, title, slot }`; the program's slot label ("6–12 month dream")
 * makes selects much easier to scan, so enrich from the (already cached) dreams query.
 */
function useDreamLabels(dreamerRef: DreamerRef, dreams: DreamRef[]) {
  const full = useDreams(dreamerRef);
  return useMemo(() => {
    const map = new Map<number, DreamLabel>();
    for (const d of dreams) {
      const fetched = full.data?.find((x) => x.id === d.id);
      const given = (d as Partial<Dream>).slotLabel;
      map.set(d.id, { title: d.title, slotLabel: fetched?.slotLabel ?? given ?? `Dream ${d.slot}` });
    }
    return map;
  }, [dreams, full.data]);
}

const sortDreams = (dreams: DreamRef[]) => [...dreams].sort((a, b) => a.slot - b.slot);

/** The pair of optional link controls (dream + CARE area). Shared by the composer and the edit form. */
function LinkSelects({ dreams, labels, dreamId, category, onDreamId, onCategory, disabled, compact, idPrefix }: {
  dreams: DreamRef[];
  labels: Map<number, DreamLabel>;
  dreamId: number | null;
  category: CareCategory | null;
  onDreamId: (v: number | null) => void;
  onCategory: (v: CareCategory | null) => void;
  disabled?: boolean;
  /** Pill-shaped inline selects (composer) instead of labelled fields (edit form). */
  compact?: boolean;
  idPrefix: string;
}) {
  const dreamSelect = (
    <select
      id={`${idPrefix}-dream`}
      className={compact ? `da-select da-select-dream${dreamId != null ? ' is-set' : ''}` : undefined}
      value={dreamId ?? ''}
      onChange={(e) => onDreamId(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled}
      aria-label={compact ? 'Link to a dream' : undefined}
      data-testid="action-dream-select"
    >
      <option value="">{compact ? 'Link to a dream' : 'Not linked to a dream'}</option>
      {dreams.map((d) => (
        <option key={d.id} value={d.id}>{labels.get(d.id)?.slotLabel ?? `Dream ${d.slot}`} · {d.title}</option>
      ))}
    </select>
  );
  const categorySelect = (
    <select
      id={`${idPrefix}-category`}
      className={compact ? `da-select${category ? ' is-set' : ''}` : undefined}
      value={category ?? ''}
      onChange={(e) => onCategory(isCareCategory(e.target.value) ? e.target.value : null)}
      disabled={disabled}
      aria-label={compact ? 'CARE area' : undefined}
      style={compact && category ? ({ '--da-color': CATEGORY_META[category].color, '--da-tint': CATEGORY_META[category].tint } as React.CSSProperties) : undefined}
      data-testid="action-category-select"
    >
      <option value="">{compact ? 'CARE area' : 'No CARE area'}</option>
      {CARE_CATEGORIES.map((c) => (
        <option key={c} value={c}>{CATEGORY_META[c].label}</option>
      ))}
    </select>
  );
  if (compact) return <>{dreamSelect}{categorySelect}</>;
  return (
    <div className="da-link-fields">
      <Field label="Dream" htmlFor={`${idPrefix}-dream`}>{dreamSelect}</Field>
      <Field label="CARE area" htmlFor={`${idPrefix}-category`}>{categorySelect}</Field>
    </div>
  );
}

/* ---------- Composer ---------- */

/** The "Add an action" form (title, optional details, dream/category link, privacy in dreamer mode). */
export function ActionComposer({ dreamerRef, dreams, mode, sessionId, defaultDreamId, defaultCategory, onDone, onCancel, autoFocus, onDraftChange, ref }: ActionComposerProps) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const create = useCreateAction(dreamerRef);
  const sorted = useMemo(() => sortDreams(dreams), [dreams]);
  const labels = useDreamLabels(dreamerRef, dreams);
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [dreamId, setDreamId] = useState<number | null>(defaultDreamId ?? null);
  const [category, setCategory] = useState<CareCategory | null>(defaultCategory ?? null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saves still on their way: several can be, since the next action can be typed straight away.
  const [saving, setSaving] = useState(0);
  // In a session the new row appears right under the composer, so a toast (over the next field the coach
  // types into) would only get in the way; screen readers hear it from here instead.
  const quiet = mode === 'staff' && sessionId != null;
  const [announce, setAnnounce] = useState('');

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0;

  const onDraftRef = useRef(onDraftChange);
  onDraftRef.current = onDraftChange;
  useEffect(() => { onDraftRef.current?.(title); }, [title]);

  const fill = (d: { title: string; details: string; showDetails: boolean; dreamId: number | null; category: CareCategory | null; isPrivate: boolean }) => {
    setTitle(d.title);
    setDetails(d.details);
    setShowDetails(d.showDetails);
    setDreamId(d.dreamId);
    setCategory(d.category);
    setIsPrivate(d.isPrivate);
  };

  const clear = () => fill({ title: '', details: '', showDetails: false, dreamId: defaultDreamId ?? null, category: defaultCategory ?? null, isPrivate: false });

  /** Saves what's typed; resolves whether it went through. */
  const save = (): Promise<boolean> => {
    if (!canSubmit) return Promise.resolve(true);
    // The form clears at once, so whatever is typed next starts the next action instead of being lost
    // while this one saves. If the save fails, the text comes back unless something new is there by then.
    const draft = { title, details, showDetails, dreamId, category, isPrivate };
    setError(null);
    clear();
    setSaving((n) => n + 1);
    return create
      .mutateAsync({
        title: trimmed,
        details: details.trim() || undefined,
        dreamId,
        category,
        sessionId: sessionId ?? undefined,
        ...(mode === 'dreamer' ? { isPrivate } : {}),
      })
      .then(
        (action) => {
          if (mode === 'dreamer' && isPrivate) toast(auth?.privateUnlocked ? 'Added as a private action — only you can see it.' : PRIVATE_HIDDEN_MSG, 'private');
          else if (quiet) setAnnounce(`Added “${trimmed}”.`);
          else toast('Action added.');
          onDone?.(action);
          return true;
        },
        (err) => {
          setError(errorMessage(err));
          if (!titleRef.current?.value) fill(draft);
          return false;
        },
      )
      .finally(() => setSaving((n) => n - 1));
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    void save();
    // Ready for the next one (after a click on Add, too).
    titleRef.current?.focus();
  };

  useImperativeHandle(ref, () => ({ submit: save, discard: () => { setError(null); clear(); } }));

  const onDetailsKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    if (e.key === 'Escape' && onCancel) onCancel();
  };

  return (
    <form className={`da-composer da-composer-${mode}`} onSubmit={submit} data-testid="action-composer" aria-busy={saving > 0 || undefined}>
      <div className="da-composer-main">
        <input
          ref={titleRef}
          id={`${id}-title`}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && onCancel) onCancel(); }}
          placeholder={mode === 'dreamer' ? 'What’s one small step you could take?' : 'A next step chosen together…'}
          aria-label="Action title"
          maxLength={300}
          autoFocus={autoFocus}
          autoComplete="off"
          data-testid="action-title-input"
        />
        {/* Only an empty form shows the spinner: with the next title typed, Add (and Enter) must still work. */}
        <Button type="submit" variant="primary" disabled={!canSubmit} loading={saving > 0 && !canSubmit} data-testid="add-action">
          <IconPlus /> Add
        </Button>
      </div>
      {showDetails && (
        <TextArea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          onKeyDown={onDetailsKey}
          placeholder="Details — why this matters, where to start, anything to remember"
          aria-label="Action details"
          rows={2}
          maxLength={4000}
          autoFocus
          data-testid="action-details-input"
        />
      )}
      <div className="da-composer-options">
        {!showDetails && (
          <button type="button" className="da-text-btn" onClick={() => setShowDetails(true)} data-testid="action-details-toggle">
            <IconPlus /> Add details
          </button>
        )}
        <LinkSelects dreams={sorted} labels={labels} dreamId={dreamId} category={category} onDreamId={setDreamId} onCategory={setCategory} compact idPrefix={`${id}-link`} />
        {mode === 'dreamer' && (
          <span data-testid="action-privacy-toggle"><PrivacyToggle value={isPrivate} onChange={setIsPrivate} size="sm" /></span>
        )}
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" className="da-composer-cancel" onClick={onCancel} disabled={saving > 0} data-testid="action-cancel">
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{error}</span></div>
      )}
      {quiet && <span className="sr-only" role="status">{announce}</span>}
    </form>
  );
}

/* ---------- List ---------- */

/** Full-featured list: complete/reopen, edit (title, details, dream, category), set aside/restore, privacy (dreamer mode), delete (dreamer mode). */
export function ActionList({ dreamerRef, actions, dreams, mode, sessionId, filter = 'active', showAdd, compact, emptyTitle, emptyBody, groupOf, groupLabels }: ActionListProps) {
  const sorted = useMemo(() => sortDreams(dreams), [dreams]);
  const labels = useDreamLabels(dreamerRef, dreams);

  const visible = filter === 'all' ? actions : actions.filter((a) => a.status === filter);
  const groupFor = groupOf ?? ((a: ActionItem) => a.status);
  const groups: { status: ActionStatus; items: ActionItem[] }[] =
    filter === 'all'
      ? (['active', 'completed', 'archived'] as ActionStatus[]).map((status) => ({ status, items: visible.filter((a) => groupFor(a) === status) })).filter((g) => g.items.length > 0)
      : [{ status: filter, items: visible }];

  // Completing, setting aside or restoring can move a row to another group (or off this list), which
  // remounts it and drops the keyboard focus. Once the list has caught up, put the focus back on the same
  // control of that row, or of the row that took its place.
  const listRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ id: number; control: RowControl; index: number; at: number } | null>(null);
  const onStatusChanged = useCallback((id: number, control: RowControl) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-testid="action-item"]') ?? [])];
    refocus.current = { id, control, index: rows.findIndex((r) => r.dataset.actionId === String(id)), at: Date.now() };
  }, []);
  useEffect(() => {
    const want = refocus.current;
    const root = listRef.current;
    if (!want || !root) return;
    if (Date.now() - want.at > 5000) { refocus.current = null; return; }
    const active = document.activeElement;
    const row = root.querySelector<HTMLElement>(`[data-action-id="${want.id}"]`);
    // Still on the row (it hasn't moved yet), or the person has moved on: nothing to do.
    if (active && active !== document.body) { if (!row?.contains(active)) refocus.current = null; return; }
    refocus.current = null;
    const rows = [...root.querySelectorAll<HTMLElement>('[data-testid="action-item"]')];
    const target = row ?? rows[Math.min(Math.max(want.index, 0), rows.length - 1)];
    target?.querySelector<HTMLElement>(want.control === 'check' ? '[data-testid="action-check"] button' : '[data-testid="action-menu"]')?.focus();
  }, [actions]);

  return (
    <div className={`da-list${compact ? ' da-compact' : ''}`} data-testid="action-list" data-mode={mode} ref={listRef}>
      {showAdd && (
        <div className="da-list-add">
          <ActionComposer dreamerRef={dreamerRef} dreams={sorted} mode={mode} sessionId={sessionId} />
        </div>
      )}
      {visible.length === 0 ? (
        <EmptyState icon={<IconList />} title={emptyTitle ?? 'Nothing here right now'}>
          {emptyBody ?? 'Actions you choose will show up here. They’re yours to keep, change, or set aside.'}
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.status} className="da-group" data-testid={`action-group-${g.status}`}>
            {filter === 'all' && (
              <h4 className="da-group-head">{groupLabels?.[g.status] ?? STATUS_LABEL[g.status]} <span className="da-count tnum">{g.items.length}</span></h4>
            )}
            <ul className="da-rows">
              {g.items.map((a) => (
                <ActionRow key={a.id} action={a} dreamerRef={dreamerRef} mode={mode} dreams={sorted} labels={labels} compact={!!compact} onStatusChanged={onStatusChanged} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/* ---------- Row ---------- */

type RowControl = 'check' | 'menu';

function ActionRow({ action, dreamerRef, mode, dreams, labels, compact, onStatusChanged }: {
  action: ActionItem;
  dreamerRef: DreamerRef;
  mode: ActionMode;
  dreams: DreamRef[];
  labels: Map<number, DreamLabel>;
  compact: boolean;
  /** A status change went through (from the check or the menu), so the row may move. */
  onStatusChanged: (id: number, control: RowControl) => void;
}) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const update = useUpdateAction(dreamerRef);
  const remove = useDeleteAction(dreamerRef);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Reflect the server's latest answer (or the in-flight change) immediately, before the list refetches.
  const shown = useMemo(() => {
    let a = action;
    if (update.data && update.data.id === action.id && update.data.updatedAt >= action.updatedAt) a = update.data;
    if (update.isPending && update.variables && update.variables.actionId === action.id) {
      const v = update.variables;
      a = { ...a, ...(v.status ? { status: v.status } : {}), ...(v.isPrivate !== undefined ? { isPrivate: v.isPrivate } : {}) };
    }
    return a;
  }, [action, update.data, update.isPending, update.variables]);

  const busy = update.isPending || remove.isPending;
  const isDreamer = mode === 'dreamer';
  const dream = shown.dreamId != null ? dreams.find((d) => d.id === shown.dreamId) : undefined;
  const dreamTitle = dream?.title ?? (shown.dreamId != null ? labels.get(shown.dreamId)?.title : undefined);
  const hasDetails = shown.details.trim().length > 0;
  const showDetails = hasDetails && (!compact || expanded);
  const addedBySomeoneElse = shown.sessionId == null && auth != null && shown.createdBy.id !== auth.user.id;

  const patch = (body: Omit<Parameters<typeof update.mutate>[0], 'actionId'>, message: string, kind: 'success' | 'info' | 'private' = 'success', after?: () => void) =>
    update.mutate({ actionId: action.id, ...body }, {
      onSuccess: () => { toast(message, kind); after?.(); },
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const setStatus = (status: ActionStatus, message: string, kind: 'success' | 'info', control: RowControl) =>
    patch({ status }, message, kind, () => onStatusChanged(action.id, control));
  const onCheck = (checked: boolean, control: RowControl = 'check') => {
    if (checked) setStatus('completed', 'Done — nicely.', 'success', control);
    else setStatus('active', isDreamer ? 'Reopened — back on your list.' : 'Reopened.', 'success', control);
  };
  const setAside = () => setStatus('archived', isDreamer ? 'Set aside — you can bring it back any time.' : 'Set aside.', 'info', 'menu');
  const restore = () => setStatus('active', isDreamer ? 'Back on your list.' : 'Restored.', 'success', 'menu');
  const makePrivate = () => patch({ isPrivate: true }, auth?.privateUnlocked ? 'Now private — only you can see this.' : PRIVATE_HIDDEN_MSG, 'private');
  const share = () => patch({ isPrivate: false }, 'Shared with your coach.');
  const confirmRemove = () =>
    remove.mutate(action.id, {
      onSuccess: () => { setConfirmDelete(false); toast('Action deleted.', 'info'); },
      onError: (e) => { setConfirmDelete(false); toast(errorMessage(e), 'error'); },
    });

  const dateLine: ReactNode =
    shown.status === 'completed' && shown.completedAt ? `Completed ${fmtDate(shown.completedAt)}`
    : shown.status === 'archived' && shown.archivedAt ? `Set aside ${fmtDate(shown.archivedAt)}`
    : !compact ? `Added ${fmtDate(shown.createdAt)}`
    : null;

  return (
    <li
      className={`da-row is-${shown.status}${busy ? ' is-busy' : ''}${editing ? ' is-editing' : ''}`}
      data-testid="action-item"
      data-action-id={action.id}
      data-status={shown.status}
      aria-busy={busy || undefined}
    >
      <div className={`da-check${busy ? ' is-busy' : ''}`} data-testid="action-check">
        <Check checked={shown.status === 'completed'} onChange={(v) => onCheck(v)} label={shown.status === 'completed' ? `Reopen “${shown.title}”` : `Mark “${shown.title}” complete`} />
      </div>

      <div className="da-body">
        {editing ? (
          <ActionEditForm
            action={shown}
            dreams={dreams}
            labels={labels}
            pending={update.isPending}
            onCancel={() => setEditing(false)}
            onSave={(body) => patch(body, 'Saved.', 'success', () => setEditing(false))}
          />
        ) : (
          <>
            <div className="da-title" data-testid="action-title">{shown.title}</div>
            {showDetails && <div className="da-details" data-testid="action-details">{shown.details}</div>}
            <div className="da-meta">
              {dreamTitle != null && shown.dreamId != null && (
                isDreamer ? (
                  <Link to={`/dreams/${shown.dreamId}`} className="chip da-chip-link" title={dreamTitle} data-testid="action-dream-link">
                    <IconStar /><span className="da-chip-text">{dreamTitle}</span>
                  </Link>
                ) : (
                  <Chip className="da-chip-dream" title={dreamTitle}><IconStar /><span className="da-chip-text">{dreamTitle}</span></Chip>
                )
              )}
              {shown.category && <CategoryChip category={shown.category} />}
              {shown.sessionId != null && (
                <Chip className="chip-session" title="This action was chosen together in a coaching session">
                  {compact ? 'Coaching session' : <><span className="hide-mobile">Chosen in a coaching session</span><span className="only-mobile">Coaching session</span></>}
                </Chip>
              )}
              {addedBySomeoneElse && <Chip className="chip-muted">Added by {firstName(shown.createdBy.name)}</Chip>}
              {isDreamer && shown.isPrivate && <PrivateChip />}
              {compact && hasDetails && (
                <button type="button" className="da-expand" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} data-testid="action-details-expand">
                  {expanded ? 'Hide details' : 'Details'}
                </button>
              )}
              {dateLine && <span className="da-date" data-testid="action-date">{dateLine}</span>}
            </div>
          </>
        )}
      </div>

      {!editing && (
        <div className="da-menu">
          <Dropdown
            trigger={(open) => (
              <Button variant="ghost" icon size="sm" aria-label={`Options for “${shown.title}”`} aria-haspopup="menu" aria-expanded={open} disabled={busy} data-testid="action-menu">
                <IconMore />
              </Button>
            )}
          >
            <button type="button" className="menu-item" onClick={() => setEditing(true)} data-testid="action-edit"><IconEdit /> Edit</button>
            {shown.status === 'active' && <button type="button" className="menu-item" onClick={setAside} data-testid="action-archive"><IconArchive /> Set aside</button>}
            {shown.status === 'completed' && <button type="button" className="menu-item" onClick={() => onCheck(false, 'menu')} data-testid="action-reopen"><IconRotate /> Reopen</button>}
            {shown.status === 'archived' && <button type="button" className="menu-item" onClick={restore} data-testid="action-restore"><IconRotate /> Restore</button>}
            {isDreamer && (shown.isPrivate
              ? <button type="button" className="menu-item" onClick={share} data-testid="action-share"><IconUnlock /> Share with coach</button>
              : <button type="button" className="menu-item" onClick={makePrivate} data-testid="action-make-private"><IconLock /> Make private</button>)}
            {isDreamer && (
              <>
                <div className="divider" />
                <button type="button" className="menu-item da-menu-danger" onClick={() => setConfirmDelete(true)} data-testid="action-delete"><IconTrash /> Delete</button>
              </>
            )}
          </Dropdown>
        </div>
      )}

      {isDreamer && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={confirmRemove}
          title="Delete this action?"
          body={<>“{shown.title}” will be gone for good. If you might come back to it, <b>Set aside</b> keeps it without the pressure.</>}
          confirmLabel="Delete"
          danger
          loading={remove.isPending}
        />
      )}
    </li>
  );
}

/* ---------- Inline edit form ---------- */

function ActionEditForm({ action, dreams, labels, pending, onSave, onCancel }: {
  action: ActionItem;
  dreams: DreamRef[];
  labels: Map<number, DreamLabel>;
  pending: boolean;
  onSave: (body: { title: string; details: string; dreamId: number | null; category: CareCategory | null }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(action.title);
  const [details, setDetails] = useState(action.details);
  const [dreamId, setDreamId] = useState<number | null>(action.dreamId);
  const [category, setCategory] = useState<CareCategory | null>(action.category);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  const trimmed = title.trim();
  const dirty = trimmed !== action.title || details.trim() !== action.details || dreamId !== action.dreamId || category !== action.category;
  const canSave = trimmed.length > 0 && !pending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (!dirty) { onCancel(); return; }
    onSave({ title: trimmed, details: details.trim(), dreamId, category });
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  return (
    <form className="da-edit" onSubmit={submit} onKeyDown={onKey} data-testid="action-edit-form" aria-busy={pending || undefined}>
      <Field label="Action" htmlFor={`${id}-title`}>
        <input ref={titleRef} id={`${id}-title`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required disabled={pending} data-testid="action-edit-title" />
      </Field>
      <Field label="Details" hint="Optional — why it matters, where to start.">
        <TextArea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit(); } }}
          rows={2}
          maxLength={4000}
          disabled={pending}
          aria-label="Details"
          data-testid="action-edit-details"
        />
      </Field>
      <LinkSelects dreams={dreams} labels={labels} dreamId={dreamId} category={category} onDreamId={setDreamId} onCategory={setCategory} disabled={pending} idPrefix={`${id}-link`} />
      <div className="da-edit-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending} data-testid="action-edit-cancel">Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={!canSave} loading={pending} data-testid="action-edit-save">Save</Button>
      </div>
    </form>
  );
}
