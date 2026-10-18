import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer } from './helpers.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });

const staff = async (email: string) => {
  const c = new Client(s.base);
  await c.login(email);
  return c;
};
const minutesAgo = (n: number) => new Date(Date.now() - n * 60000).toISOString();

test('paused dreamers are left out of participation and engagement on coach and director pages alike', async () => {
  const director = await staff('director@dreamcoach.demo');
  const rows = (await director.get('/director/dreamers')).body;
  const target = rows.find((r: any) => r.dreamer.status === 'active' && r.dreamer.coach);
  // Make sure the dreamer is engaged between sessions before pausing them.
  const dreamer = new Client(s.base);
  await dreamer.login(target.dreamer.email);
  assert.equal((await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'energy', value: 6 }] })).status, 201);
  const coachId = target.dreamer.coach.id;
  const coachRow = async () => (await director.get('/director/overview')).body.coaches.find((c: any) => c.coach.id === coachId);
  const engagedBefore = (await coachRow()).engagedBetweenSessions30d;

  assert.equal((await director.patch(`/director/dreamers/${target.dreamer.id}`, { status: 'paused' })).status, 200);
  const overview = (await director.get('/director/overview')).body;
  const row = overview.coaches.find((c: any) => c.coach.id === coachId);
  assert.equal(row.engagedBetweenSessions30d, engagedBefore - 1, 'a paused dreamer no longer counts as engaged');
  for (const c of overview.coaches) assert.ok(c.engagedBetweenSessions30d <= c.activeDreamers, `${c.coach.name}: engaged ${c.engagedBetweenSessions30d} of ${c.activeDreamers}`);
  assert.ok(overview.totals.engagedBetweenSessions30d <= overview.totals.activeDreamers);
  // The coach detail page tells the same story as the overview row.
  assert.deepEqual((await director.get(`/director/coaches/${coachId}`)).body.summary, row);

  // Each coach's own dashboard counts the same active dreamers the Director's figures use.
  const emails = (await director.get('/director/staff')).body.map((u: any) => u.email);
  for (const email of emails) {
    const c = await staff(email);
    const dash = (await c.get('/coach/dashboard')).body;
    const summary = overview.coaches.find((x: any) => x.coach.id === dash.coach.id);
    if (!summary) continue;
    assert.equal(dash.stats.dreamers, summary.dreamers);
    assert.equal(dash.stats.activeDreamers, summary.activeDreamers);
    assert.ok(dash.stats.dreamersSeenLast45d <= dash.stats.activeDreamers);
    const participation = dash.stats.activeDreamers ? Math.round((dash.stats.dreamersSeenLast45d / dash.stats.activeDreamers) * 100) : null;
    assert.equal(participation, summary.participation45d, `${email}: seen-in-45-days matches participation`);
  }
  await director.patch(`/director/dreamers/${target.dreamer.id}`, { status: 'active' });
});

test('engagement counts the dreamer’s own entries, not what a coach writes in a session', async () => {
  const director = await staff('director@dreamcoach.demo');
  const coach = await staff('maya@dreamcoach.demo');
  const caseload = (await coach.get('/coach/dashboard')).body.caseload;
  const quiet = caseload.find((c: any) => c.dreamer.status === 'active' && !c.snapshot.openSession) ?? caseload[0];
  const engaged = async () => (await director.get('/director/overview')).body.coaches.find((c: any) => c.coach.name === 'Maya Thompson').engagedBetweenSessions30d;
  const reflections = async () => (await coach.get(`/dreamers/${quiet.dreamer.id}/overview`)).body.snapshot.journalEntries30d;
  const before = { engaged: await engaged(), reflections: await reflections() };
  const sid = (await coach.post(`/dreamers/${quiet.dreamer.id}/sessions`, {})).body.id;
  const j = await coach.post(`/dreamers/${quiet.dreamer.id}/journal`, { body: 'Noted in the session together.', sessionId: sid });
  assert.equal(j.status, 201);
  assert.equal(await reflections(), before.reflections);
  assert.equal(await engaged(), before.engaged);
  await coach.del(`/dreamers/${quiet.dreamer.id}/journal/${j.body.id}`);
  await coach.del(`/dreamers/${quiet.dreamer.id}/sessions/${sid}`);
});

