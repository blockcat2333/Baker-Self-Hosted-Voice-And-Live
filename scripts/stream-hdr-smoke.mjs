import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, _electron } from '@playwright/test';
import ts from 'typescript';

const source = await readFile(
  new URL(
    '../packages/client/src/features/stream/stream-hdr.ts',
    import.meta.url,
  ),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
let temporaryDirectory;
let browser;
let page;
if (process.env.HDR_BROWSER_CHANNEL === 'electron') {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'baker-hdr-smoke-'));
  const entry = join(temporaryDirectory, 'main.cjs');
  await writeFile(
    entry,
    "const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => { const window = new BrowserWindow({ show: false }); window.loadURL('about:blank'); });",
  );
  const require = createRequire(
    new URL('../apps/desktop/package.json', import.meta.url),
  );
  browser = await _electron.launch({
    executablePath: require('electron'),
    args: [entry],
  });
  page = await browser.firstWindow();
} else {
  browser = await chromium.launch({
    channel: process.env.HDR_BROWSER_CHANNEL ?? 'msedge',
    headless: true,
  });
  page = await browser.newPage();
}
try {
  await page.goto('about:blank');
  await page.addScriptTag({
    type: 'module',
    content: `${compiled}\nglobalThis.hdr = { createHdrRenderer, normalizeStreamHdr, getStreamHdrStatus };`,
  });
  await page.waitForFunction(() => Boolean(globalThis.hdr));
  const result = await page.evaluate(async () => {
    const { createHdrRenderer, normalizeStreamHdr, getStreamHdrStatus } =
      globalThis.hdr;
    const renderer = createHdrRenderer();
    const pqEncode = (nits) => {
      const p = (nits / 10000) ** 0.1593017578125;
      return ((0.8359375 + 18.8515625 * p) / (1 + 18.6875 * p)) ** 78.84375;
    };
    const values = [0, 50, 203, 1000];
    async function sample(format, transfer, codes, fullRange = false) {
      const tenBit = format.endsWith('P10');
      const data = tenBit ? new Uint16Array(24) : new Uint8Array(24);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          data[y * 4 + x] = Math.round(
            fullRange
              ? codes[x] * (tenBit ? 1023 : 255)
              : (16 + 219 * codes[x]) * (tenBit ? 4 : 1),
          );
        }
      data.fill(tenBit ? 512 : 128, 16);
      const frame = new VideoFrame(data, {
        format,
        codedWidth: 4,
        codedHeight: 4,
        timestamp: 12345,
        duration: 33333,
        colorSpace: {
          primaries: 'bt2020',
          matrix: 'bt2020-ncl',
          transfer,
          fullRange,
        },
      });
      const corrected = await renderer.render(frame);
      const canvas = new OffscreenCanvas(4, 4);
      const context = canvas.getContext('2d');
      context.drawImage(corrected, 0, 0);
      const pixels = Array.from(context.getImageData(0, 0, 4, 1).data);
      const metadata = {
        timestamp: corrected.timestamp,
        duration: corrected.duration,
        transfer: corrected.colorSpace.transfer,
      };
      corrected.close();
      frame.close();
      return { pixels, metadata };
    }
    const pq8 = await sample('I420', 'pq', values.map(pqEncode));
    const pq10 = await sample('I420P10', 'pq', values.map(pqEncode));
    const pqNv12 = await sample('NV12', 'pq', values.map(pqEncode));
    const pqFull = await sample('I420', 'pq', values.map(pqEncode), true);
    const hlg = await sample('I420', 'hlg', [0, 0.25, 0.5, 1]);
    renderer.dispose();
    // Exercise the real frame-stream plumbing with a synthetic SDR capture.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const context = canvas.getContext('2d');
    context.fillStyle = '#804020';
    context.fillRect(0, 0, 4, 4);
    const original = canvas.captureStream(30);
    const sourceTrack = original.getVideoTracks()[0];
    const normalized = normalizeStreamHdr(original);
    const outputTrack = normalized.getVideoTracks()[0];
    const reader = new MediaStreamTrackProcessor({
      track: outputTrack,
    }).readable.getReader();
    canvas.getContext('2d').fillRect(0, 0, 1, 1);
    const received = await reader.read();
    received.value.close();
    const status = getStreamHdrStatus(normalized);
    outputTrack.stop();
    await reader.cancel();
    return {
      pq8,
      pq10,
      pqNv12,
      pqFull,
      hlg,
      status,
      sourceEnded: sourceTrack.readyState,
      outputEnded: outputTrack.readyState,
    };
  });
  for (const [name, sample] of Object.entries(result).filter(
    ([name]) => name.startsWith('pq') || name === 'hlg',
  )) {
    const red = [0, 4, 8, 12].map((offset) => sample.pixels[offset]);
    assert.ok(red[0] <= 2, `${name}: black preserved`);
    assert.ok(
      red[1] > red[0] && red[2] > red[1] && red[3] > red[2],
      `${name}: luminance ordering ${red}`,
    );
    assert.ok(red[3] >= 250, `${name}: nominal peak maps to white ${red}`);
    for (let offset = 0; offset < 16; offset += 4) {
      assert.ok(
        Math.abs(sample.pixels[offset] - sample.pixels[offset + 1]) <= 2,
        `${name}: neutral red/green`,
      );
      assert.ok(
        Math.abs(sample.pixels[offset] - sample.pixels[offset + 2]) <= 2,
        `${name}: neutral red/blue`,
      );
    }
    assert.equal(sample.metadata.timestamp, 12345);
    assert.equal(sample.metadata.duration, 33333);
    assert.ok(!['pq', 'hlg'].includes(sample.metadata.transfer));
  }
  assert.equal(result.status, 'sdr');
  assert.equal(result.sourceEnded, 'ended');
  assert.equal(result.outputEnded, 'ended');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  if (temporaryDirectory) {
    await unlink(join(temporaryDirectory, 'main.cjs'));
    await rmdir(temporaryDirectory);
  }
}
