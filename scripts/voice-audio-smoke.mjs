import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const source = await readFile(
  new URL(
    '../packages/client/src/features/voice/voice-audio.ts',
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
const browser = await chromium.launch({
  channel: process.env.AUDIO_BROWSER_CHANNEL ?? 'msedge',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.addScriptTag({
    type: 'module',
    content: `${compiled}\nglobalThis.connectLimiter = connectVoiceLimiter;`,
  });
  await page.waitForFunction(() => Boolean(globalThis.connectLimiter));
  const result = await page.evaluate(async () => {
    async function render(volume) {
      const context = new OfflineAudioContext(1, 48000, 48000);
      const oscillator = context.createOscillator();
      oscillator.frequency.value = 440;
      const gain = context.createGain();
      gain.gain.value = volume;
      oscillator.connect(gain);
      globalThis.connectLimiter(context, gain, context.destination);
      oscillator.start();
      const buffer = await context.startRendering();
      const samples = buffer.getChannelData(0).slice(1000, 47000);
      let peak = 0;
      let clipped = 0;
      for (const sample of samples) {
        peak = Math.max(peak, Math.abs(sample));
        if (Math.abs(sample) >= 1) clipped++;
      }
      return { peak, clipped, sampleRate: buffer.sampleRate };
    }
    return { ordinary: await render(0.2), amplified: await render(2) };
  });
  assert.ok(
    Math.abs(result.ordinary.peak - 0.2) < 0.002,
    'Ordinary speech gain preserved',
  );
  assert.ok(
    result.amplified.peak > 0.95 && result.amplified.peak < 1,
    'Amplified peaks bounded below full scale',
  );
  assert.equal(result.amplified.clipped, 0);
  assert.equal(result.amplified.sampleRate, 48000);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
