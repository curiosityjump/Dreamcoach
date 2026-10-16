/**
 * CONTRACT — the spreadsheet-like coaching grid (months as columns; CARE, dreams,
 * commitment, satisfaction as rows). Used by the live SessionWorkspacePage
 * (editable current column) and read-only by StaffDreamerPage and MySessionsPage.
 * The coach-session agent owns the implementation.
 */
import type { SessionGrid } from '@shared/types';
import type { RatingCategory } from '@shared/care';

export interface SessionGridViewProps {
  grid: SessionGrid;
  /** The session being edited (its column is highlighted and editable when `editable`). */
  currentSessionId?: number | null;
  editable?: boolean;
  /** Called when the coach edits a value in the current session column. `null` clears a cell. */
  onRating?: (category: RatingCategory, value: number | null) => void;
  onProgress?: (dreamId: number, value: number | null) => void;
  /** Clicking a column header selects that session (e.g. to open/edit it). */
  onSelectSession?: (sessionId: number) => void;
  /** Show at most the last N sessions (default: all; the grid scrolls horizontally). */
  maxColumns?: number;
  /** Show the change vs. previous column as small deltas. */
  showDeltas?: boolean;
  /** Denser cells. */
  compact?: boolean;
}

export function SessionGridView(_props: SessionGridViewProps) {
  return <div className="muted small">Session grid — implementation pending.</div>;
}
