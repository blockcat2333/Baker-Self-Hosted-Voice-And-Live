import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readRuntimePort() {
  const path = join(repoRoot, 'output', 'dev', 'runtime-ports.json');
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

const runtime = readRuntimePort();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin';
const OUT_DIR = resolve(process.env.OUT_DIR ?? join(repoRoot, 'output', 'playwright', 'admin-channel-smoke'));
const TEMP_CHANNEL_PREFIXES = ['text-smoke-', 'voice-smoke-', 'probe-', 'debug-'];

mkdirSync(OUT_DIR, { recursive: true });

function readAdminUrlFromLatestLog() {
  const logsDir = join(repoRoot, 'output', 'dev', 'logs');
  if (!existsSync(logsDir)) {
    return null;
  }

  const latestAdminLog = readdirSync(logsDir)
    .filter((name) => name.endsWith('-admin.out.log'))
    .sort()
    .at(-1);
  if (!latestAdminLog) {
    return null;
  }

  const content = readFileSync(join(logsDir, latestAdminLog), 'utf8')
    .replace(/\x1B\[[0-9;]*m/g, '');
  const matches = [...content.matchAll(/http:\/\/localhost:(\d+)\//g)];
  const port = matches.at(-1)?.[1];
  return port ? `http://localhost:${port}` : null;
}

const adminPort = process.env.ADMIN_PORT ?? (runtime?.adminPort ? String(runtime.adminPort) : '5180');
const ADMIN_URL = process.env.ADMIN_URL ?? readAdminUrlFromLatestLog() ?? `http://localhost:${adminPort}`;

function uniqueSuffix() {
  return String(Date.now());
}

function isTempChannelName(name) {
  return TEMP_CHANNEL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

async function adminRequest(path, init = {}) {
  const response = await fetch(`${ADMIN_URL}${path}`, {
    ...init,
    headers: {
      'x-admin-password': ADMIN_PASSWORD,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.text();
  const json = payload ? JSON.parse(payload) : null;
  if (!response.ok) {
    const message =
      typeof json === 'object' && json !== null && 'message' in json
        ? String(json.message)
        : `HTTP ${response.status}`;
    throw new Error(`Admin API ${path} failed: ${message}`);
  }

  return json;
}

async function cleanupTempChannels() {
  const workspace = await adminRequest('/v1/admin/workspace');
  const tempChannels = (workspace?.channels ?? []).filter((channel) => isTempChannelName(channel.name));

  for (const channel of tempChannels) {
    await adminRequest(`/v1/admin/channels/${channel.id}`, { method: 'DELETE' });
  }
}

async function waitForDashboard(page, timeoutMs = 30_000) {
  await page.waitForSelector('.admin-shell--dashboard', { timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
}

async function reloadDashboard(page) {
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const dashboard = page.locator('.admin-shell--dashboard');
  if (!(await dashboard.isVisible().catch(() => false))) {
    await page.waitForSelector('.admin-login-card', { timeout: 30_000 });
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
  }
  await waitForDashboard(page);
  await page.evaluate(() => {
    window.confirm = () => true;
  });
}

async function waitForChannelRow(page, channelName, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = page.locator('.admin-channel-row');
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const nameInput = row.locator('input[id^="channel-name-"]').first();
      if ((await nameInput.inputValue()) === channelName) {
        return row;
      }
    }

    await page.waitForTimeout(200);
  }

  throw new Error(`Timed out waiting for channel row "${channelName}".`);
}

async function waitForChannelRowGone(page, channelName, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = page.locator('.admin-channel-row');
    const count = await rows.count();
    let found = false;
    for (let index = 0; index < count; index += 1) {
      const value = await rows.nth(index).locator('input[id^="channel-name-"]').first().inputValue();
      if (value === channelName) {
        found = true;
        break;
      }
    }

    if (!found) {
      return;
    }

    await page.waitForTimeout(200);
  }

  throw new Error(`Timed out waiting for channel row "${channelName}" to disappear.`);
}

async function ensureWorkspaceExists(page) {
  const rows = page.locator('.admin-channel-row');
  if ((await rows.count()) > 0) {
    return;
  }

  const userCard = page.locator('.admin-card').nth(1);
  const suffix = uniqueSuffix();
  const inputs = userCard.locator('input');

  await inputs.nth(0).fill(`admin-smoke-${suffix}@test.local`);
  await inputs.nth(1).fill(`admin-smoke-${suffix}`);
  await inputs.nth(2).fill('password123');
  await userCard.locator('button[type="submit"]').click();

  await page.waitForFunction(
    () => document.querySelectorAll('.admin-channel-row').length > 0,
    undefined,
    { timeout: 30_000 },
  );
}

async function loginAdmin(page) {
  await page.goto(ADMIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const dashboard = page.locator('.admin-shell--dashboard');
  if (!(await dashboard.isVisible().catch(() => false))) {
    await page.waitForSelector('.admin-login-card', { timeout: 30_000 });
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
  }
  await waitForDashboard(page);
  await page.evaluate(() => {
    window.confirm = () => true;
  });
}

async function createChannel(page, name, type, voiceQuality = 'standard') {
  const createChannelCard = page.locator('.admin-card').nth(2);
  await createChannelCard.locator('input').first().fill(name);
  const selects = createChannelCard.locator('select');
  await selects.nth(0).selectOption(type);
  if (type === 'voice') {
    await selects.nth(1).selectOption(voiceQuality);
  }
  await createChannelCard.locator('button[type="submit"]').click();
  await waitForChannelRow(page, name);
}

async function deleteChannel(page, channelName) {
  const row = await waitForChannelRow(page, channelName);
  const deleteButton = row.locator('.admin-danger-btn');
  await deleteButton.scrollIntoViewIfNeeded();
  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().includes('/v1/admin/channels/') &&
      response.status() === 200,
    { timeout: 30_000 },
  );
  await deleteButton.click();
  await deleteResponsePromise;
  await reloadDashboard(page);
  await waitForChannelRowGone(page, channelName);
}

async function collectChannelSummary(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.admin-channel-row')].map((row) => {
      const buttons = [...row.querySelectorAll('button')];
      const nameInput = row.querySelector('input[id^="channel-name-"]');
      const typeInput = row.querySelector('input[readonly]');
      const hint = row.querySelector('.admin-channel-hint');
      const deleteButton = buttons.at(-1);

      return {
        deleteDisabled: deleteButton instanceof HTMLButtonElement ? deleteButton.disabled : null,
        hint: hint?.textContent?.trim() ?? null,
        name: nameInput instanceof HTMLInputElement ? nameInput.value : null,
        type: typeInput instanceof HTMLInputElement ? typeInput.value : null,
      };
    }),
  );
}

async function run() {
  await cleanupTempChannels();

  const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  const context = await browser.newContext();
  const page = await context.newPage();

  await loginAdmin(page);

  await ensureWorkspaceExists(page);

  const suffix = uniqueSuffix();
  const textChannelName = `text-smoke-${suffix}`;
  const voiceChannelName = `voice-smoke-${suffix}`;

  await createChannel(page, textChannelName, 'text');
  await createChannel(page, voiceChannelName, 'voice', 'high');

  // Refresh once so the latest dashboard state is rendered from a clean load.
  await reloadDashboard(page);

  await page.screenshot({ path: join(OUT_DIR, 'before-delete.png'), fullPage: true });

  await deleteChannel(page, textChannelName);
  await deleteChannel(page, voiceChannelName);

  const channelSummary = await collectChannelSummary(page);
  const textRows = channelSummary.filter((item) => item.type === 'text');
  const voiceRows = channelSummary.filter((item) => item.type === 'voice');

  if (!textRows.some((item) => item.deleteDisabled)) {
    throw new Error('Expected the last remaining text channel delete action to be disabled.');
  }

  if (!voiceRows.some((item) => item.deleteDisabled)) {
    throw new Error('Expected the last remaining voice channel delete action to be disabled.');
  }

  await page.screenshot({ path: join(OUT_DIR, 'after-delete.png'), fullPage: true });
  writeFileSync(
    join(OUT_DIR, 'summary.json'),
    JSON.stringify(
      {
        adminUrl: ADMIN_URL,
        channelSummary,
      },
      null,
      2,
    ),
  );

  await context.close();
  await browser.close();
  console.log(`OK admin channel smoke: ${ADMIN_URL}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
