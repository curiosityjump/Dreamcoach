import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, allStrings, uniqueMarker, type TestServer } from './helpers.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });

async function dreamerAndCoach() {
  const dreamer = new Client(s.base);
  const auth = await dreamer.login('alicia@dreamcoach.demo');
  const coach = new Client(s.base);
  await coach.login('maya@dreamcoach.demo');
  const director = new Client(s.base);
  await director.login('director@dreamcoach.demo');
  return { dreamer, coach, director, dreamerId: auth.dreamerId as number };
}

test('show private requires the real password; hide is instant; re-login starts hidden', async () => {
  const { dreamer } = await dreamerAndCoach();
  assert.equal((await dreamer.post('/auth/privacy/unlock', { password: 'wrong' })).status, 401);
  const ok = await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.privateUnlocked, true);
  assert.ok(ok.body.privateUnlockedUntil);
  const lock = await dreamer.post('/auth/privacy/lock');
  assert.equal(lock.body.privateUnlocked, false);
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  await dreamer.post('/auth/logout');
  const again = await dreamer.login('alicia@dreamcoach.demo');
  assert.equal(again.privateUnlocked, false, 'a fresh login never inherits an unlock');
});

test('unlock times out server-side', async () => {
  const dreamer = new Client(s.base);
  await dreamer.login('grace@dreamcoach.demo');
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  // Simulate 31 idle minutes.
  s.db.prepare(`UPDATE auth_sessions SET private_unlocked_until = ? WHERE user_id = (SELECT id FROM users WHERE email = 'grace@dreamcoach.demo')`).run(new Date(Date.now() - 1000).toISOString());
  const me = await dreamer.get('/auth/me');
  assert.equal(me.body.privateUnlocked, false);
});

test('staff cannot unlock private entries', async () => {
  const coach = new Client(s.base);
  await coach.login('maya@dreamcoach.demo');
  assert.equal((await coach.post('/auth/privacy/unlock', { password: 'dream2026' })).status, 403);
});

