/**
 * Shared API types — the contract between server and client.
 * Every object the API returns is described here. Private rows never leave the
 * server unless the viewer is the owning dreamer AND their session has private
 * entries unlocked; in that case `isPrivate` is populated. For every other viewer
 * `isPrivate` is always false (private rows simply do not exist in their responses).
 */
import type { RatingCategory, CareCategory } from './care';

export type Role = 'dreamer' | 'coach' | 'director';
export type EntrySource = 'session' | 'self';
export type ActionStatus = 'active' | 'completed' | 'archived';
export type DreamerStatus = 'active' | 'paused' | 'completed';
export type CoachingSessionStatus = 'in_progress' | 'completed';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  /** Short initials for avatars. */
  initials: string;
  /** Only populated for the signed-in user. */
  createdAt?: string;
}

export interface AuthState {
  user: User;
  /** Dreamers only: are private entries currently revealed in this session? */
  privateUnlocked: boolean;
  /** ISO timestamp when the unlock expires if no activity (dreamers only). */
  privateUnlockedUntil: string | null;
  /** The dreamer profile when the user is a dreamer. */
  dreamerId: number | null;
  /** True when a coach/director has at least one dreamer assigned (director may coach). */
  coachesDreamers: boolean;
}

export interface Program {
  id: number;
  name: string;
  description: string;
  /** Guidance labels for the four dream slots, e.g. "6–12 months". */
  slotLabels: [string, string, string, string];
  slotGuidance: [string, string, string, string];
  startsOn: string;
  endsOn: string;
}

export interface DreamerProfile {
  id: number;
  userId: number;
  name: string;
  email: string;
  initials: string;
  status: DreamerStatus;
  joinedOn: string;
  /** Short free-text context the dreamer chose to share (department, pronouns, etc.). */
  about: string | null;
  coach: { id: number; userId: number; name: string; initials: string } | null;
  program: Program;
}

export interface Dream {
  id: number;
  dreamerId: number;
  slot: 1 | 2 | 3 | 4;
  slotLabel: string;
  title: string;
  description: string;
  /** Latest visible progress 0–100 (null when nothing recorded yet). */
  progress: number | null;
  progressAt: string | null;
  /** Progress recorded in the previous visible update, for delta display. */
  previousProgress: number | null;
  /** True only for the owner (unlocked) when the current progress comes from a private update. */
  progressIsPrivate: boolean;
  achievedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeActions: number;
}

