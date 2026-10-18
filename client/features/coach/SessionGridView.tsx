/**
 * The spreadsheet-like coaching grid: one column per coaching session (oldest →
 * newest), rows for the four CARE categories, the four dreams, Commitment and
 * Satisfaction. Used by the live SessionWorkspacePage (the current session's
 * column is editable) and read-only by StaffDreamerPage and MySessionsPage.
 *
 * Only coaching-session values live here — self check-ins are shown elsewhere so
 * the two sources never blur together. The server already returns only what the
 * viewer may see, so an empty cell is simply an empty cell.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CARE_CATEGORIES, CATEGORY_META, PROGRAM_CATEGORIES, PROGRESS_MAX, PROGRESS_MIN, RATING_MAX, RATING_MIN, type RatingCategory } from '@shared/care';
import type { CoachingSession, SessionGrid } from '@shared/types';
import { CategoryChip, PrivateChip } from '@/components/ui';
import { fmtDate, fmtMonth } from '@/lib/format';

export interface SessionGridViewProps {
  grid: SessionGrid;
  /** The session being edited (its column is highlighted and editable when `editable`). */
  currentSessionId?: number | null;
  editable?: boolean;
  /**
   * Called when the coach edits a value in the current session column. `null` clears a cell. Return the
   * save's promise so a value that didn't save stays marked on its cell and goes again on the next
   * Enter, Tab or blur.
   */
  onRating?: (category: RatingCategory, value: number | null) => Promise<unknown> | void;
  onProgress?: (dreamId: number, value: number | null) => Promise<unknown> | void;
  /** Clicking a column header selects that session (e.g. to open/edit it). */
  onSelectSession?: (sessionId: number) => void;
  /** Show at most the last N sessions (default: all; the grid scrolls horizontally). */
  maxColumns?: number;
  /** Show the change vs. previous column as small deltas. */
  showDeltas?: boolean;
  /** Denser cells. */
  compact?: boolean;
}

type RowDef =
  | { kind: 'rating'; key: string; category: RatingCategory }
  | { kind: 'progress'; key: string; dreamId: number; slotLabel: string; title: string };

const ratingOf = (s: CoachingSession, c: RatingCategory): number | null => s.ratings[c] ?? null;
const progressOf = (s: CoachingSession, dreamId: number): number | null => s.progress[dreamId] ?? null;

function TinyDelta({ now, prev, points }: { now: number | null; prev: number | null; points?: boolean }) {
  if (now == null || prev == null) return null;
  const d = now - prev;
  if (d === 0) return null;
  const cls = d > 0 ? 'cs-delta-up' : 'cs-delta-down';
  const n = Math.abs(d);
  // Dream progress changes are percentage points, so they read "pts" ("1 pt"), never "%".
  return (
    <span className={`cs-delta ${cls} tnum`} aria-label={`${d > 0 ? 'up' : 'down'} ${n}${points ? (n === 1 ? ' point' : ' points') : ''} from the previous session`}>
      {d > 0 ? '+' : '−'}{n}{points && <span className="cs-delta-unit"> {n === 1 ? 'pt' : 'pts'}</span>}
    </span>
  );
}

/**
 * The dreamer's own private session value. The server sends `privateRatings` / `privateProgress`
 * only to the owner while private entries are shown, so staff grids never render this.
 */
function PrivateMark() {
  return <span className="cs-private" data-testid="grid-private"><PrivateChip compact /><span className="sr-only">Private</span></span>;
}

/**
 * Compact number cell for the editable column. Keeps its own text while typing,
 * commits on change (after a short pause), on blur and on Enter; an empty field
 * clears the value on blur or Enter. As in a spreadsheet, Enter and the up/down
 * arrows move between rows (they never change the number), a new number replaces
 * the old one until the coach starts typing, and Escape cancels the edit. A value
 * that didn't save keeps its number, is marked on the cell, and is sent again on
 * the next Enter, Tab or blur — even when the number typed is the same.
 */
