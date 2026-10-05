/* global URL, process, console, OfflineAudioContext, AudioWorkletNode, AudioContext, Event, setTimeout */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';

// Exercise the actual production worklet, not a mocked DSP implementation.
// Build web and desktop before running this script. No microphone is opened.
const assets = new URL('../apps/web/dist/assets/', import.meta.url);
const workletName = (await readdir(assets)).find((name) => /^rnnoise-worklet-.*\.js$/.test(name));
assert.ok(workletName, 'Web build contains the RNNoise worklet');
const worklet = await readFile(new URL(workletName, assets));
const desktopAssets = new URL('../apps/desktop/dist/renderer/assets/', import.meta.url);
assert.deepEqual(await readFile(new URL(workletName, desktopAssets)), worklet, 'Web and desktop ship the same processor');

const processorSource = (await readFile(new URL('../packages/client/src/features/voice/voice-input-processor.ts', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');
const audioSource = await readFile(new URL('../packages/client/src/features/voice/voice-audio.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(`const rnnoiseWorkletUrl = '/worklet.js';\n${audioSource}\n${processorSource}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;

let workletRequests = 0;
const server = createServer((request, response) => {
  if (request.url === '/worklet.js') {
    workletRequests++;
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(worklet);
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Baker RNNoise smoke</title>');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  channel: process.env.AUDIO_BROWSER_CHANNEL ?? 'msedge', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('Browser error:', error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ type: 'module', content: `${compiled}\nglobalThis.createVoiceInputProcessor = createVoiceInputProcessor;` });
  await page.waitForFunction(() => Boolean(globalThis.createVoiceInputProcessor));
  const result = await page.evaluate(async () => {
    const duration = 3;
    const sampleCount = duration * 48000;
    const context = new OfflineAudioContext(1, sampleCount, 48000);
    await context.audioWorklet.addModule('/worklet.js');
    const node = new AudioWorkletNode(context, 'baker-rnnoise', { outputChannelCount: [1] });
    let processorError = false;
    node.onprocessorerror = () => { processorError = true; };
    const input = context.createBuffer(1, sampleCount, 48000);
    const samples = input.getChannelData(0);
    // Deterministic stationary noise gives a reproducible DSP sanity check.
    let seed = 42;
    for (let index = 0; index < samples.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[index] = ((seed / 4294967296) * 2 - 1) * 0.1;
    }
    const source = context.createBufferSource();
    source.buffer = input;
    source.connect(node).connect(context.destination);
    source.start();
    const rendered = await context.startRendering();
    let inputEnergy = 0;
    let outputEnergy = 0;
    let peak = 0;
    const output = rendered.getChannelData(0);
    for (let index = 48000; index < output.length; index++) {
      if (!Number.isFinite(output[index])) throw new Error('Non-finite RNNoise output');
      inputEnergy += samples[index] ** 2;
      outputEnergy += output[index] ** 2;
      peak = Math.max(peak, Math.abs(output[index]));
    }
    node.port.postMessage('dispose');
    return { processorError, inputRms: Math.sqrt(inputEnergy / (sampleCount - 48000)), outputRms: Math.sqrt(outputEnergy / (sampleCount - 48000)), peak };
  });
  assert.equal(result.processorError, false, 'Actual WASM processor rendered successfully');
  assert.ok(result.outputRms > 0, 'RNNoise is processing, rather than returning only silence');
  assert.ok(result.outputRms < result.inputRms * 0.8, 'Stationary synthetic noise was reduced');
  assert.ok(result.peak < 1, 'Output remains bounded');

  // A real-time graph verifies lazy loading, stable output and runtime fallback.
  const requestsBeforeBasic = workletRequests;
  await page.evaluate(() => {
    const context = new AudioContext({ sampleRate: 48000 });
    const oscillator = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    // A generated MediaStreamDestination track cannot apply microphone DSP
    // constraints. Unit tests check them; this browser test opens no real mic.
    destination.stream.getAudioTracks()[0].applyConstraints = async () => {};
    const nodes = [];
    const OriginalNode = globalThis.AudioWorkletNode;
    globalThis.AudioWorkletNode = class extends OriginalNode { constructor(...args) { super(...args); nodes.push(this); } };
    let fallbacks = 0;
    const processor = globalThis.createVoiceInputProcessor(destination.stream, 0.3, () => { fallbacks++; });
    globalThis.noiseSmoke = { context, oscillator, destination, processor, nodes, get fallbacks() { return fallbacks; }, output: processor.stream.getAudioTracks()[0] };
  });
  assert.equal(workletRequests, requestsBeforeBasic, 'Basic mode does not load the AI model');
  const graphResult = await page.evaluate(async () => {
    const test = globalThis.noiseSmoke;
    await test.processor.setMode('rnnoise');
    const enabled = test.processor.mode;
    await test.processor.setMode('browser');
    const disabled = test.processor.mode;
    test.output.enabled = false;
    await test.processor.setMode('rnnoise');
    test.nodes.at(-1).dispatchEvent(new Event('processorerror'));
    for (let index = 0; index < 100 && !test.fallbacks; index++) await new Promise((resolve) => setTimeout(resolve, 10));
    const result = { enabled, disabled, fallback: test.processor.mode, fallbacks: test.fallbacks,
      stableTrack: test.processor.stream.getAudioTracks()[0] === test.output, stillMuted: !test.output.enabled };
    test.processor.dispose();
    test.oscillator.stop();
    test.destination.stream.getTracks().forEach((track) => track.stop());
    test.processor.stream.getTracks().forEach((track) => track.stop());
    await test.context.close();
    return result;
  });
  assert.deepEqual(graphResult, { enabled: 'rnnoise', disabled: 'browser', fallback: 'browser', fallbacks: 1, stableTrack: true, stillMuted: true });
  console.log(JSON.stringify({ browser: await browser.version(), dsp: result, graph: graphResult }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
