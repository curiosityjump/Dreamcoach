import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../server/db.ts';
import { resetAndSeed } from '../../server/seed.ts';

interface Word { body: string; created_at: string; dream_id: number; progress_id: number | null; point_at: string | null; value: number | null; occurred_at: string | null }
interface Step { title: string; created_at: string; completed_at: string | null; archived_at: string | null }

test('the demo dreamers’ words about a dream never run ahead of its steps', () => {
  const db = openDatabase(':memory:');
  try {
    resetAndSeed(db);
    // Every word tagged to a dream, with the moment the progress value it sits on was recorded (a session's end).
    const words = db.prepare(
      `SELECT j.body, j.created_at, j.dream_id, j.progress_id, COALESCE(s.completed_at, p.occurred_at) AS point_at, p.value, p.occurred_at
         FROM journal_entries j LEFT JOIN dream_progress p ON p.id = j.progress_id LEFT JOIN coaching_sessions s ON s.id = p.session_id
        WHERE j.dream_id IS NOT NULL`,
    ).all() as Word[];
    const steps = db.prepare('SELECT title, created_at, completed_at, archived_at FROM actions WHERE dream_id = ?');
    const previous = db.prepare('SELECT value FROM dream_progress WHERE dream_id = ? AND occurred_at < ? ORDER BY occurred_at DESC LIMIT 1');
    const t = (iso: string) => Date.parse(iso);
    const doneBefore = (w: Word, title: string) => {
      const step = (steps.all(w.dream_id) as Step[]).find((s) => s.title === title);
      assert.ok(step?.completed_at, `“${w.body}” needs “${title}” done, but it is ${step ? 'not done' : 'not a step'}`);
      assert.ok(t(step.completed_at) <= Math.min(t(w.created_at), w.point_at ? t(w.point_at) : Infinity), `“${w.body}” was written before “${title}” was done`);
      return step;
    };
    let stepNotes = 0;
    for (const w of words) {
      const m = /^(.*) — (done\.|done, and it moved this one along\.|done\. On to the next step\.|finally done\.)$/.exec(w.body);
      if (!m) continue;
      stepNotes++;
      const step = doneBefore(w, m[1]!);
      if (m[2]!.includes('moved this one along')) {
        const was = previous.get(w.dream_id, w.occurred_at) as { value: number } | undefined;
        assert.ok(was && w.value! > was.value, `“${w.body}” sits beside a value that did not rise (${was?.value} → ${w.value})`);
      }
      if (m[2]!.startsWith('finally')) assert.ok(t(step.completed_at!) - t(step.created_at) >= 28 * 86400000, `“${w.body}” took under four weeks`);
      if (m[2]!.includes('next step')) {
        const open = (steps.all(w.dream_id) as Step[]).some((s) => s.title !== step.title && t(s.created_at) <= t(w.created_at) && [s.completed_at, s.archived_at].every((x) => !x || t(x) > t(w.created_at)));
        assert.ok(open, `“${w.body}” with no other step of the dream open`);
      }
    }
    assert.ok(stepNotes > 10, `enough step notes to judge (${stepNotes})`);
    // Lines that presuppose a particular step only follow it.
    const presuppose: [string, string][] = [
      ['One of the boys at Cedar Court asked whether his mentor', 'Pair the first mentors with students'],
      ['The principal at Lincoln Middle wants', 'Meet the principal at Lincoln Middle'],
      ['The kids asked when the next mentor night', 'Plan the first mentor check-in night'],
      ['Explaining the leave rules to the study group', 'Join the online study group'],
      ['Eight people around the table', 'Send the first invitation'],
      ['The studio corner is the only place', 'Set up the spare room as a studio corner'],
      ['The coverage handbook is written', 'Write the coverage handbook'],
      ['The new property managers asked good questions', 'Lead the budgeting workshop for new PMs'],
      ['Phones in the basket', 'Buy a basket for phones by the door'],
      ['The early swims are getting easier', 'Swim Monday and Thursday mornings'],
    ];
    for (const w of words) for (const [line, title] of presuppose) if (w.body.startsWith(line)) doneBefore(w, title);
  } finally {
    db.close();
  }
});
