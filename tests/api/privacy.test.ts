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

test('background requests never keep private entries showing; real activity slides the unlock', async () => {
  const dreamer = new Client(s.base);
  await dreamer.login('grace@dreamcoach.demo');
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const until = () => (s.db.prepare(`SELECT private_unlocked_until AS u FROM auth_sessions WHERE token = ?`).get(dreamer.cookie.split('=')[1]) as { u: string | null }).u;
  const me = (idleMs: number) => fetch(`${s.base}/api/auth/me`, { headers: { cookie: dreamer.cookie, 'x-dc-idle': String(idleMs) } }).then((r) => r.json() as Promise<any>);
  // Two minutes left on the unlock.
  const twoMin = new Date(Date.now() + 2 * 60_000).toISOString();
  s.db.prepare(`UPDATE auth_sessions SET private_unlocked_until = ? WHERE token = ?`).run(twoMin, dreamer.cookie.split('=')[1]);
  // A poll from a page nobody has touched for 29 minutes does not extend it…
  assert.equal((await me(29 * 60_000)).privateUnlocked, true);
  assert.equal(until(), twoMin);
  // …but a request made right after an interaction does.
  await me(0);
  assert.ok(Date.parse(until()!) > Date.now() + 29 * 60_000);
  // The browser's check a minute before the window closes, after someone kept reading or typing without a
  // request going out, slides it from their last interaction (here four minutes ago).
  s.db.prepare(`UPDATE auth_sessions SET private_unlocked_until = ? WHERE token = ?`).run(new Date(Date.now() + 60_000).toISOString(), dreamer.cookie.split('=')[1]);
  assert.equal((await me(4 * 60_000)).privateUnlocked, true);
  const slid = Date.parse(until()!) - Date.now();
  assert.ok(slid > 25 * 60_000 && slid <= 26 * 60_000, `slid to ${Math.round(slid / 1000)}s from now`);
  await dreamer.post('/auth/privacy/lock');
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
  assert.equal(afterSnap.body.snapshot.lastSelfCheckIn, beforeSnap.body.snapshot.lastSelfCheckIn, 'last self check-in does not move for a private-only check-in');
  assert.deepEqual(afterSnap.body.snapshot.lastSelfActivity, beforeSnap.body.snapshot.lastSelfActivity, 'last self activity does not move either');
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

test('a coach re-entering a cell the dreamer privatised neither reveals, overwrites nor deletes the private row', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const grid = await coach.get(`/dreamers/${dreamerId}/grid`);
  const session = grid.body.sessions.filter((s: any) => s.status === 'completed').slice(-1)[0];
  const ratings = await dreamer.get('/dreamers/me/ratings?category=relationships');
  const target = ratings.body.find((r: any) => r.sessionId === session.id);
  const originalValue = target.value;
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${target.id}`, { isPrivate: true })).status, 200);
  // Coach sees an empty cell and types a value: it appears as a shared value (no inference channel).
  const put = await coach.put(`/dreamers/${dreamerId}/sessions/${session.id}/ratings`, { category: 'relationships', value: 2 });
  assert.equal(put.status, 200);
  assert.equal(put.body.ratings.relationships, 2, 'the coach sees the value they typed, exactly as for a never-recorded cell');
  // The private row is untouched.
  let mine = (await dreamer.get(`/dreamers/me/ratings?category=relationships`)).body.filter((r: any) => r.sessionId === session.id);
  const priv = mine.find((r: any) => r.id === target.id);
  assert.ok(priv && priv.isPrivate && priv.value === originalValue, 'private row keeps its value and privacy');
  assert.equal(mine.length, 2, 'the owner sees both their private value and the coach’s shared one');
  const mySession = (await dreamer.get(`/dreamers/me/sessions/${session.id}`)).body;
  assert.ok(mySession.privateRatings.includes('relationships') === false, 'shared row wins in the grid; privateRatings lists only cells whose shown value is private');
  // Coach clears the cell: only the shared row goes.
  const clear = await coach.put(`/dreamers/${dreamerId}/sessions/${session.id}/ratings`, { category: 'relationships', value: null });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.ratings.relationships, undefined);
  mine = (await dreamer.get(`/dreamers/me/ratings?category=relationships`)).body.filter((r: any) => r.sessionId === session.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, target.id);
  const after = (await dreamer.get(`/dreamers/me/sessions/${session.id}`)).body;
  assert.ok(after.privateRatings.includes('relationships'), 'owner is told the shown value is private');
  assert.equal(after.ratings.relationships, originalValue);
  // Staff never receive the marker fields at all.
  const coachSession = (await coach.get(`/dreamers/${dreamerId}/sessions/${session.id}`)).body;
  assert.equal(coachSession.privateRatings, undefined);
  assert.equal(coachSession.privateProgress, undefined);
  assert.ok(!JSON.stringify(coachSession).includes('private'));
  // Restore.
  await dreamer.patch(`/dreamers/me/ratings/${target.id}`, { isPrivate: false });
});

test('deleting a session never destroys private rows, and non-empty sessions cannot be deleted', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const started = await coach.post(`/dreamers/${dreamerId}/sessions`, {});
  const sid = started.body.id;
  await coach.put(`/dreamers/${dreamerId}/sessions/${sid}/ratings`, { category: 'energy', value: 4 });
  assert.equal((await coach.del(`/dreamers/${dreamerId}/sessions/${sid}`)).status, 400, 'a session with entries cannot be deleted');
  // The dreamer privatises the only entry; to the coach the session now looks empty.
  const row = (await dreamer.get('/dreamers/me/ratings?category=energy')).body.find((r: any) => r.sessionId === sid);
  await dreamer.patch(`/dreamers/me/ratings/${row.id}`, { isPrivate: true });
  const del = await coach.del(`/dreamers/${dreamerId}/sessions/${sid}`);
  assert.equal(del.status, 200);
  const kept = (await dreamer.get('/dreamers/me/ratings?category=energy')).body.find((r: any) => r.id === row.id);
  assert.ok(kept, 'the private entry survives the session deletion');
  assert.equal(kept.sessionId, null);
  assert.equal(kept.isPrivate, true);
  await dreamer.del(`/dreamers/me/ratings/${row.id}`).catch(() => {});
});

test('journal entries cannot be attached to another dreamer’s session', async () => {
  const { coach, dreamerId, director } = await dreamerAndCoach();
  const others = await director.get('/director/dreamers');
  const other = others.body.find((r: any) => r.dreamer.id !== dreamerId);
  const otherSessions = await director.get(`/dreamers/${other.dreamer.id}/sessions`);
  const started = await coach.post(`/dreamers/${dreamerId}/sessions`, {});
  const bad = await coach.post(`/dreamers/${dreamerId}/journal`, { body: 'x', sessionId: otherSessions.body[0].id });
  assert.equal(bad.status, 400);
  const missing = await coach.post(`/dreamers/${dreamerId}/journal`, { body: 'x', sessionId: 999999 });
  assert.equal(missing.status, 400);
  const good = await coach.post(`/dreamers/${dreamerId}/journal`, { body: 'Shared in session', sessionId: started.body.id });
  assert.equal(good.status, 201);
  await coach.del(`/dreamers/${dreamerId}/journal/${good.body.id}`);
  await coach.del(`/dreamers/${dreamerId}/sessions/${started.body.id}`);
});

test('a private note the dreamer cannot see right now is never overwritten, cleared or re-flagged blindly', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const rating = (await dreamer.get('/dreamers/me/ratings?category=alignment')).body.find((r: any) => !r.isPrivate && !r.note);
  assert.ok(rating);
  const secret = `Hidden note ${uniqueMarker()}`;
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { note: secret, notePrivate: true })).status, 200);
  await dreamer.post('/auth/privacy/lock');

  // In hidden mode the rating looks note-less, exactly as the coach sees it…
  const hidden = (await dreamer.get('/dreamers/me/ratings?category=alignment')).body.find((r: any) => r.id === rating.id);
  assert.equal(hidden.note, null);
  // …so "Add a note" asks to unlock instead of replacing the private text, and clearing or re-flagging does nothing.
  const add = await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { note: 'Typed while hidden', notePrivate: false });
  assert.equal(add.status, 409);
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { note: null })).status, 200);
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { notePrivate: false })).status, 200);
  const coachView = (await coach.get(`/dreamers/${dreamerId}/care/alignment`)).body.entries.find((e: any) => e.id === rating.id);
  assert.equal(coachView.note, null, 'the coach still sees no note');

  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const after = (await dreamer.get('/dreamers/me/ratings?category=alignment')).body.find((r: any) => r.id === rating.id);
  assert.equal(after.note.body, secret, 'the private note survives untouched');
  assert.equal(after.note.isPrivate, true);
  await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { note: null });
});

/* ---------- Session cells, notes and write responses ---------- */

const sessionRow = async (dreamer: Client, category: string, sessionId: number) =>
  (await dreamer.get(`/dreamers/me/ratings?category=${category}`)).body.filter((r: any) => r.sessionId === sessionId);

test('staff clearing a cell or deleting a session value never destroys the dreamer’s note on it', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const session = (await coach.get(`/dreamers/${dreamerId}/sessions`)).body.filter((x: any) => x.status === 'completed').slice(-2)[0];
  const [rel] = await sessionRow(dreamer, 'relationships', session.id);
  const [energy] = await sessionRow(dreamer, 'energy', session.id);
  const secret = `Private words ${uniqueMarker()}`;
  const shared = `Shared words ${uniqueMarker()}`;
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${rel.id}`, { note: secret, notePrivate: true })).status, 200);
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${energy.id}`, { note: shared, notePrivate: false })).status, 200);

  // The coach empties the Relationships cell and types the value again; the private note is kept, still private.
  assert.equal((await coach.put(`/dreamers/${dreamerId}/sessions/${session.id}/ratings`, { category: 'relationships', value: null })).status, 200);
  await coach.put(`/dreamers/${dreamerId}/sessions/${session.id}/ratings`, { category: 'relationships', value: rel.value });
  const kept = (await dreamer.get('/dreamers/me/journal')).body.find((j: any) => j.body === secret);
  assert.ok(kept, 'the private note survives the coach clearing the cell');
  assert.equal(kept.isPrivate, true);
  assert.equal(kept.ratingId, null);
  assert.equal(kept.category, 'relationships');
  assert.equal(kept.author.id, (await dreamer.get('/auth/me')).body.user.id);
  assert.ok(!allStrings((await coach.get(`/dreamers/${dreamerId}/journal`)).body).includes(secret), 'and stays invisible to staff');

  // The coach deletes the Energy value outright; the shared note becomes a standalone entry.
  assert.equal((await coach.del(`/dreamers/${dreamerId}/ratings/${energy.id}`)).status, 200);
  const standalone = (await coach.get(`/dreamers/${dreamerId}/journal`)).body.find((j: any) => j.body === shared);
  assert.ok(standalone && standalone.ratingId === null && standalone.category === 'energy');
  await coach.put(`/dreamers/${dreamerId}/sessions/${session.id}/ratings`, { category: 'energy', value: energy.value });

  // Dream progress works the same way.
  const progress = (await dreamer.get('/dreamers/me/progress')).body.find((p: any) => p.sessionId === session.id);
  await dreamer.patch(`/dreamers/me/progress/${progress.id}`, { note: `${secret} (progress)`, notePrivate: true });
  await coach.put(`/dreamers/${dreamerId}/sessions/${session.id}/progress`, { dreamId: progress.dreamId, value: null });
  const keptProgress = (await dreamer.get('/dreamers/me/journal')).body.find((j: any) => j.body === `${secret} (progress)`);
  assert.ok(keptProgress && keptProgress.isPrivate && keptProgress.progressId === null && keptProgress.dreamId === progress.dreamId);
  await coach.put(`/dreamers/${dreamerId}/sessions/${session.id}/progress`, { dreamId: progress.dreamId, value: progress.value });
  for (const j of [kept, standalone, keptProgress]) await dreamer.del(`/dreamers/me/journal/${j.id}`);
});

test('deleting an entry while private entries are hidden keeps its hidden private note', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const secret = `Hidden note ${uniqueMarker()}`;
  const dream = (await dreamer.get('/dreamers/me/dreams')).body[0];
  const ci = await dreamer.post('/dreamers/me/check-ins', {
    ratings: [{ category: 'alignment', value: 4, note: secret, notePrivate: true }],
    progress: [{ dreamId: dream.id, value: 40, note: `${secret} (progress)`, notePrivate: true }],
  });
  const ratingId = ci.body.ratings[0].id;
  await dreamer.post('/auth/privacy/lock');
  assert.equal((await dreamer.del(`/dreamers/me/ratings/${ratingId}`)).status, 200);
  assert.equal((await dreamer.del(`/dreamers/me/progress/${ci.body.progress[0].id}`)).status, 200);
  assert.ok(!allStrings((await dreamer.get('/dreamers/me/journal')).body).includes(secret), 'still hidden after the delete');
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const kept = (await dreamer.get('/dreamers/me/journal')).body.find((j: any) => j.body === secret);
  assert.ok(kept, 'the private note was kept as a standalone private entry');
  assert.equal(kept.isPrivate, true);
  assert.equal(kept.ratingId, null);
  assert.equal(kept.checkInId, null);
  assert.equal(kept.category, 'alignment');
  assert.equal(kept.occurredAt, ci.body.occurredAt);
  const keptProgress = (await dreamer.get('/dreamers/me/journal')).body.find((j: any) => j.body === `${secret} (progress)`);
  assert.ok(keptProgress && keptProgress.isPrivate && keptProgress.progressId === null && keptProgress.dreamId === dream.id);
  assert.ok(!(await coach.get(`/dreamers/${dreamerId}/check-ins`)).body.some((c: any) => c.id === ci.body.id), 'the emptied check-in is gone');
  // With private entries shown, deleting an entry takes its note with it (the dialog says so).
  const visible = await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'alignment', value: 4, note: secret + ' again', notePrivate: true }] });
  assert.equal((await dreamer.del(`/dreamers/me/ratings/${visible.body.ratings[0].id}`)).status, 200);
  assert.ok(!(await dreamer.get('/dreamers/me/journal')).body.some((j: any) => j.body === secret + ' again'));
  await dreamer.del(`/dreamers/me/journal/${kept.id}`);
  await dreamer.del(`/dreamers/me/journal/${keptProgress.id}`);
});

test('the dreamer can always hide a session value; sharing one back is refused only when the coach re-entered the cell', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const session = (await coach.get(`/dreamers/${dreamerId}/sessions`)).body.filter((x: any) => x.status === 'completed').slice(-3)[0];
  const [first] = await sessionRow(dreamer, 'satisfaction', session.id);
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${first.id}`, { isPrivate: true })).status, 200);
  await coach.put(`/dreamers/${dreamerId}/sessions/${session.id}/ratings`, { category: 'satisfaction', value: 3 });
  const second = (await sessionRow(dreamer, 'satisfaction', session.id)).find((r: any) => !r.isPrivate);

  // Sharing the first back would put two values in one cell.
  const refused = await dreamer.patch(`/dreamers/me/ratings/${first.id}`, { isPrivate: false });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /recorded a new value for this session after you hid this one/);
  // Hiding the coach's new value works, in hidden mode too; then the first can be shared again.
  await dreamer.post('/auth/privacy/lock');
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${second.id}`, { isPrivate: true })).status, 200);
  assert.equal((await coach.get(`/dreamers/${dreamerId}/sessions/${session.id}`)).body.ratings.satisfaction, undefined);
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const mine = (await dreamer.get(`/dreamers/me/sessions/${session.id}`)).body;
  assert.deepEqual(mine.privateRatings.filter((c: string) => c === 'satisfaction'), ['satisfaction'], 'listed once, though two private values share the cell');
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${first.id}`, { isPrivate: false })).status, 200);
  assert.equal((await coach.get(`/dreamers/${dreamerId}/sessions/${session.id}`)).body.ratings.satisfaction, first.value);

  // A private session value is the dreamer's to delete (staff can't see it); a shared one stays the coach's.
  assert.equal((await dreamer.del(`/dreamers/me/ratings/${first.id}`)).status, 403);
  assert.equal((await dreamer.del(`/dreamers/me/ratings/${second.id}`)).status, 200);
  assert.equal((await sessionRow(dreamer, 'satisfaction', session.id)).length, 1);
});

