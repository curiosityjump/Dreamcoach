/**
 * Visibility scoping. Every read of dreamer data goes through a Scope.
 *
 * includePrivate is true ONLY when the viewer is the dreamer who owns the data
 * AND their signed-in session currently has private entries unlocked (password
 * re-entered within the last 30 minutes of activity). In every other case the
 * SQL filters `is_private = 0`, so private rows are never loaded, counted,
 * aggregated, or serialized — they do not exist for that viewer.
 */
import type { Request, Response } from 'express';
import type { DB } from './db.ts';
import type { Viewer } from './auth.ts';

export interface Scope {
  dreamerId: number;
  includePrivate: boolean;
  viewer: Viewer;
  /** Whether the viewer is this dreamer. */
  isOwner: boolean;
  /** Whether the viewer may record coaching data (assigned coach or director). */
  isCoachFor: boolean;
}

export const INC = (scope: Scope): number => (scope.includePrivate ? 1 : 0);

export function dreamerRow(db: DB, dreamerId: number) {
  return db.prepare('SELECT id, user_id, coach_user_id, program_id, status FROM dreamers WHERE id = ?').get(dreamerId) as
    | { id: number; user_id: number; coach_user_id: number | null; program_id: number; status: string }
    | undefined;
}

/**
 * Resolve the scope for `/api/dreamers/:id/...`. `:id` may be `me` for dreamers.
 * Returns null after writing an error response when access is denied.
 */
export function resolveScope(req: Request, res: Response, idParam: string): Scope | null {
  const viewer = req.viewer!;
  const db = req.db;
  let dreamerId: number;
  if (idParam === 'me') {
    if (viewer.dreamerId == null) {
      res.status(404).json({ error: 'Dreamer not found.', code: 'not_found' });
      return null;
    }
    dreamerId = viewer.dreamerId;
  } else {
    dreamerId = Number(idParam);
    if (!Number.isInteger(dreamerId)) {
      res.status(404).json({ error: 'Dreamer not found.', code: 'not_found' });
      return null;
    }
  }
  const row = dreamerRow(db, dreamerId);
  if (!row) {
    res.status(404).json({ error: 'Dreamer not found.', code: 'not_found' });
    return null;
  }
  const isOwner = viewer.user.role === 'dreamer' && viewer.dreamerId === dreamerId;
  const isAssignedCoach = viewer.user.role === 'coach' && row.coach_user_id === viewer.user.id;
  const isDirector = viewer.user.role === 'director';
  if (!isOwner && !isAssignedCoach && !isDirector) {
    // Same response as a missing dreamer so a coach cannot probe other caseloads.
    res.status(404).json({ error: 'Dreamer not found.', code: 'not_found' });
    return null;
  }
  return {
    dreamerId,
    includePrivate: isOwner && viewer.privateUnlocked,
    viewer,
    isOwner,
    isCoachFor: isAssignedCoach || isDirector,
  };
}

/** A scope with private entries never included — used for staff-facing aggregates. */
export function staffScope(viewer: Viewer, dreamerId: number): Scope {
  return { dreamerId, includePrivate: false, viewer, isOwner: false, isCoachFor: true };
}
