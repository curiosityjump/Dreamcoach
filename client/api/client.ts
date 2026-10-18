import type { ApiError } from '@shared/types';

export class ApiRequestError extends Error {
  constructor(public status: number, public body: ApiError) {
    super(body.error);
  }
  get code() { return this.body.code; }
}

export const UNAUTHENTICATED_EVENT = 'dc:unauthenticated';

// The server keeps private entries showing for 30 minutes after the last *interaction*, so every request
// says how long ago that was; polling and other background reads then never extend the unlock.
let lastInteraction = Date.now();
if (typeof window !== 'undefined') {
  const mark = () => { lastInteraction = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(ev, mark, { capture: true, passive: true });
}

let readsHeld: Promise<unknown> | null = null;

/** Reads wait until `until` settles, so none can reach the server first (e.g. before it has hidden private entries). */
export async function holdReads<T>(until: Promise<T>): Promise<T> {
  const held = until.catch(() => {});
  readsHeld = held;
  try {
    return await until;
  } finally {
    if (readsHeld === held) readsHeld = null;
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (method === 'GET' && readsHeld) await readsHeld;
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'x-dc-idle': String(Date.now() - lastInteraction), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!res.ok) {
    const err = (data as ApiError) ?? { error: `Request failed (${res.status})` };
    // A wrong password (signing in, or re-entering it to show private entries) stays in its form;
    // any other 401 means the session is gone.
    if (res.status === 401 && err.code !== 'bad_credentials') {
      window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
    }
    throw new ApiRequestError(res.status, err);
  }
  return data as T;
}

export const get = <T,>(path: string) => api<T>('GET', path);
export const post = <T,>(path: string, body?: unknown) => api<T>('POST', path, body);
export const patch = <T,>(path: string, body?: unknown) => api<T>('PATCH', path, body);
export const put = <T,>(path: string, body?: unknown) => api<T>('PUT', path, body);
export const del = <T,>(path: string) => api<T>('DELETE', path);

export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