test('a private value left behind by deleting a session can be removed but not shared again', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const sid = (await coach.post(`/dreamers/${dreamerId}/sessions`, {})).body.id;
  await coach.put(`/dreamers/${dreamerId}/sessions/${sid}/ratings`, { category: 'contribution', value: 3 });
  await coach.put(`/dreamers/${dreamerId}/sessions/${sid}/ratings`, { category: 'energy', value: 3 });
  const [contribution] = await sessionRow(dreamer, 'contribution', sid);
  const [energy] = await sessionRow(dreamer, 'energy', sid);
  await dreamer.patch(`/dreamers/me/ratings/${contribution.id}`, { isPrivate: true });
  await dreamer.patch(`/dreamers/me/ratings/${energy.id}`, { isPrivate: true });
  assert.equal((await coach.del(`/dreamers/${dreamerId}/sessions/${sid}`)).status, 200);

  const orphan = (await dreamer.get('/dreamers/me/ratings?category=contribution')).body.find((r: any) => r.id === contribution.id);
  assert.deepEqual([orphan.source, orphan.sessionId, orphan.isPrivate], ['session', null, true]);
  const share = await dreamer.patch(`/dreamers/me/ratings/${orphan.id}`, { isPrivate: false });
  assert.equal(share.status, 409, 'staff never see a session value without its session');
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${orphan.id}`, { value: 5 })).status, 403, 'the value stays the coach’s');
  assert.equal((await dreamer.del(`/dreamers/me/ratings/${orphan.id}`)).status, 200);
  await dreamer.post('/auth/privacy/lock');
  assert.equal((await dreamer.del(`/dreamers/me/ratings/${energy.id}`)).status, 404, 'hidden while private entries are hidden');
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  assert.equal((await dreamer.del(`/dreamers/me/ratings/${energy.id}`)).status, 200);
});

test('write responses in hidden mode show only what a GET would: no hidden note, no private row', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const secret = `Hidden ${uniqueMarker()}`;
  const ci = await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'relationships', value: 6, note: secret, notePrivate: true }] });
  const id = ci.body.ratings[0].id;
  await dreamer.post('/auth/privacy/lock');

  for (const body of [{ value: 7 }, { note: null }, { notePrivate: false }]) {
    const res = await dreamer.patch(`/dreamers/me/ratings/${id}`, body);
    assert.equal(res.status, 200);
    assert.equal(res.body.note, null, `PATCH ${JSON.stringify(body)} does not return the hidden note`);
    const coachView = (await coach.get(`/dreamers/${dreamerId}/care/relationships`)).body.entries.find((e: any) => e.id === id);
    assert.deepEqual(res.body, coachView, 'the response is exactly what the coach sees');
  }
  // Writes whose result is private come back empty while private entries are hidden.
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${id}`, { isPrivate: true })).body, null);
  const j = await dreamer.post('/dreamers/me/journal', { body: secret, isPrivate: true });
  assert.equal(j.status, 201);
  assert.equal(j.body, null);
  const a = await dreamer.post('/dreamers/me/actions', { title: secret, isPrivate: true });
  assert.equal(a.status, 201);
  assert.equal(a.body, null);
  const allPrivate = await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'energy', value: 2, isPrivate: true }] });
  assert.equal(allPrivate.status, 201);
  assert.equal(allPrivate.body, null);
  const mixed = await dreamer.post('/dreamers/me/check-ins', { ratings: [{ category: 'energy', value: 2, isPrivate: true }, { category: 'contribution', value: 6, note: secret, notePrivate: true }] });
  assert.deepEqual(mixed.body.ratings.map((r: any) => [r.category, r.note]), [['contribution', null]]);

  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const unlocked = await dreamer.patch(`/dreamers/me/ratings/${id}`, { value: 6 });
  assert.equal(unlocked.body.note.body, secret, 'with private entries shown the owner gets everything back');
  await dreamer.del(`/dreamers/me/ratings/${id}`);
});

