/**
 * Sidebar footer layout reproduction script.
 * Logs in with a real long-username account, then captures screenshots at critical widths.
 * Run: node scripts/sidebar-repro.mjs
 */
import pkg from '../node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3233';
const API_URL = 'http://localhost:3001';
const OUT_DIR = join(__dirname, '..', 'scripts', 'sidebar-screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const TEST_EMAIL = 'long.username@example.com';
const TEST_PASSWORD = 'password123';

const WIDTHS = [700, 768, 820, 900, 1280];
const LANGUAGES = ['en', 'zh'];

async function screenshot(page, name) {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${name}.png`);
  return path;
}

async function loginViaAPI(page, email, password) {
  // Login through the API, then inject tokens into localStorage
  const result = await page.evaluate(async (args) => {
    try {
      const res = await fetch(`${args.apiUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: args.email, password: args.password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, error: err.message || res.status };
      }
      const data = await res.json();
      if (data?.tokens?.accessToken && data?.user) {
        localStorage.setItem('baker_access_token', data.tokens.accessToken);
        localStorage.setItem('baker_refresh_token', data.tokens.refreshToken);
        localStorage.setItem('baker_auth_user', JSON.stringify(data.user));
        return { ok: true, user: data.user };
      }
      return { ok: false, error: 'missing tokens/user' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, { apiUrl: API_URL, email, password });

  return result;
}

async function setLanguage(page, lang) {
  await page.evaluate((l) => {
    localStorage.setItem('baker_language', l);
  }, lang);
}

async function waitForChat(page, timeout = 10000) {
  try {
    await page.waitForSelector('.chat-shell', { timeout });
    return true;
  } catch {
    return false;
  }
}

async function measureSidebarFooter(page) {
  return page.evaluate(() => {
    const results = {};

    const sidebar = document.querySelector('.sidebar');
    const footer = document.querySelector('.sidebar-footer');
    const accountPanel = document.querySelector('.account-panel');
    const editBtn = document.querySelector('.account-panel-edit-btn');
    const footerActions = document.querySelector('.sidebar-footer-actions');
    const signout = document.querySelector('.sidebar-footer-signout');
    const langSwitcher = document.querySelector('.language-switcher');

    function getRect(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    }

    results.sidebar = getRect(sidebar);
    results.footer = getRect(footer);
    results.accountPanel = getRect(accountPanel);
    results.editBtn = getRect(editBtn);
    results.footerActions = getRect(footerActions);
    results.signout = getRect(signout);
    results.langSwitcher = getRect(langSwitcher);

    // Check overflows
    if (sidebar && accountPanel) {
      const sidebarRight = sidebar.getBoundingClientRect().right;
      const acctRight = accountPanel.getBoundingClientRect().right;
      results.accountPanelOverflows = acctRight > sidebarRight + 1;
    }
    if (sidebar && editBtn) {
      const sidebarRight = sidebar.getBoundingClientRect().right;
      const editRight = editBtn.getBoundingClientRect().right;
      results.editBtnOverflows = editRight > sidebarRight + 1;
      // Also check if edit btn is inside the account panel
      const acctRight = accountPanel?.getBoundingClientRect().right ?? sidebarRight;
      results.editBtnOutsidePanel = editRight > acctRight + 2;
    }
    if (sidebar && footerActions) {
      const sidebarRight = sidebar.getBoundingClientRect().right;
      const actionsRight = footerActions.getBoundingClientRect().right;
      results.footerActionsOverflows = actionsRight > sidebarRight + 1;
    }

    // Check computed styles
    if (footer) {
      const cs = window.getComputedStyle(footer);
      results.footerStyles = {
        display: cs.display,
        flexDirection: cs.flexDirection,
        gap: cs.gap,
        padding: cs.padding,
        overflow: cs.overflow,
      };
    }
    if (accountPanel) {
      const cs = window.getComputedStyle(accountPanel);
      results.accountPanelStyles = {
        display: cs.display,
        gap: cs.gap,
        padding: cs.padding,
        width: cs.width,
        maxWidth: cs.maxWidth,
        overflow: cs.overflow,
      };
    }

    return results;
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });

  for (const lang of LANGUAGES) {
    for (const width of WIDTHS) {
      const label = `${lang}-${width}`;
      console.log(`\n▶ ${label}`);

      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
      });
      const page = await ctx.newPage();

      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });

      // Set language first
      await setLanguage(page, lang);

      // Login
      const loginResult = await loginViaAPI(page, TEST_EMAIL, TEST_PASSWORD);
      if (!loginResult.ok) {
        console.log(`  ❌ Login failed: ${loginResult.error}`);
        await ctx.close();
        continue;
      }
      console.log(`  ✓ Logged in as ${loginResult.user.username} (${loginResult.user.email})`);

      // Reload to pick up tokens and language
      await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(2000);

      const inChat = await waitForChat(page);
      if (!inChat) {
        console.log('  ❌ Chat shell not rendered');
        await screenshot(page, `${label}-failed`);
        await ctx.close();
        continue;
      }

      // Full page screenshot
      await screenshot(page, `${label}-full`);

      // Sidebar-bottom focused screenshot
      const sidebarBottom = await page.locator('.sidebar-bottom').boundingBox().catch(() => null);
      if (sidebarBottom) {
        const clipY = Math.max(0, sidebarBottom.y - 10);
        const clipHeight = Math.min(sidebarBottom.height + 20, 900 - clipY);
        await page.screenshot({
          path: join(OUT_DIR, `${label}-sidebar-bottom.png`),
          clip: {
            x: 0,
            y: clipY,
            width: Math.min(width, 400),
            height: clipHeight,
          },
        });
        console.log(`  📸 ${label}-sidebar-bottom.png`);
      }

      const measurements = await measureSidebarFooter(page);
      console.log('  Layout issues:');
      if (measurements.accountPanelOverflows) console.log('    ⚠ Account panel overflows sidebar');
      if (measurements.editBtnOverflows) console.log('    ⚠ Edit button overflows sidebar');
      if (measurements.editBtnOutsidePanel) console.log('    ⚠ Edit button outside account panel bounds');
      if (measurements.footerActionsOverflows) console.log('    ⚠ Footer actions overflow sidebar');
      console.log('  sidebar:', JSON.stringify(measurements.sidebar));
      console.log('  accountPanel:', JSON.stringify(measurements.accountPanel));
      console.log('  editBtn:', JSON.stringify(measurements.editBtn));
      console.log('  footerActions:', JSON.stringify(measurements.footerActions));
      console.log('  signout:', JSON.stringify(measurements.signout));
      console.log('  langSwitcher:', JSON.stringify(measurements.langSwitcher));
      console.log('  footerStyles:', JSON.stringify(measurements.footerStyles));
      console.log('  accountPanelStyles:', JSON.stringify(measurements.accountPanelStyles));

      await ctx.close();
    }
  }

  await browser.close();
  console.log(`\n✅ Screenshots saved to ${OUT_DIR}`);
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
