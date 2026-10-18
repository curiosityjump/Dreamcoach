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

test('a session counts the actions chosen in it, and how many of those are now completed', async () => {
  const coach = new Client(s.base);
  await coach.login('priya@dreamcoach.demo');
  const entry = (await coach.get('/coach/dashboard')).body.caseload.find((c: any) => !c.snapshot.openSession);
  const id = entry.dreamer.id;
  const sid = (await coach.post(`/dreamers/${id}/sessions`, {})).body.id;
  const chosen: any[] = [];
  for (const title of ['Book the pottery taster', 'Phone Gran on Sunday', 'Draft the cover letter']) chosen.push((await coach.post(`/dreamers/${id}/actions`, { title, sessionId: sid })).body);
  // An action from outside this session, completed while it is open, is not this session's.
  const elsewhere = (await coach.post(`/dreamers/${id}/actions`, { title: 'Water the balcony plants' })).body;
  await coach.patch(`/dreamers/${id}/actions/${elsewhere.id}`, { status: 'completed' });
  await coach.patch(`/dreamers/${id}/actions/${chosen[0].id}`, { status: 'completed' });
  await coach.patch(`/dreamers/${id}/actions/${chosen[1].id}`, { status: 'archived' });
  let session = (await coach.patch(`/dreamers/${id}/sessions/${sid}`, { status: 'completed' })).body;
  assert.equal(session.actionsCreated, 3);
  assert.equal(session.actionsCompleted, 1);
  // Completing a chosen action after the session still counts for the session it was chosen in.
  await coach.patch(`/dreamers/${id}/actions/${chosen[2].id}`, { status: 'completed' });
  session = (await coach.get(`/dreamers/${id}/sessions/${sid}`)).body;
  assert.equal(session.actionsCompleted, 2);
  // Every session's counts match its own actions.
  const actions = (await coach.get(`/dreamers/${id}/actions`)).body;
  for (const x of (await coach.get(`/dreamers/${id}/sessions`)).body) {
    const mine = actions.filter((a: any) => a.sessionId === x.id);
    assert.equal(x.actionsCreated, mine.length, `session ${x.number} created`);
    assert.equal(x.actionsCompleted, mine.filter((a: any) => a.status === 'completed').length, `session ${x.number} completed`);
  }
  // A chosen action the dreamer makes private drops out of the coach's counts, not the dreamer's.
  const dreamer = new Client(s.base);
  await dreamer.login(entry.dreamer.email);
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  assert.equal((await dreamer.patch(`/dreamers/me/actions/${chosen[0].id}`, { isPrivate: true })).status, 200);
  const coachView = (await coach.get(`/dreamers/${id}/sessions/${sid}`)).body;
  assert.equal(coachView.actionsCreated, 2);
  assert.equal(coachView.actionsCompleted, 1);
  const ownerView = (await dreamer.get(`/dreamers/me/sessions/${sid}`)).body;
  assert.equal(ownerView.actionsCreated, 3);
  assert.equal(ownerView.actionsCompleted, 2);
  await dreamer.patch(`/dreamers/me/actions/${chosen[0].id}`, { isPrivate: false });
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

test('dreamers can change privacy of session-recorded entries but not their values; coaches the reverse', async () => {
  const dreamer = new Client(s.base);
  await dreamer.login('marcus@dreamcoach.demo');
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const ratings = (await dreamer.get('/dreamers/me/ratings?category=energy')).body;
  const sessionRating = ratings.find((r: any) => r.source === 'session');
  const selfRating = ratings.find((r: any) => r.source === 'self');
  assert.ok(sessionRating && selfRating);
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${sessionRating.id}`, { value: 10 })).status, 403);
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${sessionRating.id}`, { isPrivate: true })).status, 200);
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${sessionRating.id}`, { isPrivate: false })).status, 200);
  const edited = await dreamer.patch(`/dreamers/me/ratings/${selfRating.id}`, { value: 3, note: 'edited note', notePrivate: true });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.value, 3);
  assert.equal(edited.body.note.body, 'edited note');
  assert.equal(edited.body.note.isPrivate, true);
  const coach = new Client(s.base);
  await coach.login('maya@dreamcoach.demo');
  const id = (await dreamer.get('/dreamers/me/overview')).body.dreamer.id;
  assert.equal((await coach.patch(`/dreamers/${id}/ratings/${selfRating.id}`, { value: 9 })).status, 403);
  assert.equal((await coach.patch(`/dreamers/${id}/ratings/${sessionRating.id}`, { value: 9 })).status, 200);
  assert.equal((await coach.patch(`/dreamers/${id}/ratings/${sessionRating.id}`, { isPrivate: true })).status, 403);
  // Coach's edit shows for the dreamer.
  const after = (await dreamer.get('/dreamers/me/ratings?category=energy')).body.find((r: any) => r.id === sessionRating.id);
  assert.equal(after.value, 9);
});

test('dreamers add, edit and remove their own notes on session-recorded entries; the value stays the coach’s', async () => {
  const dreamer = new Client(s.base);
  const auth = await dreamer.login('owen@dreamcoach.demo');
  await dreamer.post('/auth/privacy/unlock', { password: 'dream2026' });
  const coach = new Client(s.base);
  await coach.login('maya@dreamcoach.demo');
  const id = auth.dreamerId;
  const rating = (await dreamer.get('/dreamers/me/ratings?category=energy')).body.find((r: any) => r.source === 'session' && !r.note);
  const progress = (await dreamer.get('/dreamers/me/progress')).body.find((p: any) => p.source === 'session' && !p.note);
  assert.ok(rating && progress);
  const coachEnergy = async () => (await coach.get(`/dreamers/${id}/care/energy`)).body.entries.find((e: any) => e.id === rating.id);

  // A shared note: the coach sees it next to the value they recorded.
  const added = await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { note: 'Tired, but it was a good tired.' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.value, rating.value);
  assert.equal(added.body.note.body, 'Tired, but it was a good tired.');
  assert.equal(added.body.note.isPrivate, false);
  assert.equal((await coachEnergy()).note.body, 'Tired, but it was a good tired.');

  // Edited and made private: the coach sees the value with no note.
  const edited = await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { note: 'Honestly I was running on empty.', notePrivate: true });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.note.isPrivate, true);
  const seen = await coachEnergy();
  assert.equal(seen.value, rating.value);
  assert.equal(seen.note, null);

  // Staff can neither write, overwrite nor clear the dreamer's note, and the value stays theirs to record.
  assert.equal((await coach.patch(`/dreamers/${id}/ratings/${rating.id}`, { note: 'Coach words' })).status, 403);
  assert.equal((await coach.patch(`/dreamers/${id}/ratings/${rating.id}`, { note: null })).status, 403);
  assert.equal((await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { value: 10 })).status, 403);
  assert.equal((await coach.patch(`/dreamers/${id}/ratings/${rating.id}`, { value: rating.value })).status, 200);
  const kept = (await dreamer.get('/dreamers/me/ratings?category=energy')).body.find((r: any) => r.id === rating.id);
  assert.equal(kept.note.body, 'Honestly I was running on empty.');
  assert.equal(kept.note.isPrivate, true);

  // Removing the note.
  const removed = await dreamer.patch(`/dreamers/me/ratings/${rating.id}`, { note: null });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.note, null);

  // Progress entries work the same way, including a private note in one step.
  const p = await dreamer.patch(`/dreamers/me/progress/${progress.id}`, { note: 'Slower than I hoped.', notePrivate: true });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.value, progress.value);
  assert.equal(p.body.note.isPrivate, true);
  const coachProgress = (await coach.get(`/dreamers/${id}/progress`)).body.find((e: any) => e.id === progress.id);
  assert.equal(coachProgress.note, null);
  assert.equal((await dreamer.patch(`/dreamers/me/progress/${progress.id}`, { value: 99 })).status, 403);
  assert.equal((await coach.patch(`/dreamers/${id}/progress/${progress.id}`, { note: 'x' })).status, 403);
  await dreamer.patch(`/dreamers/me/progress/${progress.id}`, { note: null });
});
