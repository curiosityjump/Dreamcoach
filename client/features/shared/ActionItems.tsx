/**
 * CONTRACT — shared action-item components used by the dreamer Actions page, the
 * staff dreamer page and the live session workspace. The dreamer-actions agent
 * owns the implementation; other pages code against these props.
 */
import type { ActionItem, Dream } from '@shared/types';
import type { DreamerRef } from '@/api/hooks';

export type ActionMode = 'dreamer' | 'staff';

export interface ActionListProps {
  /** 'me' for the dreamer's own pages, numeric id for staff pages. */
  dreamerRef: DreamerRef;
  /** Already-fetched actions (any statuses); the list filters by `filter`. */
  actions: ActionItem[];
  /** The dreamer's dreams, for linking/labels. */
  dreams: Pick<Dream, 'id' | 'title' | 'slot'>[];
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
}

/** Full-featured list: complete/reopen, edit (title, details, dream, category), set aside/restore, privacy (dreamer mode), delete (dreamer mode). */
export function ActionList(_props: ActionListProps) {
  return <div className="muted small">Actions list — implementation pending.</div>;
}

export interface ActionComposerProps {
  dreamerRef: DreamerRef;
  dreams: Pick<Dream, 'id' | 'title' | 'slot'>[];
  mode: ActionMode;
  sessionId?: number | null;
  /** Preselect a dream or category (e.g. from a dream detail page). */
  defaultDreamId?: number | null;
  defaultCategory?: ActionItem['category'];
  onDone?: (action: ActionItem) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

/** The "Add an action" form (title, optional details, dream/category link, privacy in dreamer mode). */
export function ActionComposer(_props: ActionComposerProps) {
  return <div className="muted small">Action composer — implementation pending.</div>;
}
