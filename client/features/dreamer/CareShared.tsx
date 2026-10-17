/**
 * Small pieces shared by the dreamer-care pages (CarePage, CategoryHistoryPage,
 * CheckInPage). Everything here is the dreamer's own data (`'me'`), so privacy
 * controls are allowed; the server already decides what the viewer may see.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { CATEGORY_META, type RatingCategory } from '@shared/care';
import type { AuthState, LatestRating, RatingEntry } from '@shared/types';
import type { TrendPoint } from '@/components/charts';
import { fmtDate } from '@/lib/format';

export const PRIVATE_HIDDEN_MSG = 'Saved as private — private entries are currently hidden.';

/** The toast to show after something was saved, depending on whether any part of it is private. */
export function savedToast(auth: AuthState | null, anyPrivate: boolean, sharedMessage: string, privateMessage: string): [string, 'success' | 'private'] {
  if (!anyPrivate) return [sharedMessage, 'success'];
  return [auth?.privateUnlocked ? privateMessage : PRIVATE_HIDDEN_MSG, 'private'];
}

/** CSS variables for a category's color + tint, for use on `style`. */
export function catVars(category: RatingCategory): CSSProperties {
  const m = CATEGORY_META[category];
  return { '--dc-color': m.color, '--dc-tint': m.tint } as CSSProperties;
}

export function toTrendPoint(e: RatingEntry): TrendPoint {
  return { at: e.occurredAt, value: e.value, source: e.source, isPrivate: e.isPrivate, note: e.note?.body ?? null };
}

/** Who recorded a session entry, for the SourceChip ("Session · Daniel Okafor"). */
export function coachNameFor(e: RatingEntry): string | undefined {
  return e.source === 'session' && e.recordedBy.role !== 'dreamer' ? e.recordedBy.name : undefined;
}

/** "Session · Oct 14" / "Self check-in · Oct 14". */
export function latestLine(l: LatestRating): string {
  return `${l.source === 'session' ? 'Coaching session' : 'Self check-in'} · ${fmtDate(l.occurredAt)}`;
}

/** Sort ratings oldest first (the API already does, but callers may merge lists). */
export const byTimeAsc = <T extends { occurredAt: string }>(a: T, b: T) => a.occurredAt.localeCompare(b.occurredAt);
export const byTimeDesc = <T extends { occurredAt: string }>(a: T, b: T) => b.occurredAt.localeCompare(a.occurredAt);

/**
 * A quiet, factual sentence about a category's recent range, e.g.
 * "Your Energy ranged 4–8 across 9 entries over the last 90 days."
 */
export function rangeInsight(category: RatingCategory, entries: RatingEntry[], now = Date.now()): string | null {
  const label = CATEGORY_META[category].label;
  const cutoff = now - 90 * 86400000;
  const recent = entries.filter((e) => new Date(e.occurredAt).getTime() >= cutoff);
  const pool = recent.length >= 2 ? recent : entries;
  if (pool.length < 2) return null;
  const values = pool.map((e) => e.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const sessions = pool.filter((e) => e.source === 'session').length;
  const selfs = pool.length - sessions;
  const mix = sessions && selfs ? ` (${sessions} from coaching sessions, ${selfs} self check-in${selfs === 1 ? '' : 's'})` : '';
  const window = recent.length >= 2 ? 'over the last 90 days' : `since ${fmtDate(pool[0]!.occurredAt)}`;
  const n = `${pool.length} entries`;
  if (lo === hi) return `Your ${label} has held steady at ${lo} across ${n} ${window}${mix}.`;
  return `Your ${label} ranged ${lo}–${hi} across ${n} ${window}${mix}.`;
}

/** True below the given width; re-evaluates on resize. Used to simplify the wheel on phones. */
export function useNarrow(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return narrow;
}

/** The value badge used in entry lists: a number on the category's tint. */
export function ValueBadge({ category, value, large }: { category: RatingCategory; value: number; large?: boolean }) {
  return (
    <span className={`dc-val tnum${large ? ' dc-val-lg' : ''}`} style={catVars(category)} aria-label={`${CATEGORY_META[category].label} ${value}`}>
      {value}
    </span>
  );
}
