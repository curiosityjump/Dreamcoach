/**
 * Unsaved work across a privacy change (DECISIONS #12). Hiding private entries — Hide private, the automatic
 * re-hide, another tab — drops the dreamer's cached data and loads it again. So:
 *  - pages show their loading state on a first load only (`useLoadedOnce`, `useLastKnown`) and keep their forms
 *    mounted through a reload, with placeholders where the data goes;
 *  - row editors keep their drafts in the page (`KeepDrafts`, `useKeptDraft`) while their list reloads, and find
 *    them again when the row is back;
 *  - a draft that was private when private entries went out of view stays, covered by a short notice
 *    (`useCoveredParts`, `CoveredDraft`), until they are shown again;
 *  - a form that closes once its entry is added waits a moment, and stays open if the next one is being typed
 *    (`useCloseAfterAdd`).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui';
import { IconLock, IconUnlock } from '@/components/icons';
import { UnlockDialog } from '@/features/shared/PrivacyControl';

/** True once `loaded` has been true (for this `key`, e.g. the dream or area the page is about). */
export function useLoadedOnce(loaded: boolean, key: unknown = null): boolean {
  const [seenKey, setSeenKey] = useState<{ key: unknown } | null>(loaded ? { key } : null);
  if (loaded && seenKey?.key !== key) setSeenKey({ key });
  return loaded || seenKey?.key === key;
}

/**
 * The value, or while it reloads the last one there was (for this `key`). Only for what is never private — a
 * dream's title, say — that a page keeps showing while it waits.
 */
