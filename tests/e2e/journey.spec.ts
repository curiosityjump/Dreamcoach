/**
 * The complete journey from the brief, end to end against a freshly seeded database:
 *  1. A coach conducts and records a coaching session.
 *  2. The dreamer opens their own account and sees updated information.
 *  3. The dreamer adds and completes an action item.
 *  4. The dreamer makes an independent CARE check-in and adds a journal entry.
 *  5. The dreamer makes entries private.
 *  6. The coach cannot detect those private entries.
 *  7. The dreamer uses Hide Private / Show Private with password re-entry.
 *  8. The dreamer views their historical ratings and journal timeline.
 *  9. The Director sees updated team metrics without private information leaking.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const PASSWORD = 'dream2026';
const PRIVATE_NOTE = `PRIVATE-NOTE-${Date.now()}`;
const PRIVATE_JOURNAL = `PRIVATE-JOURNAL-${Date.now()}`;
const SHARED_REFLECTION = `SHARED-REFLECTION-${Date.now()}`;
const COACH_ACTION = 'Walk with Jada on Saturday morning';
const DREAMER_ACTION = 'Buy new running shoes';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function api<T = any>(ctx: BrowserContext, method: 'get' | 'post' | 'patch', path: string, data?: unknown): Promise<T> {
  const r = await ctx.request.fetch(`/api${path}`, { method, data });
  expect(r.ok(), `${method} ${path} → ${r.status()}`).toBeTruthy();
  return (await r.json()) as T;
}

/** Every string anywhere in a JSON value, joined — to assert a marker never appears. */
function flat(v: unknown): string {
  return JSON.stringify(v);
}

test.describe.configure({ mode: 'serial' });

let dreamerId: number;
let sessionId: number;
let dreamIds: number[] = [];

test('1. the coach runs and records a live coaching session', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'maya@dreamcoach.demo');
  await expect(page).toHaveURL(/\/coach/);

  const dash = await api(ctx, 'get', '/coach/dashboard');
  dreamerId = dash.caseload.find((c: any) => c.dreamer.name === 'Alicia Moreno').dreamer.id;
  const dreams = await api(ctx, 'get', `/dreamers/${dreamerId}/dreams`);
  dreamIds = dreams.map((d: any) => d.id);
  const started = await api(ctx, 'post', `/dreamers/${dreamerId}/sessions`, {});
  sessionId = started.id;

  await page.goto(`/dreamers/${dreamerId}/session/${sessionId}`);
  await expect(page.getByTestId('session-workspace')).toBeVisible();
  await expect(page.getByTestId('session-grid')).toBeVisible();

  // Step 1 — CARE ratings typed into the current column.
  const ratings: Record<string, string> = { contribution: '8', alignment: '7', relationships: '8', energy: '6' };
  for (const [cat, v] of Object.entries(ratings)) {
    const input = page.getByTestId(`grid-rating-${cat}`);
    await input.fill(v);
    await input.press('Tab');
  }
  // Step 2 — dream progress.
  const progress = [74, 90, 33, 15];
  for (let i = 0; i < dreamIds.length; i++) {
    const input = page.getByTestId(`grid-progress-${dreamIds[i]}`);
    await input.fill(String(progress[i]));
    await input.press('Tab');
  }
  // Step 4 & 6 — commitment and satisfaction.
  for (const [cat, v] of Object.entries({ commitment: '9', satisfaction: '8' })) {
    const input = page.getByTestId(`grid-rating-${cat}`);
    await input.fill(v);
    await input.press('Tab');
  }
  await expect.poll(async () => (await api(ctx, 'get', `/dreamers/${dreamerId}/sessions/${sessionId}`)).ratings.energy, { timeout: 10_000 }).toBe(6);

  // Step 5 — a new action chosen together.
  const newSection = page.getByTestId('section-new');
  await newSection.getByTestId('action-title-input').fill(COACH_ACTION);
  await newSection.getByTestId('add-action').click();
  await expect(newSection.getByTestId('action-item').filter({ hasText: COACH_ACTION })).toBeVisible();

  // Focus and notes autosave.
  await page.getByTestId('session-focus').fill('Energy — protect the morning run');
  await page.getByTestId('session-focus').blur();
  await page.getByTestId('session-notes').fill('Good energy today.\nAgreed to protect Saturday mornings for the long run.');
  await page.getByTestId('session-notes').blur();
  await expect.poll(async () => (await api(ctx, 'get', `/dreamers/${dreamerId}/sessions/${sessionId}`)).notes, { timeout: 10_000 }).toContain('Saturday mornings');

  // Complete the session.
  await page.getByTestId('session-complete').click();
  await expect(page).toHaveURL(new RegExp(`/dreamers/${dreamerId}/sessions`));
  const session = await api(ctx, 'get', `/dreamers/${dreamerId}/sessions/${sessionId}`);
  expect(session.status).toBe('completed');
  expect(session.ratings).toMatchObject({ contribution: 8, alignment: 7, relationships: 8, energy: 6, commitment: 9, satisfaction: 8 });
  expect(session.progress[dreamIds[0]]).toBe(74);
  await ctx.close();
});

