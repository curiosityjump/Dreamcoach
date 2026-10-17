/**
 * Data hooks. Query keys are prefixed by dreamer id so any mutation for a dreamer can
 * invalidate everything about them with one call. Staff aggregates live under
 * ['coach'] and ['director'] and are invalidated on every mutation too, so the
 * connected experience stays current.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { del, get, patch, post, put } from './client';
import type { RatingCategory } from '@shared/care';
import type {
  ActionItem,
  CategoryHistory,
  CheckIn,
  CheckInInput,
  CoachDashboard,
  CoachDetail,
  CoachingSession,
  DirectorDreamerRow,
  DirectorOverview,
  Dream,
  DreamHistory,
  DreamerOverview,
  JournalEntry,
  ProgressEntry,
  RatingEntry,
  SessionGrid,
  TimelineItem,
  User,
} from '@shared/types';

export type DreamerRef = number | 'me';
const dk = (id: DreamerRef, ...rest: unknown[]) => ['dreamer', id, ...rest];

export function useInvalidateDreamer() {
  const qc = useQueryClient();
  return (id: DreamerRef) => {
    qc.invalidateQueries({ queryKey: ['dreamer', id] });
    if (id !== 'me') qc.invalidateQueries({ queryKey: ['dreamer', 'me'] });
    qc.invalidateQueries({ queryKey: ['coach'] });
    qc.invalidateQueries({ queryKey: ['director'] });
  };
}

/* ---------- Dreamer reads ---------- */
export const useOverview = (id: DreamerRef, opts?: Partial<UseQueryOptions<DreamerOverview>>) =>
  useQuery<DreamerOverview>({ queryKey: dk(id, 'overview'), queryFn: () => get(`/dreamers/${id}/overview`), ...opts });
export const useDreams = (id: DreamerRef) => useQuery<Dream[]>({ queryKey: dk(id, 'dreams'), queryFn: () => get(`/dreamers/${id}/dreams`) });
export const useDreamHistory = (id: DreamerRef, dreamId: number | null) =>
  useQuery<DreamHistory>({ queryKey: dk(id, 'dream', dreamId), queryFn: () => get(`/dreamers/${id}/dreams/${dreamId}/history`), enabled: dreamId != null });
export const useRatings = (id: DreamerRef, category?: RatingCategory) =>
  useQuery<RatingEntry[]>({ queryKey: dk(id, 'ratings', category ?? 'all'), queryFn: () => get(`/dreamers/${id}/ratings${category ? `?category=${category}` : ''}`) });
export const useCategoryHistory = (id: DreamerRef, category: RatingCategory | null) =>
  useQuery<CategoryHistory>({ queryKey: dk(id, 'care', category), queryFn: () => get(`/dreamers/${id}/care/${category}`), enabled: !!category });
export const useProgressEntries = (id: DreamerRef) => useQuery<ProgressEntry[]>({ queryKey: dk(id, 'progress'), queryFn: () => get(`/dreamers/${id}/progress`) });
export const useActions = (id: DreamerRef, status: 'active' | 'completed' | 'archived' | 'all' = 'all') =>
  useQuery<ActionItem[]>({ queryKey: dk(id, 'actions', status), queryFn: () => get(`/dreamers/${id}/actions?status=${status}`) });
export const useJournal = (id: DreamerRef, opts: { standalone?: boolean; dreamId?: number; category?: RatingCategory } = {}) => {
  const qs = new URLSearchParams();
  if (opts.standalone) qs.set('standalone', '1');
  if (opts.dreamId) qs.set('dreamId', String(opts.dreamId));
  if (opts.category) qs.set('category', opts.category);
  const s = qs.toString();
  return useQuery<JournalEntry[]>({ queryKey: dk(id, 'journal', s), queryFn: () => get(`/dreamers/${id}/journal${s ? `?${s}` : ''}`) });
};
export const useTimeline = (id: DreamerRef, opts: { limit?: number; from?: string; to?: string; enabled?: boolean } = {}) => {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.from) qs.set('from', opts.from);
  if (opts.to) qs.set('to', opts.to);
  const s = qs.toString();
  return useQuery<TimelineItem[]>({ queryKey: dk(id, 'timeline', s), queryFn: () => get(`/dreamers/${id}/timeline${s ? `?${s}` : ''}`), enabled: opts.enabled });
};
export const useCheckIns = (id: DreamerRef) => useQuery<CheckIn[]>({ queryKey: dk(id, 'check-ins'), queryFn: () => get(`/dreamers/${id}/check-ins`) });
export const useSessions = (id: DreamerRef) => useQuery<CoachingSession[]>({ queryKey: dk(id, 'sessions'), queryFn: () => get(`/dreamers/${id}/sessions`) });
export const useSession = (id: DreamerRef, sid: number | null, opts?: { refetchInterval?: number }) =>
  useQuery<CoachingSession>({ queryKey: dk(id, 'session', sid), queryFn: () => get(`/dreamers/${id}/sessions/${sid}`), enabled: sid != null, ...opts });
export const useGrid = (id: DreamerRef, opts?: { refetchInterval?: number; enabled?: boolean }) => useQuery<SessionGrid>({ queryKey: dk(id, 'grid'), queryFn: () => get(`/dreamers/${id}/grid`), ...opts });