export function useLastKnown<T>(value: T | undefined, key: unknown = null): T | undefined {
  const [kept, setKept] = useState<{ key: unknown; value: T } | null>(value === undefined ? null : { key, value });
  if (value !== undefined && (!kept || kept.value !== value || kept.key !== key)) setKept({ key, value });
  return value ?? (kept && kept.key === key ? kept.value : undefined);
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Which parts of a form are covered right now: `privateParts` names the parts that are private and hold something;
 * those that were private when private entries went out of view stay covered until they are shown again. A part
 * made private while private entries are hidden is being written there and then, so it is never covered.
 *
 * A form that stays open after it lets go of its draft (saved it, cleared it, discarded a part) calls `uncover` —
 * with the parts it let go of, or with none for all of them: what it holds next is being written while private
 * entries are hidden. Only the form can tell: a part that merely drops out of `privateParts` may still hold the
 * same words (its rating made private too, a card taken off and put back), so it stays covered.
 */
export function useCoveredParts(privateParts: readonly string[]): [ReadonlySet<string>, (parts?: readonly string[]) => void] {
  const unlocked = !!useAuth().auth?.privateUnlocked;
  const [seen, setSeen] = useState({ unlocked, covered: NONE });
  const now = seen.unlocked === unlocked ? seen.covered : unlocked ? NONE : new Set(privateParts);
  if (seen.unlocked !== unlocked) setSeen({ unlocked, covered: now });
  const uncover = useCallback((parts?: readonly string[]) => setSeen((s) => {
    const left = parts ? [...s.covered].filter((p) => !parts.includes(p)) : [];
    return left.length === s.covered.size ? s : { ...s, covered: left.length ? new Set(left) : NONE };
  }), []);
  return [now, uncover];
}

/** `useCoveredParts` for a form with one private switch: whether it is covered, and `uncover` once it is emptied. */
export function useCovered(isPrivate: boolean): [boolean, () => void] {
  const [parts, uncover] = useCoveredParts(isPrivate ? ['draft'] : []);
  return [parts.has('draft'), useCallback(() => uncover(), [uncover])];
}

/**
 * Stands in for a covered draft (or the private part of one). Saving it still works; its words come back once
 * private entries are shown. Inside a dialog, pass `onShowPrivate` to make way for the password dialog.
 */
export function CoveredDraft({ onShowPrivate, testId = 'covered-draft' }: { onShowPrivate?: () => void; testId?: string }) {
  const { unlockPrivate } = useAuth();
  const [asking, setAsking] = useState(false);
  return (
    <div className="callout callout-private dc-covered" role="status" data-testid={testId}>
      <IconLock />
      <div className="dc-covered-body">
        <span>Private draft hidden — show private entries to continue.</span>
        <Button variant="secondary" size="sm" onClick={onShowPrivate ?? (() => setAsking(true))} data-testid={`${testId}-show`}><IconUnlock /> Show private entries</Button>
      </div>
      {!onShowPrivate && (
        // The dialog is drawn over the page, but its password form still sits inside this draft's form: its submit
        // must not save the draft as well.
        <span onSubmit={(e) => e.stopPropagation()}><UnlockDialog open={asking} onClose={() => setAsking(false)} onUnlock={unlockPrivate} /></span>
      )}
    </div>
  );
}

/** How long a form that closes once its entry is added stays open for the next one to be typed. */
const CLOSE_AFTER_ADD_MS = 1500;

/**
 * For a form that closes once its entry is added (an action composer, whose next entry is often typed straight
 * away): `added(typing)` closes it after a moment unless something is being typed by then, and `typed()` — from
 * the form's input events — keeps it open. So it never closes on what is being typed.
 */
export function useCloseAfterAdd(close: () => void): { added: (typing: boolean) => void; typed: () => void } {
  const timer = useRef<number | undefined>(undefined);
  const closeRef = useRef(close);
  closeRef.current = close;
  const typed = useCallback(() => window.clearTimeout(timer.current), []);
  const added = useCallback((typing: boolean) => {
    window.clearTimeout(timer.current);
    if (!typing) timer.current = window.setTimeout(() => closeRef.current(), CLOSE_AFTER_ADD_MS);
  }, []);
  useEffect(() => typed, [typed]);
  return { added, typed };
}

const Kept = createContext<Map<string, unknown> | null>(null);

/** Holds row editors' drafts for as long as the page is open (see `useKeptDraft`). */
export function KeepDrafts({ children }: { children: ReactNode }) {
  const [kept] = useState(() => new Map<string, unknown>());
  return <Kept.Provider value={kept}>{children}</Kept.Provider>;
}

/** A kept draft, and whether it was private while private entries were showing. */
type KeptRecord<T> = { draft: T; shownPrivate: boolean };

/**
 * A row editor's draft (null while the row isn't editing). Inside `KeepDrafts` it outlives the row: when the list
 * loads again, or the entry is out of view while private entries are hidden, the row comes back to it. `covered`
 * is true while private entries are hidden if the draft was private (`isPrivate`) while they were showing; one
 * made private while they are hidden is being written there and then, so it is never covered.
 */
export function useKeptDraft<T>(key: string, isPrivate: (draft: T) => boolean): { draft: T | null; setDraft: (next: T | null) => void; patchDraft: (patch: Partial<T>) => void; covered: boolean } {
  const kept = useContext(Kept);
  const unlocked = !!useAuth().auth?.privateUnlocked;
  const [rec, setRec] = useState<KeptRecord<T> | null>(() => (kept?.get(key) as KeptRecord<T> | undefined) ?? null);
  const update = useCallback((next: (prev: T | null) => T | null) => {
    setRec((prev) => {
      const d = next(prev?.draft ?? null);
      const r = d === null ? null : { draft: d, shownPrivate: isPrivate(d) && (unlocked || (!!prev?.shownPrivate && isPrivate(prev.draft))) };
      if (r === null) kept?.delete(key);
      else kept?.set(key, r);
      return r;
    });
  }, [isPrivate, kept, key, unlocked]);
  // Private while private entries show: from now on it is covered whenever they're hidden.
  if (rec && unlocked && !rec.shownPrivate && isPrivate(rec.draft)) update((d) => d);
  const setDraft = useCallback((next: T | null) => update(() => next), [update]);
  const patchDraft = useCallback((patch: Partial<T>) => update((prev) => (prev === null ? null : { ...prev, ...patch })), [update]);
  return { draft: rec?.draft ?? null, setDraft, patchDraft, covered: !!rec && !unlocked && rec.shownPrivate && isPrivate(rec.draft) };
}