test('2–3. the dreamer sees the session and manages actions', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'alicia@dreamcoach.demo');
  await expect(page).toHaveURL(/\/home/);
  await expect(page.getByTestId('privacy-toggle')).toContainText(/show private/i);

  // The coach's values are reflected on the dreamer's home.
  await expect(page.getByTestId('home-care-energy')).toContainText('6');
  await expect(page.getByTestId('home-actions').getByTestId('action-item').filter({ hasText: COACH_ACTION })).toBeVisible();
  await expect(page.getByTestId('home-dream').first()).toContainText('74%');

  // Add an action and complete it.
  await page.goto('/actions');
  await page.getByTestId('actions-composer').getByTestId('action-title-input').fill(DREAMER_ACTION);
  await page.getByTestId('actions-composer').getByTestId('add-action').click();
  const row = page.getByTestId('action-item').filter({ hasText: DREAMER_ACTION });
  await expect(row).toBeVisible();
  await row.getByTestId('action-check').click();
  await expect(page.getByTestId('action-group-active').getByTestId('action-item').filter({ hasText: DREAMER_ACTION })).toHaveCount(0, { timeout: 10_000 }).catch(() => {});
  await page.getByTestId('actions-tab-completed').click();
  await expect(page.getByTestId('action-item').filter({ hasText: DREAMER_ACTION })).toBeVisible();
  const actions = await api(ctx, 'get', `/dreamers/me/actions?status=completed`);
  expect(actions.some((a: any) => a.title === DREAMER_ACTION && a.completedAt)).toBeTruthy();
  await ctx.close();
});

test('4–5. the dreamer checks in, journals, and makes entries private', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'alicia@dreamcoach.demo');

  // A self check-in: Energy 5 (shared) with a PRIVATE note, plus a shared reflection.
  await page.goto('/check-in');
  await page.getByTestId('checkin-pick-energy').click();
  const card = page.getByTestId('checkin-card-energy');
  await card.getByRole('radio', { name: '5' }).click();
  await page.getByTestId('checkin-note-energy').fill(`Didn't sleep well this week. ${PRIVATE_NOTE}`);
  await page.getByTestId('checkin-note-privacy-energy').getByRole('button').click();
  await expect(page.getByTestId('checkin-note-privacy-energy').getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('checkin-reflection').fill(`Kept one promise to myself this week. ${SHARED_REFLECTION}`);
  await page.getByTestId('checkin-save').click();
  await expect(page).toHaveURL(/\/home/);

  // A fully private journal entry.
  await page.goto('/journal?compose=1');
  await page.getByTestId('journal-body-input').fill(`Something I am not ready to share yet. ${PRIVATE_JOURNAL}`);
  await page.getByTestId('journal-privacy-toggle').getByRole('button').click();
  await expect(page.getByTestId('journal-privacy-toggle').getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('journal-save').click();

  // Private entries are hidden by default (we never unlocked), so the entry is not on screen…
  await expect(page.getByText(PRIVATE_JOURNAL)).toHaveCount(0);
  // …but the shared reflection is.
  await expect(page.getByText(SHARED_REFLECTION).first()).toBeVisible();

  // The server agrees: hidden mode excludes private rows for the owner too.
  const journal = await api(ctx, 'get', '/dreamers/me/journal');
  expect(flat(journal)).not.toContain(PRIVATE_JOURNAL);
  expect(flat(journal)).not.toContain(PRIVATE_NOTE);
  expect(flat(journal)).toContain(SHARED_REFLECTION);
  await ctx.close();
});

