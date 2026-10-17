/**
 * Less common dreamer and coach flows: progress updates with private notes, inline
 * dream edits, rating from the wheel, privatising a self entry from the history
 * page, journal editing/deleting, phone layouts, and empty-session cleanup.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const PASSWORD = 'dream2026';
const PROGRESS_NOTE = `PROGRESS-NOTE-${Date.now()}`;
const JOURNAL_BODY = `JOURNAL-${Date.now()}`;
const NEW_TITLE = `Run the Riverfront Half Marathon in under 2:15 ${Date.now() % 1000}`;

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
async function unlock(page: Page) {
  await page.getByTestId('privacy-toggle').click();
  await page.fill('#unlock-password', PASSWORD);
  await page.getByTestId('unlock-form').getByRole('button', { name: /show private entries/i }).click();
  await expect(page.getByTestId('privacy-toggle')).toContainText(/hide private/i);
}
async function api<T = any>(ctx: BrowserContext, method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: unknown): Promise<T> {
  const r = await ctx.request.fetch(`/api${path}`, { method, data });
  expect(r.ok(), `${method} ${path} → ${r.status()}`).toBeTruthy();
  return (await r.json()) as T;
}

test.describe.configure({ mode: 'serial' });

test('dreams: update progress with a private note, edit the title inline', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'alicia@dreamcoach.demo');
  await page.goto('/dreams');
  const first = page.getByTestId('dream-card').first();
  await first.getByTestId('dream-update-progress').click();
  const dialog = page.getByTestId('progress-dialog');
  await expect(dialog).toBeVisible();
  const spin = dialog.getByRole('spinbutton');
  await spin.fill('77');
  await dialog.getByTestId('progress-note').fill(`Long run felt strong. ${PROGRESS_NOTE}`);
  await dialog.getByTestId('progress-note-private').getByRole('button').click();
  await page.getByTestId('progress-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(first.getByTestId('dream-progress-value')).toContainText('77%');

  // Owner (unlocked) sees the note; the coach sees the value only.
  await unlock(page);
  const dreams = await api(ctx, 'get', '/dreamers/me/dreams');
  const dreamId = dreams[0].id;
  const history = await api(ctx, 'get', `/dreamers/me/dreams/${dreamId}/history`);
  const entry = history.entries[history.entries.length - 1];
  expect(entry.value).toBe(77);
  expect(entry.isPrivate).toBe(false);
  expect(entry.note.isPrivate).toBe(true);
  expect(entry.note.body).toContain(PROGRESS_NOTE);

  const coachCtx = await browser.newContext();
  const coachPage = await coachCtx.newPage();
  await login(coachPage, 'maya@dreamcoach.demo');
  const me = await api(ctx, 'get', '/dreamers/me/overview');
  const coachHistory = await api(coachCtx, 'get', `/dreamers/${me.dreamer.id}/dreams/${dreamId}/history`);
  const coachEntry = coachHistory.entries.find((e: any) => e.id === entry.id);
  expect(coachEntry.value).toBe(77);
  expect(coachEntry.note).toBeNull();
  expect(JSON.stringify(coachHistory)).not.toContain(PROGRESS_NOTE);
  await coachCtx.close();

  // Inline edit on the detail page.
  await page.goto(`/dreams/${dreamId}`);
  await page.getByTestId('dream-edit-inline').click();
  await page.getByTestId('dream-title-input').fill(NEW_TITLE);
  await page.getByTestId('dream-edit-save').click();
  await expect(page.getByTestId('dream-title')).toContainText(NEW_TITLE);
  const after = await api(ctx, 'get', '/dreamers/me/dreams');
  expect(after[0].title).toBe(NEW_TITLE);
  await ctx.close();
});

test('CARE: rate from the wheel and save; privatise a self entry from history', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'alicia@dreamcoach.demo');
  await page.goto('/care');
  const wheel = page.getByTestId('care-wheel').locator('svg');
  const box = (await wheel.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // The wheel is drawn with ~58px label padding on each side of the viewBox; the data radius is the rest.
  const r = (Math.min(box.width, box.height) / 2) * ((Math.min(box.width, box.height) / 2 - 58 * (box.width / 380)) / (Math.min(box.width, box.height) / 2));
  // Top-left quadrant = Energy. Pick a value different from the current one so a change is pending:
  // 0.35·r on each axis → distance ≈ 0.49r → 5; if the current value is already 5, use 0.6 → ≈ 0.85r → 8/9.
  const current = (await api(ctx, 'get', '/dreamers/me/overview')).snapshot.latest.energy?.value;
  const k = current === 5 ? 0.6 : 0.35;
  await page.mouse.click(cx - r * k, cy - r * k);
  await expect(page.getByTestId('care-pending-panel')).toBeVisible();
  await expect(page.getByTestId('care-pending-energy')).toBeVisible();
  const noteEl = page.getByTestId('care-pending-note-energy');
  const noteField = (await noteEl.evaluate((e) => e.tagName)) === 'TEXTAREA' ? noteEl : noteEl.locator('textarea');
  await noteField.fill('Rated straight from the wheel.');
  await page.getByTestId('care-pending-save').click();
  await expect(page.getByTestId('care-pending-panel')).toHaveCount(0);
  const ratings = await api(ctx, 'get', '/dreamers/me/ratings?category=energy');
  const last = ratings[ratings.length - 1];
  expect(last.source).toBe('self');
  expect(last.value).toBeGreaterThanOrEqual(4);
  expect(last.value).toBeLessThanOrEqual(9);
  expect(last.note.body).toContain('wheel');

  // Make that entry private from the history page; the coach's list then lacks it.
  await page.goto('/care/energy');
  const entryRow = page.getByTestId('category-entry').filter({ hasText: 'wheel' }).first();
  await entryRow.getByTestId('category-entry-menu').click();
  await page.getByTestId('category-entry-make-private').click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Make private' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  // Hidden mode: the entry disappears for the owner too.
  await expect(page.getByTestId('category-entry').filter({ hasText: 'wheel' })).toHaveCount(0);
  const coachCtx = await browser.newContext();
  const coachPage = await coachCtx.newPage();
  await login(coachPage, 'maya@dreamcoach.demo');
  const me = await api(ctx, 'get', '/dreamers/me/overview');
  const coachEnergy = await api(coachCtx, 'get', `/dreamers/${me.dreamer.id}/care/energy`);
  expect(coachEnergy.entries.some((e: any) => e.id === last.id)).toBe(false);
  await coachCtx.close();
  // Owner unlocked: it is back, marked private.
  await unlock(page);
  const mine = page.getByTestId('category-entry').filter({ hasText: 'wheel' }).first();
  await expect(mine).toBeVisible();
  await expect(mine).toContainText(/private/i);
  await ctx.close();
});

test('journal: write, edit, filter by private, delete', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'alicia@dreamcoach.demo');
  await unlock(page);
  await page.goto('/journal?compose=1');
  await page.getByTestId('journal-body-input').fill(`First draft. ${JOURNAL_BODY}`);
  await page.getByTestId('journal-privacy-toggle').getByRole('button').click();
  await page.getByTestId('journal-save').click();
  const card = page.getByTestId('journal-entry').filter({ hasText: JOURNAL_BODY }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText(/private/i);

  // Edit.
  await card.getByTestId('journal-entry-menu').click();
  await page.getByTestId('journal-entry-edit').click();
  await page.getByTestId('journal-entry-edit-body').fill(`Second draft. ${JOURNAL_BODY}`);
  await page.getByTestId('journal-entry-edit-save').click();
  await expect(page.getByTestId('journal-entry').filter({ hasText: `Second draft. ${JOURNAL_BODY}` })).toBeVisible();

  // Private-only filter shows it; everything shown is private.
  await page.getByTestId('journal-filter-private').click();
  const cards = page.getByTestId('journal-entry');
  await expect(cards.first()).toBeVisible();
  const n = await cards.count();
  for (let i = 0; i < Math.min(n, 5); i++) await expect(cards.nth(i)).toContainText(/private/i);
  await page.getByTestId('journal-filter-private').click();

  // Delete.
  const target = page.getByTestId('journal-entry').filter({ hasText: JOURNAL_BODY }).first();
  await target.getByTestId('journal-entry-menu').click();
  await page.getByTestId('journal-entry-delete').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('journal-entry').filter({ hasText: JOURNAL_BODY })).toHaveCount(0);
  const journal = await api(ctx, 'get', '/dreamers/me/journal');
  expect(JSON.stringify(journal)).not.toContain(JOURNAL_BODY);
  await ctx.close();
});

test('phone layout: no horizontal overflow on the main dreamer pages', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await login(page, 'alicia@dreamcoach.demo');
  for (const path of ['/home', '/dreams', '/actions', '/care', '/care/energy', '/journal', '/check-in', '/sessions']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
  }
  await ctx.close();
});

test('coach: start a session from the dashboard, then delete it while empty', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'priya@dreamcoach.demo');
  await expect(page.getByTestId('coach-stats')).toBeVisible();
  const before = await api(ctx, 'get', '/coach/dashboard');
  const target = before.caseload.find((c: any) => !c.snapshot.openSession);
  const row = page.getByTestId('caseload-row').filter({ hasText: target.dreamer.name }).first();
  const card = page.getByTestId('caseload-card').filter({ hasText: target.dreamer.name }).first();
  const start = (await row.isVisible().catch(() => false)) ? row.getByTestId('caseload-start-session') : card.getByTestId('caseload-start-session');
  await start.click();
  await expect(page).toHaveURL(/\/session\/\d+$/);
  await expect(page.getByTestId('session-status')).toContainText(/in progress/i);
  await page.getByTestId('session-delete').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete session' }).click();
  await expect(page).toHaveURL(new RegExp(`/dreamers/${target.dreamer.id}`));
  const after = await api(ctx, 'get', '/coach/dashboard');
  expect(after.caseload.find((c: any) => c.dreamer.id === target.dreamer.id).snapshot.openSession).toBeNull();
  await ctx.close();
});
