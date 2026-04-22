import { chromium, devices } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
const webPort = process.env.WEB_PORT ?? (runtime?.webPort ? String(runtime.webPort) : '80');
const BASE_URL = process.env.BASE_URL ?? (webPort === '80' ? 'http://localhost' : `http://localhost:${webPort}`);
const OUT_DIR = resolve(process.env.OUT_DIR ?? join(repoRoot, 'output', 'playwright', 'camera-switch-smoke'));

mkdirSync(OUT_DIR, { recursive: true });

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}@test.local`;
}

async function writeDiagnostics(page, scenarioDir, filename, extra = {}) {
  const diagnostics = await page.evaluate(() => ({
    bodyClassName: document.body.className,
    gatewayBanner: document.querySelector('.gateway-banner')?.textContent?.trim() ?? null,
    streamPanelError: document.querySelector('.stream-panel-error')?.textContent?.trim() ?? null,
    streamShareActionsVisible: !!document.querySelector('.stream-share-actions'),
    streamPanelText: document.querySelector('.stream-panel')?.textContent?.trim() ?? null,
    url: window.location.href,
    voiceError: document.querySelector('.voice-panel--error')?.textContent?.trim() ?? null,
    voicePanelText: document.querySelector('.voice-panel')?.textContent?.trim() ?? null,
  }));

  writeFileSync(join(scenarioDir, filename), JSON.stringify({ ...diagnostics, ...extra }, null, 2));
}

async function registerAndEnterChat(page, prefix) {
  const email = uniqueEmail(prefix);
  const password = 'password123';
  const username = prefix;

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForSelector('.login-card', { timeout: 30_000 });

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
  await page.waitForSelector('.chat-shell', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.gateway-banner'), undefined, { timeout: 30_000 });

  return { email, username };
}

async function joinFirstVoiceChannel(page, isMobile) {
  if (isMobile) {
    await page.locator('.mobile-tabbar-btn').nth(0).click();
    await page.waitForTimeout(250);
  }

  const voiceButton = page.locator('button.channel-btn--voice').first();
  await voiceButton.waitFor({ timeout: 30_000 });
  await voiceButton.click();

  await page.waitForSelector('.voice-panel', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!document.querySelector('.stream-share-actions') || !!document.querySelector('.voice-panel--error'),
    undefined,
    { timeout: 30_000 },
  );

  const voiceError = await page.locator('.voice-panel--error').textContent().catch(() => null);
  if (voiceError) {
    throw new Error(`Voice join failed: ${voiceError.trim()}`);
  }
}

async function runScenario(browser, label, contextOptions) {
  const scenarioDir = join(OUT_DIR, label);
  mkdirSync(scenarioDir, { recursive: true });

  const context = await browser.newContext(contextOptions);
  await context.grantPermissions(['camera', 'microphone'], { origin: BASE_URL });
  await context.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) {
      return;
    }

    const originalEnumerateDevices = mediaDevices.enumerateDevices?.bind(mediaDevices);
    const originalGetUserMedia = mediaDevices.getUserMedia?.bind(mediaDevices);
    if (!originalEnumerateDevices || !originalGetUserMedia) {
      return;
    }

    const fakeDevices = [
      { deviceId: 'front-camera', groupId: 'camera-group', kind: 'videoinput', label: 'Front Camera' },
      { deviceId: 'rear-camera', groupId: 'camera-group', kind: 'videoinput', label: 'Rear Camera' },
    ];

    Object.defineProperty(globalThis, '__cameraSmokeRequests', {
      configurable: true,
      value: [],
      writable: true,
    });

    mediaDevices.enumerateDevices = async () => [
      ...fakeDevices,
      ...(await originalEnumerateDevices()).filter((device) => device.kind !== 'videoinput'),
    ];

    mediaDevices.getUserMedia = async (constraints) => {
      globalThis.__cameraSmokeRequests.push(JSON.parse(JSON.stringify(constraints)));
      const actualConstraints = JSON.parse(JSON.stringify(constraints ?? {}));
      if (actualConstraints.video && typeof actualConstraints.video === 'object') {
        delete actualConstraints.video.deviceId;
        delete actualConstraints.video.facingMode;
      }
      return originalGetUserMedia(actualConstraints);
    };
  });

  const page = await context.newPage();

  try {
    const account = await registerAndEnterChat(page, `camera-${label}`);
    const isMobile = contextOptions.isMobile === true;

    await joinFirstVoiceChannel(page, isMobile);

    const cameraSelect = page.locator('.stream-camera-controls select').first();
    await cameraSelect.waitFor({ timeout: 30_000 });
    await cameraSelect.selectOption('device:front-camera');

    await page.locator('.stream-share-actions .stream-action-btn').nth(1).click();
    await page.waitForSelector('.stream-card--owned', { timeout: 30_000 });
    await page.waitForTimeout(1_000);

    const liveCameraSelect = page.locator('.stream-card--owned .stream-camera-controls select').first();
    await liveCameraSelect.selectOption('device:rear-camera');

    await page.waitForFunction(
      () => Array.isArray(globalThis.__cameraSmokeRequests) && globalThis.__cameraSmokeRequests.length >= 2,
      undefined,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(1_000);

    const requests = await page.evaluate(() => globalThis.__cameraSmokeRequests);
    const videoRequests = Array.isArray(requests)
      ? requests.filter((request) => request && request.video && request.video !== false)
      : [];
    if (videoRequests.length < 2) {
      throw new Error(`Expected at least two camera capture requests for ${label}.`);
    }

    const firstRequest = videoRequests[0];
    const lastRequest = videoRequests[videoRequests.length - 1];
    const firstDeviceId = firstRequest?.video?.deviceId?.exact ?? null;
    const lastDeviceId = lastRequest?.video?.deviceId?.exact ?? null;

    if (firstDeviceId !== 'front-camera') {
      throw new Error(`Expected first camera request to target front-camera, got ${String(firstDeviceId)}.`);
    }

    if (lastDeviceId !== 'rear-camera') {
      throw new Error(`Expected switched camera request to target rear-camera, got ${String(lastDeviceId)}.`);
    }

    const stopSharingButton = page.locator('.stream-card--owned .stream-action-btn').first();
    if (!(await stopSharingButton.isVisible())) {
      throw new Error(`Expected owned stream card to remain visible after camera switch for ${label}.`);
    }

    await page.screenshot({ path: join(scenarioDir, 'camera-switched.png'), fullPage: true });
    writeFileSync(
      join(scenarioDir, 'camera-requests.json'),
      JSON.stringify(
        {
          account,
          baseUrl: BASE_URL,
          requests,
          videoRequests,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await page.screenshot({ path: join(scenarioDir, 'failure.png'), fullPage: true }).catch(() => {});
    await writeDiagnostics(page, scenarioDir, 'failure-diagnostics.json', {
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });

  try {
    await runScenario(browser, 'desktop', {
      viewport: { width: 1440, height: 960 },
    });
    await runScenario(browser, 'mobile', {
      ...devices['iPhone 13'],
    });
  } finally {
    await browser.close();
  }

  console.log(`OK camera switch smoke: ${BASE_URL}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
