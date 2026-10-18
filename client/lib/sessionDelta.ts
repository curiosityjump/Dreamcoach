import type { CoachingSession } from '@shared/types';

/**
 * What a "current value" change is measured against: always a coaching session, named in the label,
 * so dreamer and staff views agree with the session grid. A value recorded in session N is compared
 * with the session before it (as the grid's column is); a self check-in since then with the latest
 * session before it. `sessions` must be in chronological order.
 */
export function sessionBaseline(
  sessions: CoachingSession[],
  at: string,
  fromSession: boolean,
  valueOf: (s: CoachingSession) => number | undefined,
): { value: number; label: string } | null {
  if (fromSession) {
    const i = sessions.findIndex((s) => s.occurredAt === at);
    const prev = i > 0 ? sessions[i - 1]! : null;
    const v = prev ? valueOf(prev) : undefined;
    return prev && v != null ? { value: v, label: `vs S${prev.number}` } : null;
  }
  const t = Date.parse(at);
  for (let j = sessions.length - 1; j >= 0; j--) {
    const s = sessions[j]!;
    const v = valueOf(s);
    if (Date.parse(s.occurredAt) <= t && v != null) return { value: v, label: `since S${s.number}` };
  }
  return null;
}
