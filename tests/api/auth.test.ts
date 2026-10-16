import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer } from './helpers.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });

test('unauthenticated requests are rejected', async () => {
  const c = new Client(s.base);
  assert.equal((await c.get('/auth/me')).status, 401);
  assert.equal((await c.get('/dreamers/me/overview')).status, 401);
  assert.equal((await c.get('/coach/dashboard')).status, 401);
  assert.equal((await c.get('/director/overview')).status, 401);
});

test('login with wrong password fails and locks after repeated failures', async () => {
  const c = new Client(s.base);
  for (let i = 0; i < 5; i++) {
    const r = await c.post('/auth/login', { email: 'tamsin@dreamcoach.demo', password: 'nope' });
    assert.equal(r.status, 401);
  }
  const locked = await c.post('/auth/login', { email: 'tamsin@dreamcoach.demo', password: 'dream2026' });
  assert.equal(locked.status, 429, 'correct password is refused while locked out');
});

test('login succeeds, starts with private hidden, logout invalidates the session', async () => {
  const c = new Client(s.base);
  const a = await c.login('alicia@dreamcoach.demo');
  assert.equal(a.user.role, 'dreamer');
  assert.equal(a.privateUnlocked, false);
  assert.ok(a.dreamerId);
  const me = await c.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal((await c.post('/auth/logout')).status, 200);
  assert.equal((await c.get('/auth/me')).status, 401);
});

test('demo-accounts never exposes password hashes', async () => {
  const c = new Client(s.base);
  const r = await c.get('/auth/demo-accounts');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body) && r.body.length >= 15);
  assert.ok(!JSON.stringify(r.body).includes('scrypt$'));
});

test('role boundaries: dreamer cannot reach staff endpoints or other dreamers', async () => {
  const c = new Client(s.base);
  await c.login('alicia@dreamcoach.demo');
  assert.equal((await c.get('/coach/dashboard')).status, 403);
  assert.equal((await c.get('/director/overview')).status, 403);
  const me = await c.get('/dreamers/me/overview');
  const other = me.body.dreamer.id === 1 ? 2 : 1;
  assert.equal((await c.get(`/dreamers/${other}/overview`)).status, 404);
  assert.equal((await c.get(`/dreamers/me/overview`)).status, 200);
  assert.equal((await c.get(`/dreamers/${me.body.dreamer.id}/overview`)).status, 200, 'own numeric id works too');
});

test('role boundaries: coach only sees own caseload; director sees all', async () => {
  const coach = new Client(s.base);
  await coach.login('priya@dreamcoach.demo');
  const dash = await coach.get('/coach/dashboard');
  assert.equal(dash.status, 200);
  const mine = new Set(dash.body.caseload.map((c: any) => c.dreamer.id));
  assert.equal(mine.size, 2);
  const director = new Client(s.base);
  await director.login('director@dreamcoach.demo');
  const all = await director.get('/director/dreamers');
  assert.equal(all.body.length, 11);
  const notMine = all.body.map((r: any) => r.dreamer.id).find((id: number) => !mine.has(id));
  assert.equal((await coach.get(`/dreamers/${notMine}/overview`)).status, 404, 'other caseloads look non-existent to a coach');
  assert.equal((await coach.get('/director/overview')).status, 403);
  assert.equal((await director.get(`/dreamers/${notMine}/overview`)).status, 200);
  assert.equal((await director.get('/director/overview')).status, 200);
});