test('notes on private entries are flagged for the owner only while private entries are shown', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const marker = uniqueMarker();
  await dreamer.post('/dreamers/me/check-ins', {
    ratings: [{ category: 'energy', value: 3, isPrivate: true, note: `${marker} under private` }, { category: 'alignment', value: 8, note: `${marker} under shared` }],
  });
  const journal = (await dreamer.get('/dreamers/me/journal')).body.filter((j: any) => j.body.startsWith(marker));
  assert.deepEqual(journal.map((j: any) => [j.body.slice(marker.length + 1), j.isPrivate, j.parentPrivate]).sort(), [['under private', false, true], ['under shared', false, false]]);
  assert.ok((await dreamer.get('/dreamers/me/journal')).body.every((j: any) => typeof j.parentPrivate === 'boolean'));
  await dreamer.post('/auth/privacy/lock');
  for (const r of [await dreamer.get('/dreamers/me/journal'), await coach.get(`/dreamers/${dreamerId}/journal`)]) {
    assert.ok(r.body.every((j: any) => !('parentPrivate' in j)), 'no trace in hidden mode or for staff');
  }
});

test('ids carry no trace of private rows: rows written together do not get sequential ids', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const ci = await dreamer.post('/dreamers/me/check-ins', {
    ratings: [
      { category: 'contribution', value: 7, note: 'c' },
      { category: 'alignment', value: 2, isPrivate: true },
      { category: 'relationships', value: 6, note: 'r', notePrivate: true },
      { category: 'energy', value: 5, note: 'e' },
    ],
    reflection: { body: 'private reflection', isPrivate: true },
  });
  const seen = (await coach.get(`/dreamers/${dreamerId}/check-ins`)).body.find((c: any) => c.id === ci.body.id);
  assert.deepEqual(seen.ratings.map((r: any) => r.category), ['contribution', 'relationships', 'energy'], 'CARE order is kept');
  const ids = [ci.body.id, ...ci.body.ratings.flatMap((r: any) => [r.id, r.note?.id]).filter(Boolean), (await dreamer.post('/dreamers/me/actions', { title: 'x' })).body.id];
  for (const x of ids) assert.ok(Number.isSafeInteger(x) && x > 0);
  for (const a of ids) for (const b of ids) if (a !== b) assert.ok(Math.abs(a - b) > 1000, 'ids are not handed out in sequence');
});

