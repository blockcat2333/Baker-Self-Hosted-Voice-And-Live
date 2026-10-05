/* global process, URL, console, document, innerWidth, Event */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Local Vite UI fixture, with Chromium's virtual microphone and a local join
// acknowledgement. No account, running gateway or external server is needed.
const baseUrl = process.env.NOISE_UI_BASE_URL ?? 'http://127.0.0.1:4318';
const clientPath = fileURLToPath(new URL('../packages/client/src/', import.meta.url)).replaceAll('\\', '/');
const sourceUrl = `/@fs/${clientPath}`;
const browser = await chromium.launch({
  channel: process.env.AUDIO_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 } });
  await context.grantPermissions(['microphone'], { origin: baseUrl });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser error:', error.message); });
  page.on('console', (message) => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  const workletRequests = [];
  page.on('request', (request) => {
    // Vite's ?worker&url import is a tiny URL wrapper, not the model itself.
    if (request.url().includes('rnnoise-worklet') && request.url().includes('worker_file')) workletRequests.push(request.url());
  });
  // Prevent the normal app entry from initializing network/session effects;
  // the actual shared controls and stores are mounted below instead.
  await page.route('**/src/main.tsx*', (route) => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.goto(baseUrl);
  await page.addScriptTag({ type: 'module', content: `
    import '${sourceUrl}app/app.css';
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { i18n } from '${sourceUrl}i18n/index.ts';
    import { VoiceAudioDeviceControls } from '${sourceUrl}features/voice/VoicePanel.tsx';
    import { useVoiceStore } from '${sourceUrl}features/voice/voice-store.ts';
    import { useGatewayStore } from '${sourceUrl}features/gateway/gateway-store.ts';
    import { useAuthStore } from '${sourceUrl}features/auth/auth-store.ts';
    await i18n.changeLanguage('zh');
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await capture(...args);
      globalThis.noiseCapture = stream;
      return stream;
    };
    const nodes = [];
    const OriginalNode = AudioWorkletNode;
    globalThis.AudioWorkletNode = class extends OriginalNode { constructor(...args) { super(...args); nodes.push(this); } };
    const root = document.querySelector('#root');
    root.style.cssText = 'padding:24px;background:#151923;min-height:100vh;color:white;';
    ReactDOM.createRoot(root).render(React.createElement(VoiceAudioDeviceControls));
    useAuthStore.setState({ user: { id: '22222222-2222-4222-8222-222222222222', username: 'noise-smoke', email: 'noise-smoke@test.local' } });
    useGatewayStore.setState({ status: 'ready' });
    globalThis.noiseUi = { useVoiceStore, useGatewayStore, nodes };
  ` });
  await page.waitForFunction(() => Boolean(globalThis.noiseUi));
  const select = page.getByLabel('麦克风降噪');
  await select.waitFor();
  console.log('Mounted microphone controls');
  assert.equal(await select.inputValue(), 'browser');
  assert.equal(workletRequests.length, 0, 'Default UI does not load RNNoise');
  await page.evaluate(async () => {
    globalThis.noiseUi.useGatewayStore.setState({ status: 'ready' });
    await globalThis.noiseUi.useVoiceStore.getState().joinVoiceChannel('11111111-1111-4111-8111-111111111111', async () => ({
      channelId: '11111111-1111-4111-8111-111111111111', iceServers: [], mediaMode: 'p2p',
      sessionId: '33333333-3333-4333-8333-333333333333', participants: [],
    }), () => {});
  });
  const joinState = await page.evaluate(() => ({ status: globalThis.noiseUi.useVoiceStore.getState().status, error: globalThis.noiseUi.useVoiceStore.getState().error }));
  console.log('Joined fixture:', joinState);
  assert.equal(joinState.status, 'active', joinState.error);
  await select.selectOption('rnnoise');
  console.log('Selected RNNoise');
  await page.waitForFunction(() => globalThis.noiseUi.useVoiceStore.getState().noiseSuppressionMode === 'rnnoise' && !globalThis.noiseUi.useVoiceStore.getState().isAudioInputChanging);
  const rnnoiseSettings = await page.evaluate(() => globalThis.noiseCapture.getAudioTracks()[0].getSettings());
  assert.equal(rnnoiseSettings.noiseSuppression, false);
  assert.equal(rnnoiseSettings.echoCancellation, true);
  assert.equal(rnnoiseSettings.autoGainControl, true);
  await mkdir(new URL('../output/playwright/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../output/playwright/voice-rnnoise-mobile.png', import.meta.url)) });
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert.ok(fits, 'Controls fit a 390px viewport');
  await select.selectOption('browser');
  await page.waitForFunction(() => globalThis.noiseUi.useVoiceStore.getState().noiseSuppressionMode === 'browser' && !globalThis.noiseUi.useVoiceStore.getState().isAudioInputChanging);
  assert.equal(await page.evaluate(() => globalThis.noiseCapture.getAudioTracks()[0].getSettings().noiseSuppression), true);
  await select.selectOption('rnnoise');
  await page.waitForFunction(() => globalThis.noiseUi.useVoiceStore.getState().noiseSuppressionMode === 'rnnoise' && !globalThis.noiseUi.useVoiceStore.getState().isAudioInputChanging);
  await page.evaluate(() => globalThis.noiseUi.nodes.at(-1).dispatchEvent(new Event('processorerror')));
  await page.getByRole('alert').waitFor();
  await page.waitForFunction(() => !globalThis.noiseUi.useVoiceStore.getState().isAudioInputChanging);
  assert.equal(await select.inputValue(), 'browser');
  assert.match(await page.getByRole('alert').innerText(), /普通降噪/);
  await page.evaluate(async () => globalThis.noiseUi.useVoiceStore.getState().leaveVoiceChannel(async () => ({})));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: await browser.version(), default: 'browser', switched: 'rnnoise', rnnoiseSettings, runtimeFallback: 'browser', mobileWidth: 390 }, null, 2));
} finally {
  await browser.close();
}
