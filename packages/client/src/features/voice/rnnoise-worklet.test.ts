import { afterEach, describe, expect, it, vi } from 'vitest';

const { wasm } = vi.hoisted(() => {
  const heap = new Float32Array(4096);
  return { wasm: {
    HEAPF32: heap,
    _malloc: vi.fn(() => 4),
    _free: vi.fn(),
    _rnnoise_create: vi.fn(() => 1),
    _rnnoise_destroy: vi.fn(),
    _rnnoise_process_frame: vi.fn((_state: number, output: number, input: number) => {
      for (let index = 0; index < 480; index++) heap[output / 4 + index] = heap[input / 4 + index]! * 0.5;
      return 1;
    }),
  } };
});
vi.mock('@jitsi/rnnoise-wasm/dist/rnnoise-sync.js', () => ({ default: () => wasm }));

interface Worklet {
  port: { onmessage: ((event: { data: string }) => void) | null; close: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

async function createWorklet() {
  let constructor: new() => Worklet;
  vi.stubGlobal('sampleRate', 48000);
  vi.stubGlobal('AudioWorkletProcessor', class {
    port = { onmessage: null, close: vi.fn(), postMessage: vi.fn() };
  });
  vi.stubGlobal('registerProcessor', (_name: string, value: new() => Worklet) => { constructor = value; });
  vi.resetModules();
  await import('./rnnoise-worklet');
  return new constructor!();
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('RNNoise framing', () => {
  it('preserves every sample across varying render blocks with a fixed one-frame buffer', async () => {
    const worklet = await createWorklet();
    const input = Float32Array.from({ length: 14400 }, (_, index) => Math.sin(index / 13) * 0.2);
    const rendered = new Float32Array(input.length);
    let offset = 0;
    const blockSizes = [128, 256, 64, 192];
    let block = 0;
    while (offset < input.length) {
      const size = Math.min(blockSizes[block++ % blockSizes.length]!, input.length - offset);
      const output = new Float32Array(size);
      expect(worklet.process([[input.subarray(offset, offset + size)]], [[output]])).toBe(true);
      rendered.set(output, offset);
      offset += size;
    }
    expect(Array.from(rendered.subarray(0, 480))).toEqual(Array(480).fill(0));
    for (let index = 480; index < rendered.length; index++) {
      expect(rendered[index]).toBeCloseTo(input[index - 480]! * 0.5, 6);
    }
    expect(wasm._rnnoise_process_frame).toHaveBeenCalledTimes(30);
    expect(wasm._rnnoise_process_frame).toHaveBeenCalledWith(1, 4, 4);
    expect(wasm._rnnoise_create).toHaveBeenCalledWith(0);
  });

  it('mixes stereo to mono and releases the WASM state once on disposal', async () => {
    const worklet = await createWorklet();
    const output = new Float32Array(960);
    worklet.process([[new Float32Array(960).fill(0.2), new Float32Array(960).fill(0.6)]], [[output]]);
    expect(output[600]).toBeCloseTo(0.2);
    worklet.port.onmessage!({ data: 'dispose' });
    worklet.port.onmessage!({ data: 'dispose' });
    expect(wasm._free).toHaveBeenCalledTimes(1);
    expect(wasm._rnnoise_destroy).toHaveBeenCalledTimes(1);
    expect(worklet.process([], [[output]])).toBe(false);
  });
});