function GridNumberInput({ value, min, max, onCommit, label, suffix, testId, cellId, trailing }: {
  value: number | null;
  min: number;
  max: number;
  onCommit: (v: number | null) => Promise<unknown> | void;
  label: string;
  suffix?: string;
  testId: string;
  cellId: string;
  /** Rendered after the input (e.g. the delta vs. the previous session). */
  trailing?: ReactNode;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  const timer = useRef<number | null>(null);
  const lastSent = useRef<number | null>(value);
  // The value when editing began, so Escape can put it back.
  const atFocus = useRef<number | null>(value);
  // Nothing typed since the cell was focused (or since Escape): the whole value stays selected,
  // so a click inside the cell can't drop the caret after it and have the next digits appended.
  const untouched = useRef(true);
  // The last value sent didn't reach the server: the cell says so, and the same number counts as a change.
  const [failed, setFailed] = useState(false);
  const failedRef = useRef(false);
  const markFailed = (v: boolean) => { failedRef.current = v; setFailed(v); };
  // Only the newest send decides whether the cell is marked (an older one may settle after it).
  const sends = useRef(0);
  const errorId = useId();

  // Reflect server changes when the coach isn't mid-edit.
  useEffect(() => {
    if (!focused.current) {
      setText(value == null ? '' : String(value));
      lastSent.current = value;
      markFailed(false);
    }
  }, [value]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const parse = (t: string): number | null | undefined => {
    const trimmed = t.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(min, Math.min(max, Math.round(n)));
  };

  /** Sends the value if it changed; says whether it did. */
  const commit = (t: string) => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const parsed = parse(t);
    if (parsed === undefined) return false;
    if (parsed === lastSent.current && !failedRef.current) return false;
    lastSent.current = parsed;
    // Sent again: the cell stays marked until the answer comes, but a blur right after Enter doesn't resend.
    failedRef.current = false;
    const n = ++sends.current;
    onCommit(parsed)?.then(
      () => { if (sends.current === n) markFailed(false); },
      () => { if (sends.current === n) markFailed(true); },
    );
    return true;
  };

  // Closing or reloading the tab doesn't blur the cell: send what's typed straight away (as a blur
  // would) and, if that had to happen, let the browser ask before leaving while it saves.
  const latest = useRef({ text, commit });
  latest.current = { text, commit };
  useEffect(() => {
    const save = () => latest.current.commit(latest.current.text);
    const onHide = () => { if (document.visibilityState === 'hidden') save(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (save()) e.preventDefault(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const scheduleCommit = (t: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(t), 450);
  };

  const onChange = (raw: string) => {
    untouched.current = false;
    const parsed = parse(raw);
    if (parsed === undefined) { setText(raw); return; }
    const shown = parsed == null ? '' : String(parsed);
    // Keep what was typed unless it had to be clamped (e.g. "12" → "10").
    setText(parsed != null && Number(raw) !== parsed ? shown : raw);
    // An emptied cell is usually about to get a new number, so a pause never deletes the value:
    // clearing commits on blur or Enter.
    if (parsed == null) { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } }
    else scheduleCommit(shown);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // A number field would step its value on the arrow keys; here they move to the next or previous
    // row, so a coach used to the spreadsheet can't change a value (or mark a dream achieved) by accident.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
      e.preventDefault();
      commit(text);
      moveBy(e.currentTarget, e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
    } else if (e.key === 'Escape') {
      // Cancel the edit, as in a spreadsheet: the cell gets back the value it had when editing began
      // and stays selected. Nothing is sent unless a pause already saved the typed value, in which
      // case the original goes back.
      e.preventDefault();
      const original = atFocus.current == null ? '' : String(atFocus.current);
      setText(original);
      commit(original);
      untouched.current = true;
      const el = e.currentTarget;
      window.requestAnimationFrame(() => el.select());
    }
  };

  return (
    <span className={`cs-cell-edit${failed ? ' is-failed' : ''}`}>
      <input
        type="number"
        inputMode="numeric"
        className="cs-input tnum"
        min={min}
        max={max}
        step={1}
        value={text}
        placeholder="–"
        aria-label={label}
        aria-invalid={failed || undefined}
        aria-describedby={failed ? errorId : undefined}
        data-testid={testId}
        data-cs-cell={cellId}
        data-save-failed={failed || undefined}
        onFocus={(e) => { focused.current = true; untouched.current = true; atFocus.current = lastSent.current; e.currentTarget.select(); }}
        onMouseUp={(e) => { if (untouched.current) { e.preventDefault(); e.currentTarget.select(); } }}
        onBlur={() => { focused.current = false; commit(text); }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {suffix && <span className="cs-input-suffix" aria-hidden>{suffix}</span>}
      {failed
        ? <span className="cs-cell-error" id={errorId} title="This value didn’t save. Press Enter, or move to another cell, to try again." data-testid="grid-cell-error">Not saved</span>
        : trailing}
    </span>
  );
}

/** Enter and ↓ behave like Tab (↑ and Shift+Enter like Shift+Tab): move to the next editable cell in the column. */
function moveBy(from: HTMLInputElement, delta: 1 | -1) {
  const all = Array.from(from.closest('table')?.querySelectorAll<HTMLInputElement>('input[data-cs-cell]') ?? []);
  const next = all[all.indexOf(from) + delta];
  if (next) next.focus();
}

export function SessionGridView({ grid, currentSessionId, editable, onRating, onProgress, onSelectSession, maxColumns, showDeltas, compact }: SessionGridViewProps) {
  const allSessions = grid.sessions;
  const sessions = useMemo(() => (maxColumns && maxColumns > 0 && allSessions.length > maxColumns ? allSessions.slice(-maxColumns) : allSessions), [allSessions, maxColumns]);
  const prevOf = useMemo(() => {
    const m = new Map<number, CoachingSession | null>();
    allSessions.forEach((s, i) => m.set(s.id, i > 0 ? allSessions[i - 1]! : null));
    return m;
  }, [allSessions]);

  const dreams = useMemo(() => [...grid.dreams].sort((a, b) => a.slot - b.slot), [grid.dreams]);
  const rows: RowDef[] = useMemo(
    () => [
      ...CARE_CATEGORIES.map((c): RowDef => ({ kind: 'rating', key: `r-${c}`, category: c })),
      ...dreams.map((d): RowDef => ({ kind: 'progress', key: `p-${d.id}`, dreamId: d.id, slotLabel: d.slotLabel, title: d.title })),
      ...PROGRAM_CATEGORIES.map((c): RowDef => ({ kind: 'rating', key: `r-${c}`, category: c })),
    ],
    [dreams],
  );

  // Keep the current (or newest) column in view when there are many months.
  const wrapRef = useRef<HTMLDivElement>(null);
  const targetId = currentSessionId ?? sessions[sessions.length - 1]?.id ?? null;
  const targetRef = useRef(targetId);
  targetRef.current = targetId;
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || targetRef.current == null) return;
    const snap = () => {
      const cell = wrap.querySelector<HTMLElement>(`[data-cs-col="${targetRef.current}"]`);
      const corner = wrap.querySelector<HTMLElement>('.cs-corner');
      if (!cell || !corner) return;
      const stickyW = corner.offsetWidth;
      wrap.style.paddingRight = '';
      const needed = cell.offsetLeft + cell.offsetWidth - wrap.clientWidth;
      if (needed <= 0) { wrap.scrollLeft = 0; return; }
      // Snap so whole columns show next to the sticky labels (no half-hidden month).
      const cols = Array.from(wrap.querySelectorAll<HTMLElement>('th[data-cs-col]'));
      const first = cols.find((c) => c.offsetLeft - stickyW >= needed) ?? cell;
      const want = first.offsetLeft - stickyW;
      // When the table is only slightly wider than the view the browser can't scroll that far,
      // so pad the end by the difference rather than leave a month half under the labels.
      const overshoot = want - (wrap.scrollWidth - wrap.clientWidth);
      if (overshoot > 0) wrap.style.paddingRight = `${overshoot}px`;
      wrap.scrollLeft = want;
    };
    snap();
    // Re-snap when the container or table changes width (rotation, sidebar collapse,
    // web fonts arriving) — but never while the coach is typing in a cell.
    const table = wrap.querySelector('table');
    let lastW = `${wrap.clientWidth}/${table?.offsetWidth ?? 0}`;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          const w = `${wrap.clientWidth}/${table?.offsetWidth ?? 0}`;
          if (w === lastW) return;
          lastW = w;
          if (wrap.contains(document.activeElement)) return;
          snap();
        })
      : null;
    ro?.observe(wrap);
    if (table) ro?.observe(table);
    return () => ro?.disconnect();
  }, [sessions.length]);

  // When another session is selected (e.g. a column header was picked), scroll only as far as needed
  // to show its column — re-snapping would pull the column the coach just clicked out from under them.
  const firstTarget = useRef(true);
  useEffect(() => {
    if (firstTarget.current) { firstTarget.current = false; return; }
    const wrap = wrapRef.current;
    const cell = wrap?.querySelector<HTMLElement>(`[data-cs-col="${targetId}"]`);
    const corner = wrap?.querySelector<HTMLElement>('.cs-corner');
    if (!wrap || !cell || !corner) return;
    const left = cell.offsetLeft - corner.offsetWidth;
    const right = cell.offsetLeft + cell.offsetWidth - wrap.clientWidth;
    if (wrap.scrollLeft > left) wrap.scrollLeft = left;
    else if (wrap.scrollLeft < right) wrap.scrollLeft = right;
  }, [targetId]);

  if (sessions.length === 0) {
    return <div className="cs-grid-empty muted small" data-testid="session-grid-empty">No coaching sessions yet. The first session starts the grid.</div>;
  }

  const canEdit = !!editable && currentSessionId != null;
  const sectionHead = (label: string, cols: number): ReactNode => (
    <tr className="cs-section-row">
      <th scope="rowgroup" className="cs-sticky cs-section">{label}</th>
      <td colSpan={cols} className="cs-section" aria-hidden />
    </tr>
  );

  const renderCell = (row: RowDef, s: CoachingSession) => {
    const isCur = s.id === currentSessionId;
    const prev = prevOf.get(s.id) ?? null;
    if (row.kind === 'rating') {
      const v = ratingOf(s, row.category);
      const pv = prev ? ratingOf(prev, row.category) : null;
      if (isCur && canEdit) {
        return (
          <GridNumberInput
            value={v}
            min={RATING_MIN}
            max={RATING_MAX}
            label={`${CATEGORY_META[row.category].label} rating, session ${s.number}`}
            onCommit={(nv) => onRating?.(row.category, nv)}
            testId={`grid-rating-${row.category}`}
            cellId={`rating-${row.category}`}
            trailing={showDeltas ? <TinyDelta now={v} prev={pv} /> : null}
          />
        );
      }
      return (
        <span className="cs-val tnum" data-testid={isCur ? `grid-rating-${row.category}` : undefined}>
          {v == null ? <span className="cs-none" aria-label="not recorded">–</span> : v}
          {showDeltas && <TinyDelta now={v} prev={pv} />}
          {s.privateRatings?.includes(row.category) && <PrivateMark />}
        </span>
      );
    }
    const v = progressOf(s, row.dreamId);
    const pv = prev ? progressOf(prev, row.dreamId) : null;
    if (isCur && canEdit) {
      return (
        <GridNumberInput
          value={v}
          min={PROGRESS_MIN}
          max={PROGRESS_MAX}
          suffix="%"
          label={`Progress on ${row.title}, session ${s.number}`}
          onCommit={(nv) => onProgress?.(row.dreamId, nv)}
          testId={`grid-progress-${row.dreamId}`}
          cellId={`progress-${row.dreamId}`}
          trailing={showDeltas ? <TinyDelta now={v} prev={pv} points /> : null}
        />
      );
    }
    return (
      <span className="cs-val tnum" data-testid={isCur ? `grid-progress-${row.dreamId}` : undefined}>
        {v == null ? <span className="cs-none" aria-label="not recorded">–</span> : `${v}%`}
        {showDeltas && <TinyDelta now={v} prev={pv} points />}
        {s.privateProgress?.includes(row.dreamId) && <PrivateMark />}
      </span>
    );
  };

  const cls = ['cs-grid-wrap', compact && 'cs-compact', canEdit && 'cs-editing'].filter(Boolean).join(' ');

  return (
    <div className={cls} ref={wrapRef} data-testid="session-grid">
      <table className="cs-grid">
        <thead>
          <tr>
            <th scope="col" className="cs-sticky cs-corner"><span className="sr-only">Measure</span></th>
            {sessions.map((s) => {
              const isCur = s.id === currentSessionId;
              const inner = (
                <>
                  <span className="cs-col-month">{fmtMonth(s.occurredAt)}</span>
                  <span className="cs-col-meta">
                    <span className="cs-col-num tnum">S{s.number}</span>
                    {s.status === 'in_progress' && <span className="cs-col-dot" title="In progress" aria-label="in progress" />}
                  </span>
                </>
              );
              return (
                <th key={s.id} scope="col" className={`cs-col${isCur ? ' cs-cur' : ''}`} data-cs-col={s.id} title={`Session ${s.number} · ${fmtDate(s.occurredAt, { month: 'short', day: 'numeric', year: 'numeric' })}${s.status === 'in_progress' ? ' · in progress' : ''}`}>
                  {onSelectSession ? (
                    <button type="button" className="cs-col-btn" onClick={() => onSelectSession(s.id)} aria-current={isCur ? 'true' : undefined} data-testid={`grid-col-${s.id}`}>
                      {inner}
                    </button>
                  ) : (
                    <span className="cs-col-label" aria-current={isCur ? 'true' : undefined} data-testid={`grid-col-${s.id}`}>{inner}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sectionHead('CARE', sessions.length)}
          {rows.filter((r) => r.kind === 'rating' && (CARE_CATEGORIES as readonly string[]).includes(r.category)).map((row) => (
            <tr key={row.key} className="cs-row" data-testid={`grid-row-${row.key}`}>
              <th scope="row" className="cs-sticky cs-label">{row.kind === 'rating' && <CategoryChip category={row.category} short={compact} />}</th>
              {sessions.map((s) => <td key={s.id} className={`cs-cell${s.id === currentSessionId ? ' cs-cur' : ''}`}>{renderCell(row, s)}</td>)}
            </tr>
          ))}
          {sectionHead('Dreams', sessions.length)}
          {rows.filter((r) => r.kind === 'progress').map((row) => (
            <tr key={row.key} className="cs-row" data-testid={`grid-row-${row.key}`}>
              <th scope="row" className="cs-sticky cs-label">
                {row.kind === 'progress' && (
                  <span className="cs-dream-label">
                    <span className="cs-dream-slot">{row.slotLabel}</span>
                    <span className="cs-dream-title" title={row.title}>{row.title}</span>
                  </span>
                )}
              </th>
              {sessions.map((s) => <td key={s.id} className={`cs-cell${s.id === currentSessionId ? ' cs-cur' : ''}`}>{renderCell(row, s)}</td>)}
            </tr>
          ))}
          {sectionHead('Program', sessions.length)}
          {rows.filter((r) => r.kind === 'rating' && (PROGRAM_CATEGORIES as readonly string[]).includes(r.category)).map((row) => (
            <tr key={row.key} className="cs-row" data-testid={`grid-row-${row.key}`}>
              <th scope="row" className="cs-sticky cs-label">{row.kind === 'rating' && <CategoryChip category={row.category} short={compact} />}</th>
              {sessions.map((s) => <td key={s.id} className={`cs-cell${s.id === currentSessionId ? ' cs-cur' : ''}`}>{renderCell(row, s)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
