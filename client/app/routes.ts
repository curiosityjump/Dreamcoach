import type { AuthState } from '@shared/types';

export function homeFor(a: AuthState): string {
  if (a.user.role === 'dreamer') return '/home';
  if (a.user.role === 'director') return '/director';
  return '/coach';
}

/** Where staff open a dreamer. */
export const staffDreamerPath = (dreamerId: number, tab?: string) => `/dreamers/${dreamerId}${tab ? `/${tab}` : ''}`;
export const sessionPath = (dreamerId: number, sessionId: number) => `/dreamers/${dreamerId}/session/${sessionId}`;
export const presentPath = (dreamerId: number, sessionId: number) => `/dreamers/${dreamerId}/session/${sessionId}/present`;
