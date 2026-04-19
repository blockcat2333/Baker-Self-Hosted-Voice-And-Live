/**
 * UI Audit script - captures screenshots across device sizes and tests voice join flow.
 * Run: node scripts/ui-audit.mjs
 */

import pkg from '../node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.js';
const { chromium, devices } = pkg;
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:80';
const OUT_DIR = join(__dirname, '..', 'scripts', 'screenshots');

mkdirSync(OUT_DIR, { recursive: true });

async function screenshot(page, name) {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${name}.png`);
  return path;
}

// Try direct API login; fall back to localStorage injection if API is down.
async function doLogin(page, email, password) {
  // Try to get tokens via fetch in the browser (works when API is up)
  const apiUp = await page.evaluate(async (args) => {
    try {
      const res = await fetch(`http://localhost:3001/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: args.email, password: args.password }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.tokens?.accessToken && data?.user) {
        localStorage.setItem('baker_access_token', data.tokens.accessToken);
        localStorage.setItem('baker_refresh_token', data.tokens.refreshToken);
        localStorage.setItem('baker_auth_user', JSON.stringify(data.user));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, { email, password });

  if (!apiUp) {
    // API is down — inject fake tokens so ChatShell renders for layout inspection
    await page.evaluate((args) => {
      localStorage.setItem('baker_access_token', 'fake-token-for-layout-audit');
      localStorage.setItem('baker_refresh_token', 'fake-refresh');
      localStorage.setItem('baker_auth_user', JSON.stringify({
        id: 'audit-user-id',
        email: args.email,
        username: 'audit-bot',
      }));
    }, { email });
  }

  // Reload so the app picks up the tokens
  await page.reload({ waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1500);
}

async function waitForChat(page, timeout = 8000) {
  try {
    await page.waitForSelector('.chat-shell', { timeout });
    return true;
  } catch {
    return false;
  }
}

const TEST_EMAIL = 'audit@test.local';
const TEST_PASSWORD = 'password123';