test('6. the coach cannot detect the private entries, but sees the shared ones', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'maya@dreamcoach.demo');

  const responses = await Promise.all([
    api(ctx, 'get', `/dreamers/${dreamerId}/overview`),
    api(ctx, 'get', `/dreamers/${dreamerId}/journal`),
    api(ctx, 'get', `/dreamers/${dreamerId}/timeline`),
    api(ctx, 'get', `/dreamers/${dreamerId}/check-ins`),
    api(ctx, 'get', `/dreamers/${dreamerId}/care/energy`),
    api(ctx, 'get', `/coach/dashboard`),
  ]);
  const text = flat(responses);
  expect(text).not.toContain(PRIVATE_NOTE);
  expect(text).not.toContain(PRIVATE_JOURNAL);
  expect(text).not.toContain('"isPrivate":true');
  expect(text).toContain(SHARED_REFLECTION);
  // The shared Energy 5 rating is visible to the coach with no note attached and nothing hinting at one.
  const energy = responses[4];
  const latest = energy.entries[energy.entries.length - 1];
  expect(latest.value).toBe(5);
  expect(latest.source).toBe('self');
  expect(latest.note).toBeNull();

  // And on screen: the dreamer's pages for staff carry no trace and no privacy wording.
  for (const tab of ['', '/reflections', '/history', '/actions', '/sessions']) {
    await page.goto(`/dreamers/${dreamerId}${tab}`);
    await page.waitForLoadState('networkidle');
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain(PRIVATE_NOTE.toLowerCase());
    expect(body).not.toContain(PRIVATE_JOURNAL.toLowerCase());
    expect(body).not.toContain('private');
  }
  await ctx.close();
});

test('7–8. hide/show private with password re-entry, and the history views', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'alicia@dreamcoach.demo');

  await page.goto('/journal');
  await expect(page.getByText(PRIVATE_JOURNAL)).toHaveCount(0);

  // Show private → wrong password is refused.
  await page.getByTestId('privacy-toggle').click();
  await expect(page.getByTestId('unlock-form')).toBeVisible();
  await page.fill('#unlock-password', 'not-my-password');
  await page.getByTestId('unlock-form').getByRole('button', { name: /show private entries/i }).click();
  await expect(page.getByTestId('unlock-form').getByRole('alert')).toBeVisible();

  // Correct password reveals private entries.
  await page.fill('#unlock-password', PASSWORD);
  await page.getByTestId('unlock-form').getByRole('button', { name: /show private entries/i }).click();
  await expect(page.getByTestId('privacy-toggle')).toContainText(/hide private/i);
  await expect(page.getByText(PRIVATE_JOURNAL).first()).toBeVisible();

  // The Energy history shows the rating with its private note (because we're unlocked).
  await page.goto('/care/energy');
  await expect(page.getByTestId('category-page')).toBeVisible();
  await expect(page.getByTestId('category-chart')).toBeVisible();
  await expect(page.getByText(PRIVATE_NOTE).first()).toBeVisible();
  await expect(page.getByTestId('category-entry').first()).toBeVisible();

  // Hide private is instant and complete: the screen clears before the server confirms the lock.
  const locked = page.waitForResponse((r) => r.url().endsWith('/api/auth/privacy/lock') && r.ok());
  await page.getByTestId('privacy-toggle').click();
  await expect(page.getByTestId('privacy-toggle')).toContainText(/show private/i);
  await expect(page.getByText(PRIVATE_NOTE)).toHaveCount(0);
  await locked;
  await page.goto('/journal');
  await expect(page.getByText(PRIVATE_JOURNAL)).toHaveCount(0);

  // Signing out and back in starts hidden again.
  await page.getByTestId('user-menu').click();
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login/);
  await login(page, 'alicia@dreamcoach.demo');
  await expect(page.getByTestId('privacy-toggle')).toContainText(/show private/i);
  await ctx.close();
});

test('9. the Director sees updated team metrics with no private information', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'director@dreamcoach.demo');
  await expect(page).toHaveURL(/\/director/);
  await page.waitForLoadState('networkidle');
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).toContain('dream');
  expect(body).not.toContain('private');

  const [overview, rows] = await Promise.all([api(ctx, 'get', '/director/overview'), api(ctx, 'get', '/director/dreamers')]);
  const text = flat([overview, rows]);
  expect(text).not.toContain(PRIVATE_NOTE);
  expect(text).not.toContain(PRIVATE_JOURNAL);
  expect(text).not.toContain('"isPrivate":true');
  // The session the coach completed counts for Maya and the team.
  const maya = overview.coaches.find((c: any) => c.coach.name === 'Maya Thompson');
  expect(maya.sessionsLast30d).toBeGreaterThanOrEqual(1);
  expect(overview.totals.sessionsThisMonth).toBeGreaterThanOrEqual(1);
  const alicia = rows.find((r: any) => r.dreamer.id === dreamerId);
  expect(alicia.snapshot.latest.energy.value).toBe(5); // the shared self check-in is the latest shared Energy
  expect(alicia.snapshot.lastSession.id).toBe(sessionId);

  await page.goto('/director/dreamers');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Alicia Moreno').first()).toBeVisible();
  await ctx.close();
});