export interface JournalNote {
  id: number;
  body: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RatingEntry {
  id: number;
  dreamerId: number;
  category: RatingCategory;
  value: number;
  occurredAt: string;
  source: EntrySource;
  sessionId: number | null;
  /** Check-in group id for self check-ins (several ratings entered together). */
  checkInId: number | null;
  recordedBy: { id: number; name: string; role: Role };
  isPrivate: boolean;
  /** Note attached to this specific rating (absent when hidden/none). */
  note: JournalNote | null;
}

export interface ProgressEntry {
  id: number;
  dreamerId: number;
  dreamId: number;
  value: number;
  occurredAt: string;
  source: EntrySource;
  sessionId: number | null;
  checkInId: number | null;
  recordedBy: { id: number; name: string; role: Role };
  isPrivate: boolean;
  note: JournalNote | null;
}

export interface JournalEntry {
  id: number;
  dreamerId: number;
  body: string;
  occurredAt: string;
  isPrivate: boolean;
  source: EntrySource;
  sessionId: number | null;
  checkInId: number | null;
  /** What this reflection is attached to, if anything. */
  ratingId: number | null;
  progressId: number | null;
  /** Optional tags chosen by the dreamer. */
  dreamId: number | null;
  category: RatingCategory | null;
  author: { id: number; name: string; role: Role };
  createdAt: string;
  updatedAt: string;
}

export interface ActionItem {
  id: number;
  dreamerId: number;
  title: string;
  details: string;
  status: ActionStatus;
  dreamId: number | null;
  category: CareCategory | null;
  isPrivate: boolean;
  createdAt: string;
  createdBy: { id: number; name: string; role: Role };
  /** The coaching session this action was chosen in, if any. */
  sessionId: number | null;
  completedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
}

export interface CoachingSession {
  id: number;
  dreamerId: number;
  coach: { id: number; name: string; initials: string };
  /** Sequence number within the dreamer's history (1 = first session). */
  number: number;
  status: CoachingSessionStatus;
  occurredAt: string;
  completedAt: string | null;
  /** Running notes written by the coach during the session (visible to the dreamer). */
  notes: string;
  /** Focus for the coming period, chosen together (free text). */
  focus: string;
  ratings: Partial<Record<RatingCategory, number>>;
  progress: Record<number, number>; // dreamId -> value
  /**
   * Owner-only, and only while private entries are shown: categories / dreams whose value in this
   * session is a private entry. Omitted entirely for staff and for the owner in hidden mode, so those
   * payloads carry no trace of privacy.
   */
  privateRatings?: RatingCategory[];
  privateProgress?: number[];
  /** Visible actions chosen in this session. */
  actionsCreated: number;
  /** How many of the actions chosen in this session are now completed (at any time since). */
  actionsCompleted: number;
}

/** Columns of the live coaching grid: one per coaching session, oldest first. */
export interface SessionGrid {
  dreams: Pick<Dream, 'id' | 'slot' | 'slotLabel' | 'title'>[];
  sessions: CoachingSession[];
}

export interface LatestRating {
  category: RatingCategory;
  value: number;
  occurredAt: string;
  source: EntrySource;
  /** The previous visible value for this category, for delta display. */
  previous: number | null;
  /** True only for the owner (unlocked) when the latest value is a private entry. */
  isPrivate: boolean;
}

export interface Snapshot {
  latest: Partial<Record<RatingCategory, LatestRating>>;
  dreams: Dream[];
  activeActions: number;
  completedActions30d: number;
  lastSession: { id: number; occurredAt: string; number: number; status: CoachingSessionStatus } | null;
  openSession: { id: number; occurredAt: string } | null;
  /** When the newest visible self check-in happened (the same check-ins `/check-ins` lists). */
  lastSelfCheckIn: string | null;
  /**
   * The dreamer's newest visible self activity: a check-in, or a standalone reflection written in
   * their journal, whichever is newer. Only shared entries count for staff (DECISIONS #7).
   */
  lastSelfActivity: { at: string; kind: 'check-in' | 'reflection' } | null;
  selfCheckIns30d: number;
  /** Visible self journal entries (reflections and check-in notes) in the last 30 days; session entries are not counted. */
  journalEntries30d: number;
  sessionsCompleted: number;
}

export interface DreamerOverview {
  dreamer: DreamerProfile;
  snapshot: Snapshot;
  /** Most recent visible activity (ratings, progress, journal, actions, sessions), newest first. */
  recentActivity: TimelineItem[];
}

export type TimelineItem =
  | { kind: 'rating'; at: string; item: RatingEntry }
  | { kind: 'progress'; at: string; item: ProgressEntry; dreamTitle: string }
  | { kind: 'journal'; at: string; item: JournalEntry }
  | { kind: 'action'; at: string; item: ActionItem; event: 'created' | 'completed' | 'archived' }
  | { kind: 'session'; at: string; item: CoachingSession };

export interface CheckIn {
  id: number;
  dreamerId: number;
  occurredAt: string;
  source: EntrySource;
  sessionId: number | null;
  ratings: RatingEntry[];
  progress: ProgressEntry[];
  reflection: JournalEntry | null;
}

/** Payload for a self check-in: any subset of categories / dreams, each with its own privacy. */
export interface CheckInInput {
  occurredAt?: string;
  ratings?: { category: RatingCategory; value: number; isPrivate?: boolean; note?: string; notePrivate?: boolean }[];
  progress?: { dreamId: number; value: number; isPrivate?: boolean; note?: string; notePrivate?: boolean }[];
  reflection?: { body: string; isPrivate?: boolean } | null;
}

export interface CategoryHistory {
  category: RatingCategory;
  entries: RatingEntry[]; // oldest first
  /** Check-in level reflections written alongside a rating in this category. */
  reflections: JournalEntry[];
}

export interface DreamHistory {
  dream: Dream;
  entries: ProgressEntry[]; // oldest first
  actions: ActionItem[];
  reflections: JournalEntry[];
}

/* ---------- Coach ---------- */

export interface CaseloadEntry {
  dreamer: DreamerProfile;
  snapshot: Snapshot;
  /** Average of the four latest CARE ratings (visible), or null. */
  careAverage: number | null;
  /** Average current dream progress (visible), or null. */
  dreamAverage: number | null;
  lastActivityAt: string | null;
  lastActivityKind: 'session' | 'self' | null;
}

export interface CoachDashboard {
  coach: User;
  caseload: CaseloadEntry[];
  stats: {
    /** Everyone in the caseload, paused and completed dreamers included. */
    dreamers: number;
    activeDreamers: number;
    /** Completed sessions this coach ran (whoever the dreamer is assigned to now). */
    sessionsThisMonth: number;
    sessionsLast30d: number;
    /** Active dreamers in the caseload with a completed session (by anyone) in the last 45 days. */
    dreamersSeenLast45d: number;
    selfCheckInsLast30d: number;
    /** In-progress sessions with dreamers in the caseload. */
    openSessions: number;
  };
}

/* ---------- Director ---------- */

/**
 * One coach's figures (or the whole team's). Session counts are coaching activity, credited to the
 * person who ran each session. Everything else describes the coach's current caseload.
 */
export interface CoachSummary {
  coach: User;
  dreamers: number;
  activeDreamers: number;
  /** Completed sessions this coach ran (for the team: every completed session). */
  sessionsLast30d: number;
  sessionsTotal: number;
  /** % of active dreamers with a completed session in the last 45 days. */
  participation45d: number | null;
  /** Active dreamers with a shared self check-in or self journal entry in the last 30 days (out of activeDreamers). */
  engagedBetweenSessions30d: number;
  /** Mean change in CARE average between first and latest session (dreamers with >= 2 sessions). */
  careChange: { value: number; n: number } | null;
  avgCommitment: number | null;
  avgSatisfaction: number | null;
  avgDreamProgress: number | null;
  dreamsAchieved: number;
  actionsCompleted90d: number;
  /** Among shared actions created > 30 days ago: % completed. */
  followThrough: { rate: number; n: number } | null;
}

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string; // "Feb 2026"
  /** Completed sessions; on a coach's page, the sessions that coach ran. */
  sessions: number;
  selfCheckIns: number;
  journalEntries: number;
  actionsCompleted: number;
  actionsCreated: number;
  /** Average session ratings recorded in the month (visible only). */
  care: Partial<Record<RatingCategory, number>>;
  careAverage: number | null;
  dreamProgress: number | null;
  activeDreamers: number;
}

export interface DirectorOverview {
  program: Program;
  totals: {
    coaches: number;
    dreamers: number;
    activeDreamers: number;
    sessionsTotal: number;
    sessionsLast30d: number;
    sessionsThisMonth: number;
    participation45d: number | null;
    engagedBetweenSessions30d: number;
    dreamsAchieved: number;
    avgDreamProgress: number | null;
    avgCommitment: number | null;
    avgSatisfaction: number | null;
    careChange: { value: number; n: number } | null;
    careLatest: Partial<Record<RatingCategory, number>>;
    actionsCompleted90d: number;
    followThrough: { rate: number; n: number } | null;
  };
  coaches: CoachSummary[];
  months: MonthPoint[];
}

export interface DirectorDreamerRow extends CaseloadEntry {
  careChange: number | null;
  sessionsCompleted: number;
}

export interface CoachDetail {
  summary: CoachSummary;
  caseload: CaseloadEntry[];
  months: MonthPoint[];
}

/* ---------- Generic ---------- */

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}