async function runAudit() {
  const browser = await chromium.launch({ headless: true });

  // ─── 1. Desktop (1280×800) ───────────────────────────────────────────────
  console.log('\n▶ Desktop (1280×800)');
  {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ['microphone'],
    });
    const page = await ctx.newPage();

    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warn') {
        consoleErrors.push(`[${msg.type()}] ${msg.text().slice(0, 120)}`);
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot(page, '01-desktop-login');

    await doLogin(page, TEST_EMAIL, TEST_PASSWORD);
    const inChat = await waitForChat(page);
    console.log(`  Logged in: ${inChat}`);

    if (inChat) {
      await page.waitForTimeout(1500);
      await screenshot(page, '02-desktop-chat');

      // Measure layout
      const chatShellRect = await page.locator('.chat-shell').boundingBox();
      const guildListRect = await page.locator('.guild-list').boundingBox();
      const sidebarRect = await page.locator('.sidebar').boundingBox();
      const mainRect = await page.locator('.chat-main').boundingBox();
      console.log('  .chat-shell:', JSON.stringify(chatShellRect));
      console.log('  .guild-list:', JSON.stringify(guildListRect));
      console.log('  .sidebar:', JSON.stringify(sidebarRect));
      console.log('  .chat-main:', JSON.stringify(mainRect));

      // Try clicking a voice channel
      const voiceChannels = page.locator('.channel-btn--voice');
      const vcCount = await voiceChannels.count();
      console.log(`  Voice channels: ${vcCount}`);
      const allChannels = await page.locator('.channel-btn').all();
      console.log(`  All channels: ${allChannels.length}`);

      if (vcCount > 0) {
        await voiceChannels.first().click();
        await page.waitForTimeout(1000);
        await screenshot(page, '03-desktop-voice-join');

        const voiceLabel = await page.locator('.voice-panel-label').textContent().catch(() => 'not found');
        console.log(`  Voice status after click: "${voiceLabel}"`);

        await page.waitForTimeout(3000);
        await screenshot(page, '03b-desktop-voice-3s');
        const voiceLabel2 = await page.locator('.voice-panel-label').textContent().catch(() => 'not found');
        console.log(`  Voice status after 3s: "${voiceLabel2}"`);
      }
    }

    console.log('  Console issues:', consoleErrors.slice(0, 5));
    await ctx.close();
  }

  // ─── 2. Tablet (768×1024) ────────────────────────────────────────────────
  console.log('\n▶ Tablet (768×1024)');
  {
    const ctx = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      permissions: ['microphone'],
    });
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot(page, '04-tablet-login');
    await doLogin(page, TEST_EMAIL, TEST_PASSWORD);
    await waitForChat(page);
    await page.waitForTimeout(1500);
    await screenshot(page, '05-tablet-chat');

    // Check if mobile CSS kicks in at 768
    const channelListDir = await page.locator('.channel-list').evaluate(el =>
      window.getComputedStyle(el).flexDirection
    ).catch(() => 'n/a');
    const guildListDir = await page.locator('.guild-list').evaluate(el =>
      window.getComputedStyle(el).flexDirection
    ).catch(() => 'n/a');
    console.log(`  .channel-list flex-direction: ${channelListDir}`);
    console.log(`  .guild-list flex-direction: ${guildListDir}`);

    const chatShellDir = await page.locator('.chat-shell').evaluate(el =>
      window.getComputedStyle(el).flexDirection
    ).catch(() => 'n/a');
    console.log(`  .chat-shell flex-direction: ${chatShellDir}`);

    await ctx.close();
  }

  // ─── 3. Mobile (375×812 - iPhone X) ─────────────────────────────────────
  console.log('\n▶ Mobile (375×812 - iPhone X)');
  {
    const iphoneX = devices['iPhone X'];
    const ctx = await browser.newContext({
      ...iphoneX,
      permissions: ['microphone'],
    });
    const page = await ctx.newPage();

    const consoleIssues = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warn') {
        consoleIssues.push(`[${msg.type()}] ${msg.text().slice(0, 120)}`);
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await screenshot(page, '06-mobile-login');

    await doLogin(page, TEST_EMAIL, TEST_PASSWORD);
    const inChat = await waitForChat(page);
    console.log(`  Logged in: ${inChat}`);

    if (inChat) {
      await page.waitForTimeout(1500);
      await screenshot(page, '07-mobile-chat');

      // Measure layout
      const vpWidth = await page.evaluate(() => window.innerWidth);
      const vpHeight = await page.evaluate(() => window.innerHeight);
      console.log(`  Viewport: ${vpWidth}×${vpHeight}`);

      const chatShellDir = await page.locator('.chat-shell').evaluate(el =>
        window.getComputedStyle(el).flexDirection
      ).catch(() => 'n/a');
      const channelListDir = await page.locator('.channel-list').evaluate(el =>
        window.getComputedStyle(el).flexDirection
      ).catch(() => 'n/a');
      const guildListDir = await page.locator('.guild-list').evaluate(el =>
        window.getComputedStyle(el).flexDirection
      ).catch(() => 'n/a');
      const sidebarWidth = await page.locator('.sidebar').evaluate(el =>
        window.getComputedStyle(el).width
      ).catch(() => 'n/a');

      console.log(`  .chat-shell flex-direction: ${chatShellDir}`);
      console.log(`  .channel-list flex-direction: ${channelListDir}`);
      console.log(`  .guild-list flex-direction: ${guildListDir}`);
      console.log(`  .sidebar width: ${sidebarWidth}`);

      // Check chat main height - is there space for chat?
      const chatMainRect = await page.locator('.chat-main').boundingBox().catch(() => null);
      const sidebarRect = await page.locator('.sidebar').boundingBox().catch(() => null);
      const sidebarBottomRect = await page.locator('.sidebar-bottom').boundingBox().catch(() => null);
      console.log(`  .chat-main rect: ${JSON.stringify(chatMainRect)}`);
      console.log(`  .sidebar rect: ${JSON.stringify(sidebarRect)}`);
      console.log(`  .sidebar-bottom rect: ${JSON.stringify(sidebarBottomRect)}`);

      // Try clicking a voice channel on mobile
      const voiceChannels = page.locator('.channel-btn--voice');
      const vcCount = await voiceChannels.count();
      console.log(`  Voice channels: ${vcCount}`);

      if (vcCount > 0) {
        console.log('  Clicking voice channel on mobile...');
        await voiceChannels.first().click();
        await page.waitForTimeout(300);
        await screenshot(page, '08-mobile-voice-click');

        const vpCount = await page.locator('.voice-panel').count();
        const vpLabel = await page.locator('.voice-panel-label').textContent().catch(() => 'not visible');
        console.log(`  VoicePanel visible: ${vpCount > 0}, label: "${vpLabel}"`);

        await page.waitForTimeout(4000);
        await screenshot(page, '09-mobile-voice-4s');
        const vpCount2 = await page.locator('.voice-panel').count();
        const vpLabel2 = await page.locator('.voice-panel-label').textContent().catch(() => 'not visible');
        console.log(`  After 4s - VoicePanel: ${vpCount2 > 0}, label: "${vpLabel2}"`);

        // Check if there's any error state visible
        const errorText = await page.locator('.voice-error, [class*="error"]').textContent().catch(() => 'none');
        console.log(`  Error text: "${errorText}"`);
      }
    }

    console.log('  Console issues:', consoleIssues.slice(0, 10));
    await ctx.close();
  }

  // ─── 4. Mobile Small (390×844) ────────────────────────────────────────────
  console.log('\n▶ Mobile Small (390×844)');
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      permissions: ['microphone'],
    });
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await doLogin(page, TEST_EMAIL, TEST_PASSWORD);
    await waitForChat(page);
    await page.waitForTimeout(1500);
    await screenshot(page, '10-mobile390-chat');

    // Key layout checks
    const sendBoxRect = await page.locator('.send-box').boundingBox().catch(() => null);
    const chatMainRect = await page.locator('.chat-main').boundingBox().catch(() => null);
    const sidebarRect = await page.locator('.sidebar').boundingBox().catch(() => null);
    const vpHeight = await page.evaluate(() => window.innerHeight);

    console.log(`  viewport height: ${vpHeight}`);
    console.log(`  .sidebar rect: ${JSON.stringify(sidebarRect)}`);
    console.log(`  .chat-main rect: ${JSON.stringify(chatMainRect)}`);
    console.log(`  .send-box rect: ${JSON.stringify(sendBoxRect)}`);

    await ctx.close();
  }

  // ─── 5. Desktop wide (1440×900) ────────────────────────────────────────
  console.log('\n▶ Desktop wide (1440×900)');
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ['microphone'],
    });
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    await doLogin(page, TEST_EMAIL, TEST_PASSWORD);
    await waitForChat(page);
    await page.waitForTimeout(1500);
    await screenshot(page, '11-desktop-wide-chat');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n✅ Screenshots saved to scripts/screenshots/`);
  console.log(`   View them at: ${OUT_DIR}`);
}

runAudit().catch((err) => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
