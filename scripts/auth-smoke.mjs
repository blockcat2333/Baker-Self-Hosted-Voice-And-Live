/**
 * Auth smoke test (web UI) - registers, logs out, logs back in.
 *
 * Prereqs:
 * - Web reachable at BASE_URL (default derived from WEB_PORT, typically http://localhost)
 * - API must be running and reachable by the web dev server (e.g., via Vite proxy)
 *
 * Run:
 *   BASE_URL=http://localhost:5173 node scripts/auth-smoke.mjs
 */

import { chromium } from '@playwright/test';

const webPort = process.env.WEB_PORT ?? '80';
const defaultBaseUrl = webPort === '80' ? 'http://localhost' : `http://localhost:${webPort}`;
const BASE_URL = process.env.BASE_URL ?? defaultBaseUrl;

function uniqueEmail() {
  const ts = Date.now();
  return `smoke-${ts}@test.local`;
}

async function assertNoFetchFailure(page) {
  const error = await page.locator('.login-error').first().textContent().catch(() => null);
  if (error && error.includes('Failed to fetch')) {
    throw new Error(`Auth UI showed network error: "${error}"`);
  }
}

async function maybeSmokeAdminPanel(context) {
  if (process.env.SKIP_ADMIN_SMOKE === '1') return;

  const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:5180';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'admin';

  const page = await context.newPage();
  await page.goto(adminUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

  await page.waitForSelector('.admin-login-card', { timeout: 20000 });
  await page.locator('input[type="password"]').fill(adminPassword);
  await page.locator('button[type="submit"]').click();

  await page.waitForSelector('.admin-shell--dashboard', { timeout: 20000 });

  const error = await page.locator('.admin-error').first().textContent().catch(() => null);
  if (error && error.trim()) {
    throw new Error(`Admin panel showed error: "${error.trim()}"`);
  }
}

async function run() {
  const headless = process.env.HEADLESS !== '0' && process.env.HEADED !== '1';
  const browser = await chromium.launch({
    headless,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const email = uniqueEmail();
  const password = 'password123';
  const username = 'smoke-user';

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForSelector('.login-card', { timeout: 20000 });

  // Switch to register (when enabled).
  const tabs = page.locator('.login-tabs .tab');
  if ((await tabs.count()) >= 2) {
    await tabs.nth(1).click();
  }

  await page.locator('input[type="text"]').first().fill(username);
  await page.locator('input[type="email"]').fill(email);

  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(password);
  await passwordFields.nth(1).fill(password);

  await page.locator('form.login-form button[type="submit"]').click();

  await assertNoFetchFailure(page);
  await page.waitForSelector('.chat-shell', { timeout: 20000 });

  // Logout back to login screen.
  await page.locator('button.sidebar-footer-signout').click();
  await page.waitForSelector('.login-card', { timeout: 20000 });

  // Login with the newly registered account.
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form.login-form button[type="submit"]').click();

  await assertNoFetchFailure(page);
  await page.waitForSelector('.chat-shell', { timeout: 20000 });

  await maybeSmokeAdminPanel(context);

  await context.close();
  await browser.close();
  console.log(`OK auth smoke: ${BASE_URL} (${email})`);
}

run().catch((err) => {
  console.error(`Auth smoke failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
