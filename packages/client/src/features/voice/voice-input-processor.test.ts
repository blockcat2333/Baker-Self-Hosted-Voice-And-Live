import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceInputProcessor } from './voice-input-processor';

const addModule = vi.fn();
const applyConstraints = vi.fn();
const closeContext = vi.fn();
const source = { connect: vi.fn(), disconnect: vi.fn() };
const gain = { connect: vi.fn(), gain: { value: 1 } };
const capture = { getAudioTracks: () => [{ applyConstraints }] } as unknown as MediaStream;
const sendTrack = { id: 'stable-send-track' };
const nodes: MockWorkletNode[] = [];
const fallback = vi.fn();

class MockWorkletNode {
  onprocessorerror: (() => void) | null = null;
  port = { onmessage: null as ((event: { data: string }) => void) | null, postMessage: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
  addEventListener(_event: string, callback: () => void) { this.onprocessorerror = callback; }
  removeEventListener() { this.onprocessorerror = null; }
  constructor() {
    nodes.push(this);
    queueMicrotask(() => this.port.onmessage?.({ data: 'ready' }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  nodes.length = 0;
  addModule.mockResolvedValue(undefined);
  applyConstraints.mockResolvedValue(undefined);
  closeContext.mockResolvedValue(undefined);
  vi.stubGlobal('MediaStream', class { constructor(readonly tracks: unknown[]) {} getAudioTracks() { return this.tracks; } });
  vi.stubGlobal('AudioWorkletNode', MockWorkletNode);
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48000;
    audioWorklet = { addModule };
    createMediaStreamSource() { return source; }
    createGain() { return gain; }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [sendTrack] } }; }
    resume() { return Promise.resolve(); }
    close = closeContext;
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('microphone noise suppression graph', () => {
  it('keeps raw capture usable when AudioContext is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const processor = createVoiceInputProcessor(capture, 1, fallback);
    expect(processor.stream).toBe(capture);
    await expect(processor.prepareMode('rnnoise')).rejects.toThrow('not supported');
    const replacement = { getAudioTracks: () => [] } as unknown as MediaStream;
    await processor.setMode('browser', replacement);
    expect(processor.stream).toBe(replacement);
    processor.dispose();
  });
  it('defaults to browser processing without loading RNNoise and preserves the output track when toggling', async () => {
    const processor = createVoiceInputProcessor(capture, 0.7, fallback);
    expect(processor.mode).toBe('browser');
    expect(addModule).not.toHaveBeenCalled();
    const output = processor.stream;
    await processor.setMode('rnnoise');
    expect(processor.mode).toBe('rnnoise');
    expect(applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: false });
    expect(source.connect).toHaveBeenLastCalledWith(nodes[0]);
    expect(nodes[0]!.connect).toHaveBeenCalledWith(gain);
    processor.setVolume(1.5);
    expect(gain.gain.value).toBe(1.5);
    await processor.setMode('browser');
    expect(applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: true });
    expect(source.connect).toHaveBeenLastCalledWith(gain);
    expect(nodes[0]!.port.postMessage).toHaveBeenCalledWith('dispose');
    expect(processor.stream).toBe(output);
    await processor.setMode('rnnoise');
    expect(addModule).toHaveBeenCalledTimes(1);
    processor.dispose();
    expect(closeContext).toHaveBeenCalledTimes(1);
  });

  it('keeps basic audio working when the model fails to load', async () => {
    addModule.mockRejectedValueOnce(new Error('missing asset'));
    const processor = createVoiceInputProcessor(capture, 1, fallback);
    await expect(processor.setMode('rnnoise')).rejects.toThrow('missing asset');
    expect(processor.mode).toBe('browser');
    expect(source.connect).toHaveBeenLastCalledWith(gain);
    expect(applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: true });
    processor.dispose();
  });

  it('bypasses a crashed processor and reports the automatic fallback', async () => {
    const processor = createVoiceInputProcessor(capture, 1, fallback);
    await processor.setMode('rnnoise');
    nodes[0]!.onprocessorerror!();
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledOnce());
    expect(processor.mode).toBe('browser');
    expect(source.connect).toHaveBeenLastCalledWith(gain);
    expect(applyConstraints).toHaveBeenLastCalledWith({ noiseSuppression: true });
    processor.dispose();
  });

  it('times out a stalled load without leaving the microphone silent', async () => {
    vi.useFakeTimers();
    addModule.mockImplementationOnce(() => new Promise(() => {}));
    const processor = createVoiceInputProcessor(capture, 1, fallback);
    const result = expect(processor.setMode('rnnoise')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(processor.mode).toBe('browser');
    processor.dispose();
  });

  it('does not connect an asynchronously loaded graph after disposal', async () => {
    let finishLoad!: () => void;
    addModule.mockImplementationOnce(() => new Promise<void>((resolve) => { finishLoad = resolve; }));
    const processor = createVoiceInputProcessor(capture, 1, fallback);
    const pending = processor.setMode('rnnoise');
    processor.dispose();
    finishLoad();
    await pending;
    expect(nodes).toHaveLength(0);
    expect(applyConstraints).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });
});
