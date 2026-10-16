import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer } from './helpers.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });

test('a coach runs a full session and the dreamer sees it; values upsert, not duplicate', async () => {
  const coach = new Client(s.base);
  await coach.login('daniel@dreamcoach.demo');
  const dash = await coach.get('/coach/dashboard');
  const entry = dash.body.caseload.find((c: any) => c.dreamer.name === 'Hana Sato');
  const id = entry.dreamer.id;
  const beforeSessions = (await coach.get(`/dreamers/${id}/sessions`)).body.length;

  const start = await coach.post(`/dreamers/${id}/sessions`, {});
  assert.equal(start.status, 201);
  const sid = start.body.id;
  assert.equal(start.body.status, 'in_progress');
  assert.equal(start.body.number, beforeSessions + 1);
  // Starting again returns the same open session.
  assert.equal((await coach.post(`/dreamers/${id}/sessions`, {})).body.id, sid);

  for (const [cat, v] of [['contribution', 7], ['alignment', 6], ['relationships', 8], ['energy', 5], ['commitment', 9], ['satisfaction', 8]] as const) {
    const r = await coach.put(`/dreamers/${id}/sessions/${sid}/ratings`, { category: cat, value: v });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  // Correct a value: upsert.
  await coach.put(`/dreamers/${id}/sessions/${sid}/ratings`, { category: 'energy', value: 6 });
  const dreams = (await coach.get(`/dreamers/${id}/dreams`)).body;
  for (const d of dreams) await coach.put(`/dreamers/${id}/sessions/${sid}/progress`, { dreamId: d.id, value: Math.min(100, (d.progress ?? 0) + 5) });
  const act = await coach.post(`/dreamers/${id}/actions`, { title: 'Call the Y about swim times', dreamId: dreams[1].id, sessionId: sid });
  assert.equal(act.status, 201);
  const notes = await coach.patch(`/dreamers/${id}/sessions/${sid}`, { notes: 'Great energy today.\nAgreed to protect Sunday mornings.', focus: 'Energy — protect sleep' });
  assert.equal(notes.status, 200);
  const done = await coach.patch(`/dreamers/${id}/sessions/${sid}`, { status: 'completed' });
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.ratings.energy, 6);
  assert.equal(Object.keys(done.body.ratings).length, 6);
  assert.equal(Object.keys(done.body.progress).length, 4);
  assert.equal(done.body.actionsCreated, 1);

  const energyRows = s.db.prepare(`SELECT COUNT(*) AS n FROM ratings WHERE session_id = ? AND category = 'energy'`).get(sid) as { n: number };
  assert.equal(energyRows.n, 1, 'upsert produced one row');

  // Dreamer sees it.
  const dreamer = new Client(s.base);
  await dreamer.login('hana@dreamcoach.demo');
  const ov = await dreamer.get('/dreamers/me/overview');
  assert.equal(ov.body.snapshot.latest.energy.value, 6);
  assert.equal(ov.body.snapshot.latest.energy.source, 'session');
  assert.equal(ov.body.snapshot.lastSession.id, sid);
  const hist = await dreamer.get('/dreamers/me/care/energy');
  const last = hist.body.entries[hist.body.entries.length - 1];
  assert.equal(last.sessionId, sid);
  assert.equal(last.recordedBy.name, 'Daniel Okafor');
  const sessions = await dreamer.get('/dreamers/me/sessions');
  assert.ok(sessions.body.find((x: any) => x.id === sid).notes.includes('Sunday mornings'));
  const actions = await dreamer.get('/dreamers/me/actions?status=active');
  const mine = actions.body.find((a: any) => a.title === 'Call the Y about swim times');
  assert.ok(mine && mine.sessionId === sid && mine.createdBy.role === 'coach');

  // Dreamer completes the action; coach sees it reflected.
  const complete = await dreamer.patch(`/dreamers/me/actions/${mine.id}`, { status: 'completed' });
  assert.equal(complete.body.status, 'completed');
  assert.ok(complete.body.completedAt);
  const coachView = await coach.get(`/dreamers/${id}/actions?status=completed`);
  assert.ok(coachView.body.some((a: any) => a.id === mine.id));

  // Dreamer cannot edit session metadata or record session ratings.
  assert.equal((await dreamer.patch(`/dreamers/me/sessions/${sid}`, { notes: 'hacked' })).status, 403);
  assert.equal((await dreamer.put(`/dreamers/me/sessions/${sid}/ratings`, { category: 'energy', value: 10 })).status, 403);
  assert.equal((await dreamer.post(`/dreamers/me/sessions`, {})).status, 403);
});

