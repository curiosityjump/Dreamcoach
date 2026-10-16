import type { AddressInfo } from 'node:net';
import { openDatabase, type DB } from '../../server/db.ts';
import { createApp } from '../../server/app.ts';
import { resetAndSeed, DEMO_PASSWORD } from '../../server/seed.ts';

export interface TestServer { db: DB; base: string; close: () => Promise<void> }

export async function startServer(): Promise<TestServer> {
  const db = openDatabase(':memory:');
  resetAndSeed(db);
  const app = createApp(db, { staticDir: '/nonexistent' });
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    db,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}

export class Client {
  cookie = '';
  constructor(public base: string) {}
  async call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(this.base + '/api' + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0]!;
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }
  get<T = any>(p: string) { return this.call<T>('GET', p); }
  post<T = any>(p: string, b?: unknown) { return this.call<T>('POST', p, b); }
  patch<T = any>(p: string, b?: unknown) { return this.call<T>('PATCH', p, b); }
  put<T = any>(p: string, b?: unknown) { return this.call<T>('PUT', p, b); }
  del<T = any>(p: string) { return this.call<T>('DELETE', p); }
  async login(email: string, password = DEMO_PASSWORD) {
    const r = await this.post('/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export async function loginAs(base: string, email: string) {
  const c = new Client(base);
  const auth = await c.login(email);
  return { c, auth };
}

/** Deep-walk any JSON value and collect every string, to assert a secret never appears. */
export function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

export const uniqueMarker = () => `MARKER-${Math.random().toString(36).slice(2, 10)}`;