test('seeded rows carry random ids too, so the demo data shows no countable gaps', async () => {
  const { coach, dreamerId } = await dreamerAndCoach();
  const checkIns = (await coach.get(`/dreamers/${dreamerId}/check-ins`)).body as any[];
  const ids = [
    ...checkIns.map((c) => c.id),
    ...checkIns.flatMap((c) => (c.ratings ?? []).map((r: any) => r.id)),
    ...((await coach.get(`/dreamers/${dreamerId}/actions`)).body as any[]).map((a) => a.id),
    ...((await coach.get(`/dreamers/${dreamerId}/journal`)).body as any[]).map((j) => j.id),
  ];
  assert.ok(ids.length > 50, `enough rows to judge (${ids.length})`);
  for (const id of ids) assert.ok(Number.isSafeInteger(id) && id > 2 ** 20, `id ${id} is not sequential-looking`);
  const sorted = [...ids].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i]! - sorted[i - 1]! > 1000, 'no two visible ids sit next to each other');
});

test('making an entry private and shared again leaves no trace in what staff see', async () => {
  const { dreamer, coach, dreamerId } = await dreamerAndCoach();
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const action = (await dreamer.get('/dreamers/me/actions')).body.find((a: any) => !a.isPrivate);
  const rating = (await dreamer.get('/dreamers/me/ratings?category=energy')).body.find((r: any) => !r.isPrivate && r.source === 'self');
  const before = { actions: (await coach.get(`/dreamers/${dreamerId}/actions`)).body, energy: (await coach.get(`/dreamers/${dreamerId}/care/energy`)).body };
  await dreamer.patch(`/dreamers/me/actions/${action.id}`, { isPrivate: true });
  await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { isPrivate: true });
  await new Promise((r) => setTimeout(r, 15));
  await dreamer.patch(`/dreamers/me/actions/${action.id}`, { isPrivate: false });
  await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { isPrivate: false });
  const after = { actions: (await coach.get(`/dreamers/${dreamerId}/actions`)).body, energy: (await coach.get(`/dreamers/${dreamerId}/care/energy`)).body };
  assert.deepEqual(after, before);
});