/* ---------- Staff reads ---------- */
export const useCoachDashboard = () => useQuery<CoachDashboard>({ queryKey: ['coach', 'dashboard'], queryFn: () => get('/coach/dashboard') });
export const useDirectorOverview = () => useQuery<DirectorOverview>({ queryKey: ['director', 'overview'], queryFn: () => get('/director/overview') });
export const useDirectorDreamers = () => useQuery<DirectorDreamerRow[]>({ queryKey: ['director', 'dreamers'], queryFn: () => get('/director/dreamers') });
export const useCoachDetail = (coachId: number | null) => useQuery<CoachDetail>({ queryKey: ['director', 'coach', coachId], queryFn: () => get(`/director/coaches/${coachId}`), enabled: coachId != null });
export const useStaff = () => useQuery<User[]>({ queryKey: ['director', 'staff'], queryFn: () => get('/director/staff') });

/* ---------- Mutations ---------- */
function useDreamerMutation<TVars, TData>(id: DreamerRef, fn: (vars: TVars) => Promise<TData>, onSuccess?: (data: TData, vars: TVars) => void) {
  const invalidate = useInvalidateDreamer();
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: (data, vars) => { invalidate(id); onSuccess?.(data, vars); },
  });
}

export const useCreateCheckIn = (id: DreamerRef) => useDreamerMutation<CheckInInput, CheckIn>(id, (input) => post(`/dreamers/${id}/check-ins`, input));

export const useUpdateRating = (id: DreamerRef) =>
  useDreamerMutation<{ ratingId: number; value?: number; isPrivate?: boolean; note?: string | null; notePrivate?: boolean; occurredAt?: string }, RatingEntry>(id, ({ ratingId, ...body }) => patch(`/dreamers/${id}/ratings/${ratingId}`, body));
export const useDeleteRating = (id: DreamerRef) => useDreamerMutation<number, { ok: true }>(id, (ratingId) => del(`/dreamers/${id}/ratings/${ratingId}`));

export const useUpdateProgress = (id: DreamerRef) =>
  useDreamerMutation<{ progressId: number; value?: number; isPrivate?: boolean; note?: string | null; notePrivate?: boolean; occurredAt?: string }, ProgressEntry>(id, ({ progressId, ...body }) => patch(`/dreamers/${id}/progress/${progressId}`, body));
export const useDeleteProgress = (id: DreamerRef) => useDreamerMutation<number, { ok: true }>(id, (progressId) => del(`/dreamers/${id}/progress/${progressId}`));

export const useUpdateDream = (id: DreamerRef) => useDreamerMutation<{ dreamId: number; title?: string; description?: string }, Dream>(id, ({ dreamId, ...body }) => patch(`/dreamers/${id}/dreams/${dreamId}`, body));

export const useCreateJournal = (id: DreamerRef) =>
  useDreamerMutation<{ body: string; isPrivate?: boolean; dreamId?: number | null; category?: RatingCategory | null; occurredAt?: string; sessionId?: number | null }, JournalEntry>(id, (input) => post(`/dreamers/${id}/journal`, input));
export const useUpdateJournal = (id: DreamerRef) =>
  useDreamerMutation<{ journalId: number; body?: string; isPrivate?: boolean; dreamId?: number | null; category?: RatingCategory | null; occurredAt?: string }, JournalEntry>(id, ({ journalId, ...body }) => patch(`/dreamers/${id}/journal/${journalId}`, body));
export const useDeleteJournal = (id: DreamerRef) => useDreamerMutation<number, { ok: true }>(id, (journalId) => del(`/dreamers/${id}/journal/${journalId}`));

export const useCreateAction = (id: DreamerRef) =>
  useDreamerMutation<{ title: string; details?: string; dreamId?: number | null; category?: ActionItem['category']; isPrivate?: boolean; sessionId?: number | null }, ActionItem>(id, (input) => post(`/dreamers/${id}/actions`, input));
export const useUpdateAction = (id: DreamerRef) =>
  useDreamerMutation<{ actionId: number; title?: string; details?: string; dreamId?: number | null; category?: ActionItem['category'] | null; isPrivate?: boolean; status?: ActionItem['status'] }, ActionItem>(id, ({ actionId, ...body }) => patch(`/dreamers/${id}/actions/${actionId}`, body));
export const useDeleteAction = (id: DreamerRef) => useDreamerMutation<number, { ok: true }>(id, (actionId) => del(`/dreamers/${id}/actions/${actionId}`));

export const useStartSession = (id: DreamerRef) => useDreamerMutation<{ occurredAt?: string } | void, CoachingSession>(id, (input) => post(`/dreamers/${id}/sessions`, input ?? {}));
export const useUpdateSession = (id: DreamerRef) =>
  useDreamerMutation<{ sessionId: number; notes?: string; focus?: string; occurredAt?: string; status?: 'in_progress' | 'completed' }, CoachingSession>(id, ({ sessionId, ...body }) => patch(`/dreamers/${id}/sessions/${sessionId}`, body));
export const useDeleteSession = (id: DreamerRef) => useDreamerMutation<number, { ok: true }>(id, (sessionId) => del(`/dreamers/${id}/sessions/${sessionId}`));
export const useSetSessionRating = (id: DreamerRef) =>
  useDreamerMutation<{ sessionId: number; category: RatingCategory; value: number | null }, CoachingSession>(id, ({ sessionId, ...body }) => put(`/dreamers/${id}/sessions/${sessionId}/ratings`, body));
export const useSetSessionProgress = (id: DreamerRef) =>
  useDreamerMutation<{ sessionId: number; dreamId: number; value: number | null }, CoachingSession>(id, ({ sessionId, ...body }) => put(`/dreamers/${id}/sessions/${sessionId}/progress`, body));

export const useReassignDreamer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dreamerId, ...body }: { dreamerId: number; coachUserId?: number | null; status?: 'active' | 'paused' | 'completed' }) => patch(`/director/dreamers/${dreamerId}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['director'] }); qc.invalidateQueries({ queryKey: ['coach'] }); qc.invalidateQueries({ queryKey: ['dreamer'] }); },
  });
};