test('private entries are absent from coach and director views, and do not move coach-visible numbers', async () => {
  const { dreamer, coach, director, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });

  // Baselines as the coach sees them.
  const beforeCoachOverview = await coach.get(`/dreamers/${dreamerId}/overview`);
  const beforeCoachEnergy = await coach.get(`/dreamers/${dreamerId}/care/energy`);
  const beforeCoachActions = await coach.get(`/dreamers/${dreamerId}/actions`);
  const beforeCoachJournal = await coach.get(`/dreamers/${dreamerId}/journal`);
  const beforeCoachCheckIns = await coach.get(`/dreamers/${dreamerId}/check-ins`);
  const beforeCoachTimeline = await coach.get(`/dreamers/${dreamerId}/timeline`);
  const beforeDirector = await director.get('/director/overview');
  const beforeDirectorRows = await director.get('/director/dreamers');
  const beforeCoachDash = await coach.get('/coach/dashboard');

  const privNote = uniqueMarker();
  const privReflection = uniqueMarker();
  const privAction = uniqueMarker();
  const privJournal = uniqueMarker();
  const sharedNoteOnPrivateRating = uniqueMarker();

  // 1) A fully private Energy rating (value 1 — far from anything shared) with a note.
  // 2) A shared Alignment rating with a PRIVATE note.
  // 3) A private reflection.
  const ci = await dreamer.post('/dreamers/me/check-ins', {
    ratings: [
      { category: 'energy', value: 1, isPrivate: true, note: sharedNoteOnPrivateRating, notePrivate: false },
      { category: 'alignment', value: 9, isPrivate: false, note: privNote, notePrivate: true },
    ],
    progress: [{ dreamId: beforeCoachOverview.body.snapshot.dreams[3].id, value: 99, isPrivate: true, note: 'private progress', notePrivate: false }],
    reflection: { body: privReflection, isPrivate: true },
  });
  assert.equal(ci.status, 201, JSON.stringify(ci.body));
  const a = await dreamer.post('/dreamers/me/actions', { title: privAction, isPrivate: true });
  assert.equal(a.status, 201);
  const j = await dreamer.post('/dreamers/me/journal', { body: privJournal, isPrivate: true });
  assert.equal(j.status, 201);

  // The dreamer (unlocked) sees everything.
  const mine = await dreamer.get('/dreamers/me/care/energy');
  assert.ok(mine.body.entries.some((e: any) => e.value === 1 && e.isPrivate && e.note?.body === sharedNoteOnPrivateRating));
  const myAlign = await dreamer.get('/dreamers/me/care/alignment');
  const shared = myAlign.body.entries.find((e: any) => e.note?.body === privNote);
  assert.ok(shared && !shared.isPrivate && shared.note.isPrivate, 'shared rating with private note is intact for the owner');

  // Coach: no trace, by every route.
  const coachResponses = [
    await coach.get(`/dreamers/${dreamerId}/overview`),
    await coach.get(`/dreamers/${dreamerId}/care/energy`),
    await coach.get(`/dreamers/${dreamerId}/care/alignment`),
    await coach.get(`/dreamers/${dreamerId}/ratings`),
    await coach.get(`/dreamers/${dreamerId}/actions`),
    await coach.get(`/dreamers/${dreamerId}/journal`),
    await coach.get(`/dreamers/${dreamerId}/check-ins`),
    await coach.get(`/dreamers/${dreamerId}/timeline`),
    await coach.get(`/dreamers/${dreamerId}/dreams`),
    await coach.get(`/dreamers/${dreamerId}/progress`),
    await coach.get(`/dreamers/${dreamerId}/grid`),
    await coach.get(`/dreamers/${dreamerId}/sessions`),
    await coach.get('/coach/dashboard'),
    await director.get(`/dreamers/${dreamerId}/overview`),
    await director.get('/director/overview'),
    await director.get('/director/dreamers'),
  ];
  const text = coachResponses.flatMap((r) => allStrings(r.body)).join('\n');
  for (const m of [privNote, privReflection, privAction, privJournal, sharedNoteOnPrivateRating]) assert.ok(!text.includes(m), `leaked ${m}`);
  for (const r of coachResponses) assert.ok(!JSON.stringify(r.body).includes('"isPrivate":true'), 'isPrivate is never true for staff');

  // The shared Alignment rating IS visible to the coach, but its note is not — and nothing hints at it.
  const coachAlign = await coach.get(`/dreamers/${dreamerId}/care/alignment`);
  const visible = coachAlign.body.entries.find((e: any) => e.id === shared.id);
  assert.ok(visible, 'shared rating visible to coach');
  assert.equal(visible.note, null, 'private note attached to a shared rating is absent');
  assert.equal(Object.prototype.hasOwnProperty.call(visible, 'note'), true);

  // Coach-visible current values and counts did not move.
  const afterCoachOverview = await coach.get(`/dreamers/${dreamerId}/overview`);
  assert.deepEqual(afterCoachOverview.body.snapshot.latest.energy, beforeCoachOverview.body.snapshot.latest.energy, 'private energy rating does not change the coach-visible current Energy');
  assert.equal(afterCoachOverview.body.snapshot.activeActions, beforeCoachOverview.body.snapshot.activeActions);
  assert.equal(afterCoachOverview.body.snapshot.journalEntries30d, beforeCoachOverview.body.snapshot.journalEntries30d);
  assert.deepEqual(afterCoachOverview.body.snapshot.dreams.map((d: any) => d.progress), beforeCoachOverview.body.snapshot.dreams.map((d: any) => d.progress), 'private progress update does not change coach-visible dream progress');
  const afterCoachEnergy = await coach.get(`/dreamers/${dreamerId}/care/energy`);
  assert.equal(afterCoachEnergy.body.entries.length, beforeCoachEnergy.body.entries.length);
  assert.equal((await coach.get(`/dreamers/${dreamerId}/actions`)).body.length, beforeCoachActions.body.length);
  assert.equal((await coach.get(`/dreamers/${dreamerId}/journal`)).body.length, beforeCoachJournal.body.length);
  // The check-in itself exists for the coach only because it has a shared rating; its count went up by exactly one.
  const afterCoachCheckIns = await coach.get(`/dreamers/${dreamerId}/check-ins`);
  assert.equal(afterCoachCheckIns.body.length, beforeCoachCheckIns.body.length + 1);
  assert.equal(afterCoachCheckIns.body[0].ratings.length, 1);
  assert.equal(afterCoachCheckIns.body[0].progress.length, 0);
  assert.equal(afterCoachCheckIns.body[0].reflection, null);
  // Timeline grew by exactly the one shared rating.
  const afterCoachTimeline = await coach.get(`/dreamers/${dreamerId}/timeline`);
  assert.equal(afterCoachTimeline.body.length, beforeCoachTimeline.body.length + 1);

  // Director aggregates: identical except for the one shared alignment rating (which legitimately counts).
  const afterDirector = await director.get('/director/overview');
  const strip = (o: any) => { const t = { ...o.totals }; delete t.careLatest; return t; };
  assert.deepEqual(strip(afterDirector.body), strip(beforeDirector.body));
  assert.deepEqual(afterDirector.body.coaches.map((c: any) => ({ ...c, avgCommitment: 0 })), beforeDirector.body.coaches.map((c: any) => ({ ...c, avgCommitment: 0 })));
  const afterRows = await director.get('/director/dreamers');
  const rowBefore = beforeDirectorRows.body.find((r: any) => r.dreamer.id === dreamerId);
  const rowAfter = afterRows.body.find((r: any) => r.dreamer.id === dreamerId);
  assert.equal(rowAfter.snapshot.activeActions, rowBefore.snapshot.activeActions);
  assert.equal(rowAfter.dreamAverage, rowBefore.dreamAverage);
  assert.equal(rowAfter.snapshot.selfCheckIns30d, rowBefore.snapshot.selfCheckIns30d + 1);
  const dashAfter = await coach.get('/coach/dashboard');
  assert.equal(dashAfter.body.stats.selfCheckInsLast30d, beforeCoachDash.body.stats.selfCheckInsLast30d + 1);
});

