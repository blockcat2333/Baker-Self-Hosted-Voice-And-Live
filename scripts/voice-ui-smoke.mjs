/**
 * Voice UI smoke (real browser): register -> enter chat -> click a voice channel -> expect no voice error panel.
 *
 * This uses fake media devices so it can run unattended:
 *   --use-fake-device-for-media-stream
 *   --use-fake-ui-for-media-stream
 *
 * Run (after scripts/dev-up.ps1):
 *   node scripts/voice-ui-smoke.mjs
 *
 * Headed:
 *   HEADED=1 node scripts/voice-ui-smoke.mjs
 */

import { chromium } from '@playwright/test';

const webPort = process.env.WEB_PORT ?? '80';
const defaultBaseUrl = webPort === '80' ? 'http://localhost' : `http://localhost:${webPort}`;
const BASE_URL = process.env.BASE_URL ?? defaultBaseUrl;

function uniqueEmail() {
  return `voice-ui-${Date.now()}@test.local`;
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
  await context.grantPermissions(['microphone'], { origin: BASE_URL });

  const page = await context.newPage();

  const email = uniqueEmail();
  const password = 'password123';
  const username = 'voice-ui';

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
  await page.waitForSelector('.chat-shell', { timeout: 20000 });

  // Join the first voice channel.
  const voiceButton = page.locator('button.channel-btn--voice').first();
  await voiceButton.waitFor({ timeout: 20000 });
  await voiceButton.click();

  // Wait until either voice connects or an error panel appears.
  const voicePanel = page.locator('.voice-panel');
  await voicePanel.waitFor({ timeout: 20000 });

  const voiceError = page.locator('.voice-panel--error');
  if ((await voiceError.count()) > 0) {
    const text = await page.locator('.voice-panel-error-msg').first().textContent().catch(() => '');
    throw new Error(`Voice UI showed error panel: ${text ?? ''}`.trim());
  }

  // Give the join a moment to settle.
  await page.waitForTimeout(1500);
  if ((await voiceError.count()) > 0) {
    const text = await page.locator('.voice-panel-error-msg').first().textContent().catch(() => '');
    throw new Error(`Voice UI showed error panel after delay: ${text ?? ''}`.trim());
  }

  await context.close();
  await browser.close();
  console.log(`OK voice UI smoke: ${BASE_URL} (${email})`);
}

run().catch((err) => {
  console.error(`Voice UI smoke failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

