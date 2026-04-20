/**
 * Mobile-focused UI audit.
 *
 * Registers a fresh user, then screenshots login + signed-in chat at:
 *   320x568, 375x667, 390x844, 428x926, 768x1024, 1280x800
 * For each viewport, asserts no horizontal overflow on .chat-shell / body.
 *
 * Output dir defaults to output/playwright/mobile-audit (override via OUT_DIR).
 *
 * Usage:
 *   BASE_URL=http://localhost:3234 OUT_DIR=output/playwright/after node scripts/mobile-audit.mjs
 */

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..');

function readRuntimePort() {
  const path = join(repoRoot, 'output', 'dev', 'runtime-ports.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const runtime = readRuntimePort();
const webPort = process.env.WEB_PORT ?? (runtime?.webPort ? String(runtime.webPort) : '80');
const BASE_URL = process.env.BASE_URL ?? (webPort === '80' ? 'http://localhost' : `http://localhost:${webPort}`);
const OUT_DIR = resolve(process.env.OUT_DIR ?? join(repoRoot, 'output', 'playwright', 'mobile-audit'));

mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '428x926', width: 428, height: 926 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
];
const VOICE_VIEWPORTS = VIEWPORTS.filter((viewport) => viewport.width <= 428);

function uniqueEmail() {
  return `mobile-${Date.now()}@test.local`;
}

async function checkOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const docW = document.documentElement.clientWidth;
    const bodyScrollW = document.documentElement.scrollWidth;
    const offenders = [];
    if (bodyScrollW > docW + 1) {
      // Find candidates wider than viewport
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.right > docW + 1 && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
          offenders.push({
            tag: el.tagName,
            cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
            right: Math.round(r.right),
            width: Math.round(r.width),
          });
          if (offenders.length >= 5) break;
        }
      }
    }
    return { docW, bodyScrollW, offenders };
  });
  if (overflow.bodyScrollW > overflow.docW + 1) {
    console.warn(
      `  ⚠ overflow ${label}: doc=${overflow.docW} scrollW=${overflow.bodyScrollW}  offenders=${JSON.stringify(overflow.offenders)}`,
    );
    return overflow;
  }
  return null;
}

async function measureChatLayout(page) {
  return page.evaluate(() => {
    const get = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      messagePanel: get('.message-panel') ?? get('.message-panel-empty'),
      messageScroll: get('.message-scroll'),
      sendBox: get('.send-box'),
      mobileTabBar: get('.mobile-tabbar'),
    };
  });
}

async function measureVoiceLayout(page) {
  return page.evaluate(() => {
    const get = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };

    const voiceControls = get('.voice-panel-controls');
    const tabBar = get('.mobile-tabbar');

    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      voicePanel: get('.voice-panel'),
      voiceControls,
      streamPanel: get('.stream-panel'),
      mobileTabBar: tabBar,
      voiceControlsVisible:
        !!voiceControls && !!tabBar ? voiceControls.top >= 0 && voiceControls.bottom <= tabBar.top : false,
    };
  });
}

async function joinVoiceOnMobile(page) {
  await page.locator('.mobile-tabbar-btn').nth(0).click();
  await page.waitForTimeout(250);
  await page.locator('.channel-btn--voice').first().click();
  await page.waitForSelector('.voice-panel-controls', { timeout: 30000 });
  await page.waitForTimeout(500);
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // 1. Register a user once at desktop size so we have a session for the
  //    signed-in screenshots. Then keep that storage and resize.
  const email = uniqueEmail();
  const password = 'password123';
  const username = 'mobile-bot';

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Output:   ${OUT_DIR}`);
  console.log(`Email:    ${email}`);

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.login-card', { timeout: 30000 });

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
  await page.waitForSelector('.chat-shell', { timeout: 30000 });

  console.log('Signed in. Capturing chat screenshots...');

  let totalOverflow = 0;
  let hiddenVoiceControls = 0;

  // 2. Chat screenshots at each viewport
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(250);
    const bad = await checkOverflow(page, `chat ${vp.name}`);
    if (bad) totalOverflow += 1;
    const layout = await measureChatLayout(page);
    console.log(`  chat ${vp.name} layout=${JSON.stringify(layout)}`);
    await page.screenshot({ path: join(OUT_DIR, `chat-${vp.name}.png`), fullPage: false });
  }

  // 3. Join voice once, then verify the dedicated Voice tab keeps core controls
  // visible on phone-sized screens.
  await page.setViewportSize({ width: 390, height: 844 });
  await joinVoiceOnMobile(page);

  console.log('Joined voice. Capturing voice-tab screenshots...');
  for (const vp of VOICE_VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(250);
    await page.locator('.mobile-tabbar-btn').nth(2).click();
    await page.waitForTimeout(250);
    const bad = await checkOverflow(page, `voice ${vp.name}`);
    if (bad) totalOverflow += 1;
    const layout = await measureVoiceLayout(page);
    console.log(`  voice ${vp.name} layout=${JSON.stringify(layout)}`);
    if (!layout.voiceControlsVisible) {
      hiddenVoiceControls += 1;
      console.warn(`  !! voice controls not fully visible at ${vp.name}`);
    }
    await page.screenshot({ path: join(OUT_DIR, `voice-${vp.name}.png`), fullPage: false });
  }

  // 4. Logout, then login screenshots at each viewport
  await page.setViewportSize({ width: 1280, height: 800 });
  // logout via UI: button could be .sidebar-footer-signout OR mobile tabbar
  const signOutBtn = page.locator('button.sidebar-footer-signout').first();
  if (await signOutBtn.isVisible().catch(() => false)) {
    await signOutBtn.click();
  } else {
    await page.evaluate(() => {
      sessionStorage.clear();
      location.reload();
    });
  }
  await page.waitForSelector('.login-card', { timeout: 30000 });

  console.log('Signed out. Capturing login screenshots...');
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(200);
    const bad = await checkOverflow(page, `login ${vp.name}`);
    if (bad) totalOverflow += 1;
    await page.screenshot({ path: join(OUT_DIR, `login-${vp.name}.png`), fullPage: false });
  }

  await context.close();
  await browser.close();

  if (totalOverflow > 0 || hiddenVoiceControls > 0) {
    if (hiddenVoiceControls > 0) {
      console.error(`FAIL: ${hiddenVoiceControls} voice viewport(s) hid the mute/leave controls below the first screen`);
    }
    if (totalOverflow > 0) {
      console.error(`FAIL: ${totalOverflow} viewport(s) had horizontal overflow`);
    }
    process.exit(2);
  }
  console.log('OK: no horizontal overflow detected and voice controls stayed visible on phone-sized screens');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