test('an empty in-progress session can be deleted; a completed one cannot', async () => {
  const coach = new Client(s.base);
  await coach.login('priya@dreamcoach.demo');
  const dash = await coach.get('/coach/dashboard');
  const id = dash.body.caseload[0].dreamer.id;
  const started = await coach.post(`/dreamers/${id}/sessions`, {});
  assert.equal((await coach.del(`/dreamers/${id}/sessions/${started.body.id}`)).status, 200);
  const sessions = await coach.get(`/dreamers/${id}/sessions`);
  const completed = sessions.body.find((x: any) => x.status === 'completed');
  assert.equal((await coach.del(`/dreamers/${id}/sessions/${completed.id}`)).status, 400);
});

test('director can run a session for any dreamer; coach cannot for another caseload', async () => {
  const director = new Client(s.base);
  await director.login('director@dreamcoach.demo');
  const rows = await director.get('/director/dreamers');
  const someone = rows.body.find((r: any) => r.dreamer.coach?.name === 'Maya Thompson');
  const st = await director.post(`/dreamers/${someone.dreamer.id}/sessions`, {});
  assert.equal(st.status, 201);
  assert.equal((await director.del(`/dreamers/${someone.dreamer.id}/sessions/${st.body.id}`)).status, 200);
  const coach = new Client(s.base);
  await coach.login('priya@dreamcoach.demo');
  assert.equal((await coach.post(`/dreamers/${someone.dreamer.id}/sessions`, {})).status, 404);
});

test('dream progress reaching 100% marks the dream achieved, based on shared entries', async () => {
  const dreamer = new Client(s.base);
  await dreamer.login('theo@dreamcoach.demo');
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const dreams = (await dreamer.get('/dreamers/me/dreams')).body;
  const d = dreams[0];
  // A private 100% does not mark it achieved for anyone.
  await dreamer.post('/dreamers/me/check-ins', { progress: [{ dreamId: d.id, value: 100, isPrivate: true }] });
  let after = (await dreamer.get('/dreamers/me/dreams')).body.find((x: any) => x.id === d.id);
  assert.equal(after.achievedAt, null);
  assert.equal(after.progress, 100, 'the owner still sees their private 100%');
  await dreamer.post('/dreamers/me/check-ins', { progress: [{ dreamId: d.id, value: 100 }] });
  after = (await dreamer.get('/dreamers/me/dreams')).body.find((x: any) => x.id === d.id);
  assert.ok(after.achievedAt);
});

test('validation: out-of-range and malformed input is rejected cleanly', async () => {
  const dreamer = new Client(s.base);
  await dreamer.login('owen@dreamcoach.demo');
  assert.equal((await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'energy', value: 11 }] })).status, 400);
  assert.equal((await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'vibes', value: 5 }] })).status, 400);
  assert.equal((await dreamer.post('/dreamers/me/check-ins', {})).status, 400);
  assert.equal((await dreamer.post('/dreamers/me/actions', { title: '   ' })).status, 400);
  assert.equal((await dreamer.post('/dreamers/me/journal', { body: '' })).status, 400);
  const res = await fetch(`${s.base}/api/dreamers/me/journal`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: dreamer.cookie }, body: '{bad json' });
  assert.equal(res.status, 400);
});
