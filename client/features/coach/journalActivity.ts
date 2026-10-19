import type { JournalEntry } from '@shared/types';

/**
 * A dreamer's own note on a value a coach recorded in a session (outside any check-in). It takes the
 * session's date, but it is a reflection of theirs written later, so it counts — and is listed — when
 * it was written (as for "Last self activity" on the dashboard).
 */
export const isSessionValueNote = (j: JournalEntry) => j.checkInId == null && (j.ratingId != null || j.progressId != null) && j.author.role === 'dreamer';

/** When a journal entry counts as the dreamer's activity. */
export const activityAt = (j: JournalEntry) => (isSessionValueNote(j) ? j.createdAt : j.occurredAt);