test('a check-in whose every entry is private does not exist for staff', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const before = await coach.get(`/dreamers/${dreamerId}/check-ins`);
  const beforeSnap = await coach.get(`/dreamers/${dreamerId}/overview`);
  const marker = uniqueMarker();
  const ci = await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'relationships', value: 2, isPrivate: true }], reflection: { body: marker, isPrivate: true } });
  assert.equal(ci.status, 201);
  const after = await coach.get(`/dreamers/${dreamerId}/check-ins`);
  assert.equal(after.body.length, before.body.length);
  const afterSnap = await coach.get(`/dreamers/${dreamerId}/overview`);
  assert.equal(afterSnap.body.snapshot.selfCheckIns30d, beforeSnap.body.snapshot.selfCheckIns30d);
  assert.equal(afterSnap.body.snapshot.lastSelfCheckIn, beforeSnap.body.snapshot.lastSelfCheckIn, 'last self activity does not move for a private-only check-in');
  assert.ok(!allStrings(after.body).join().includes(marker));
});

test('hide private: the dreamer sees exactly what the coach sees', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/lock');
  const paths = [`/care/energy`, `/actions`, `/journal`, `/check-ins`, `/timeline`, `/dreams`, `/sessions`];
  for (const p of paths) {
    const mine = await dreamer.get(`/dreamers/me${p}`);
    const theirs = await coach.get(`/dreamers/${dreamerId}${p}`);
    assert.deepEqual(mine.body, theirs.body, `hidden-mode view differs from coach view for ${p}`);
  }
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const unlocked = await dreamer.get('/dreamers/me/journal');
  const hidden = await coach.get(`/dreamers/${dreamerId}/journal`);
  assert.ok(unlocked.body.length > hidden.body.length, 'the seed includes private journal entries for Alicia');
  assert.ok(unlocked.body.some((j: any) => j.isPrivate));
});

test('staff cannot create private entries or write journal entries outside a session', async () => {
  const { coach, dreamerId } = await dreamerAndCoach();
  assert.equal((await coach.post(`/dreamers/${dreamerId}/actions`, { title: 'x', isPrivate: true })).status, 403);
  assert.equal((await coach.post(`/dreamers/${dreamerId}/journal`, { body: 'x' })).status, 403);
  assert.equal((await coach.post(`/dreamers/${dreamerId}/check-ins`, { ratings: [{ category: 'energy', value: 5 }] })).status, 403);
  const actions = await coach.get(`/dreamers/${dreamerId}/actions`);
  assert.equal((await coach.patch(`/dreamers/${dreamerId}/actions/${actions.body[0].id}`, { isPrivate: true })).status, 403);
});

test('making a session-recorded rating private removes it from the coach grid', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const grid = await coach.get(`/dreamers/${dreamerId}/grid`);
  const session = grid.body.sessions.find((s: any) => s.status === 'completed');
  const ratings = await dreamer.get('/dreamers/me/ratings?category=contribution');
  const target = ratings.body.find((r: any) => r.sessionId === session.id);
  assert.ok(target);
  const upd = await dreamer.patch(`/dreamers/me/ratings/${target.id}`, { isPrivate: true });
  assert.equal(upd.status, 200);
  const after = await coach.get(`/dreamers/${dreamerId}/grid`);
  const col = after.body.sessions.find((s: any) => s.id === session.id);
  assert.equal(col.ratings.contribution, undefined);
  assert.ok(!JSON.stringify(col).includes('private'));
  // Undo so other tests see a full grid.
  await dreamer.patch(`/dreamers/me/ratings/${target.id}`, { isPrivate: false });
});

test('dreamer in hidden mode cannot read or edit own private rows by id', async () => {
  const { dreamer } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const marker = uniqueMarker();
  const j = await dreamer.post('/dreamers/me/journal', { body: marker, isPrivate: true });
  await dreamer.post('/auth/privacy/lock');
  assert.equal((await dreamer.patch(`/dreamers/me/journal/${j.body.id}`, { body: 'changed' })).status, 404);
  assert.equal((await dreamer.del(`/dreamers/me/journal/${j.body.id}`)).status, 404);
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  assert.equal((await dreamer.del(`/dreamers/me/journal/${j.body.id}`)).status, 200);
});
