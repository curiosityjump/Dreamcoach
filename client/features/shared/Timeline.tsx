/**
 * CONTRACT — shared timeline/journal rendering used by the dreamer Home and Journal
 * pages, dream/category history pages and staff views. The dreamer-journal agent
 * owns the implementation; other pages code against these props.
 */
import type { JournalEntry, TimelineItem, Dream } from '@shared/types';
import type { DreamerRef } from '@/api/hooks';

export type TimelineMode = 'dreamer' | 'staff';

export interface TimelineFeedProps {
  items: TimelineItem[];
  dreamerRef: DreamerRef;
  /** dreamer: entries are editable (own journal), privacy visible. staff: read-only, no privacy UI. */
  mode: TimelineMode;
  /** For labelling dream links. */
  dreams?: Pick<Dream, 'id' | 'title' | 'slot'>[];
  /** Group items under day headings (default true). */
  groupByDay?: boolean;
  /** Show at most this many items (with no "more" control — callers paginate). */
  limit?: number;
  /** Denser layout. */
  compact?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}

/** Chronological feed mixing ratings, progress updates, reflections, action events and sessions. */
export function TimelineFeed(_props: TimelineFeedProps) {
  return <div className="muted small">Timeline — implementation pending.</div>;
}

export interface JournalEntryCardProps {
  entry: JournalEntry;
  dreamerRef: DreamerRef;
  mode: TimelineMode;
  dreams?: Pick<Dream, 'id' | 'title' | 'slot'>[];
  /** Hide the date line (when a parent already shows it). */
  hideDate?: boolean;
  compact?: boolean;
}

/** One reflection: body, tags (dream/category), source, privacy chip; in dreamer mode: edit, toggle privacy, delete. */
export function JournalEntryCard(_props: JournalEntryCardProps) {
  return <div className="muted small">Journal entry — implementation pending.</div>;
}
