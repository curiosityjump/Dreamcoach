import { randomInt } from 'node:crypto';

/**
 * Ids for rows a dreamer can make private (ratings, progress updates, journal entries, actions,
 * check-ins) are random rather than sequential, so the gaps in what staff can see say nothing about
 * how many private rows exist or where they sit. Kept below 2^48 so they stay exact in JavaScript.
 */
export const ID_LIMIT = 2 ** 48;

/** A random row id. Pass a seeded generator (returning [0, 1)) for reproducible demo data. */
export function randomId(rand?: () => number): number {
  return rand ? 1 + Math.floor(rand() * (ID_LIMIT - 1)) : randomInt(1, ID_LIMIT);
}
