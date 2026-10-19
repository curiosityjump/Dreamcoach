/**
 * Unsaved work across a privacy change (DECISIONS #12). Hiding private entries — Hide private, the automatic
 * re-hide, another tab — drops the dreamer's cached data and loads it again. So:
 *  - pages show their loading state on a first load only (`useLoadedOnce`, `useLastKnown`) and keep their forms
 *    mounted through a reload, with placeholders where the data goes;
 *  - row editors keep their drafts in the page (`KeepDrafts`, `useKeptDraft`) while their list reloads, and find
 *    them again when the row is back;
 *  - a draft that was private when private entries went out of view stays, covered by a short notice
 *    (`useCoveredParts`, `CoveredDraft`), until they are shown again.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
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
 */
export function useCoveredParts(privateParts: readonly string[]): ReadonlySet<string> {
  const unlocked = !!useAuth().auth?.privateUnlocked;
  const [seen, setSeen] = useState({ unlocked, covered: NONE });
  const now = seen.unlocked === unlocked ? seen.covered : unlocked ? NONE : new Set(privateParts);
  if (seen.unlocked !== unlocked) setSeen({ unlocked, covered: now });
  return now;
}

/** `useCoveredParts` for a form with one private switch. */
export const useCovered = (isPrivate: boolean): boolean => useCoveredParts(isPrivate ? ['draft'] : []).has('draft');

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
