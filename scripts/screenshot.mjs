// Dev helper: node scripts/screenshot.mjs <url> <out.png> [width] [height] [login-email] [base]
import { chromium } from '@playwright/test';
const [, , url, out, w = '1280', h = '800', login = '', base = 'http://localhost:3005'] = process.argv;
const exe = process.env.PW_CHROMIUM ?? (await import('node:fs')).existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
if (login) {
  await page.goto(`${base}/login`);
  await page.fill('#email', login);
  await page.fill('#password', 'dream2026');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.toString().includes('/login'));
}
await page.goto(url.startsWith('http') ? url : base + url, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('saved', out);