test('sessions are credited to whoever ran them; caseload outcomes follow the dreamer', async () => {
  const director = await staff('director@dreamcoach.demo');
  const overview = async () => (await director.get('/director/overview')).body;
  const byName = (o: any, name: string) => o.coaches.find((c: any) => c.coach.name === name);
  const rows = (await director.get('/director/dreamers')).body;
  const moved = rows.find((r: any) => r.dreamer.coach?.name === 'Maya Thompson' && r.sessionsCompleted > 0);
  const before = await overview();
  const maya = byName(before, 'Maya Thompson');
  const priya = byName(before, 'Priya Raman');

  // Reassigning a dreamer moves them (and their outcomes) to the new caseload, not the sessions Maya ran.
  assert.equal((await director.patch(`/director/dreamers/${moved.dreamer.id}`, { coachUserId: priya.coach.id })).status, 200);
  const afterMove = await overview();
  assert.equal(byName(afterMove, 'Maya Thompson').sessionsTotal, maya.sessionsTotal);
  assert.equal(byName(afterMove, 'Maya Thompson').sessionsLast30d, maya.sessionsLast30d);
  assert.equal(byName(afterMove, 'Priya Raman').sessionsTotal, priya.sessionsTotal);
  assert.equal(byName(afterMove, 'Maya Thompson').dreamers, maya.dreamers - 1);
  assert.equal(byName(afterMove, 'Priya Raman').dreamers, priya.dreamers + 1);
  const priyaDetail = (await director.get(`/director/coaches/${priya.coach.id}`)).body;
  assert.ok(priyaDetail.caseload.some((c: any) => c.dreamer.id === moved.dreamer.id), 'the dreamer is in the new caseload');
  assert.equal(priyaDetail.months.reduce((n: number, m: any) => n + m.sessions, 0), priyaDetail.summary.sessionsTotal, 'the month trend counts the same sessions');
  const priyaDash = (await (await staff('priya@dreamcoach.demo')).get('/coach/dashboard')).body;
  assert.equal(priyaDash.stats.sessionsLast30d, priya.sessionsLast30d);
  await director.patch(`/director/dreamers/${moved.dreamer.id}`, { coachUserId: maya.coach.id });

  // A session the Director runs for another coach's dreamer is the Director's activity.
  const other = rows.find((r: any) => r.dreamer.coach?.name === 'Daniel Okafor');
  const daniel = byName(before, 'Daniel Okafor');
  const myRow = (o: any) => o.coaches.find((c: any) => c.coach.role === 'director');
  const myDashBefore = (await director.get('/coach/dashboard')).body.stats;
  const sid = (await director.post(`/dreamers/${other.dreamer.id}/sessions`, { occurredAt: minutesAgo(30) })).body.id;
  await director.put(`/dreamers/${other.dreamer.id}/sessions/${sid}/ratings`, { category: 'energy', value: 7 });
  await director.patch(`/dreamers/${other.dreamer.id}/sessions/${sid}`, { status: 'completed' });
  const afterRun = await overview();
  assert.equal(byName(afterRun, 'Daniel Okafor').sessionsTotal, daniel.sessionsTotal);
  assert.equal(byName(afterRun, 'Daniel Okafor').sessionsLast30d, daniel.sessionsLast30d);
  assert.equal(myRow(afterRun).sessionsTotal, (myRow(before)?.sessionsTotal ?? 0) + 1);
  assert.equal(afterRun.totals.sessionsTotal, before.totals.sessionsTotal + 1);
  assert.equal(afterRun.coaches.reduce((n: number, c: any) => n + c.sessionsTotal, 0), afterRun.totals.sessionsTotal, 'every session is credited to exactly one row');
  const myDashAfter = (await director.get('/coach/dashboard')).body.stats;
  assert.equal(myDashAfter.sessionsLast30d, myDashBefore.sessionsLast30d + 1);
  const danielDash = (await (await staff('daniel@dreamcoach.demo')).get('/coach/dashboard')).body.stats;
  assert.equal(danielDash.sessionsLast30d, daniel.sessionsLast30d);
});

test('last self check-in is the newest check-in; last self activity says when a reflection is newer', async () => {
  const coach = await staff('daniel@dreamcoach.demo');
  const dreamer = new Client(s.base);
  const auth = await dreamer.login('hana@dreamcoach.demo');
  const id = auth.dreamerId;
  const snap = async () => (await coach.get(`/dreamers/${id}/overview`)).body.snapshot;
  const entry = async () => (await coach.get('/coach/dashboard')).body.caseload.find((c: any) => c.dreamer.id === id);

  const ci = await dreamer.post('/dreamers/me/check-ins', { occurredAt: minutesAgo(3), ratings: [{ category: 'relationships', value: 7 }] });
  assert.equal(ci.status, 201);
  let now = await snap();
  assert.equal(now.lastSelfCheckIn, ci.body.occurredAt);
  assert.deepEqual(now.lastSelfActivity, { at: ci.body.occurredAt, kind: 'check-in' });
  assert.equal((await coach.get(`/dreamers/${id}/check-ins`)).body[0].occurredAt, now.lastSelfCheckIn);

  // A newer journal reflection is self activity, but not a check-in.
  const j = await dreamer.post('/dreamers/me/journal', { body: 'Walked home the long way and thought it through.', occurredAt: minutesAgo(2) });
  assert.equal(j.status, 201);
  now = await snap();
  assert.equal(now.lastSelfCheckIn, ci.body.occurredAt);
  assert.deepEqual(now.lastSelfActivity, { at: j.body.occurredAt, kind: 'reflection' });
  const e = await entry();
  assert.equal(e.lastActivityKind, 'self');
  assert.equal(e.lastActivityAt, j.body.occurredAt);

  // Private entries move nothing staff can see.
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const pj = await dreamer.post('/dreamers/me/journal', { body: 'Just for me.', isPrivate: true, occurredAt: minutesAgo(1) });
  await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'energy', value: 3, isPrivate: true }] });
  assert.deepEqual(await snap(), now);
  const mine = (await dreamer.get('/dreamers/me/overview')).body.snapshot;
  assert.ok(mine.lastSelfCheckIn > now.lastSelfCheckIn, 'the owner sees their private check-in');
  assert.equal(mine.lastSelfActivity.kind, 'check-in');
  await dreamer.del(`/dreamers/me/journal/${pj.body.id}`);
});
