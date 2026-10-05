import createRNNWasmModuleSync from '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js';

declare const AudioWorkletProcessor: { new(): { port: MessagePort } };
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

const FRAME_SIZE = 480;
const PCM_SCALE = 32768;

/** Single-channel, 48 kHz RNNoise. All buffers are allocated before rendering. */
class RnnoiseWorklet extends AudioWorkletProcessor {
  private readonly module = createRNNWasmModuleSync();
  private readonly state: number;
  private readonly pointer: number;
  private readonly queue = new Float32Array(FRAME_SIZE * 2);
  private inputCount = 0;
  private readIndex = 0;
  private writeIndex = FRAME_SIZE;
  private disposed = false;

  constructor() {
    super();
    if (sampleRate !== 48000) throw new Error('RNNoise requires 48 kHz audio.');
    this.state = this.module._rnnoise_create(0);
    this.pointer = this.module._malloc(FRAME_SIZE * 4);
    if (!this.state || !this.pointer) {
      if (this.pointer) this.module._free(this.pointer);
      if (this.state) this.module._rnnoise_destroy(this.state);
      throw new Error('RNNoise initialization failed.');
    }
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === 'dispose' && !this.disposed) {
        this.disposed = true;
        this.module._free(this.pointer);
        this.module._rnnoise_destroy(this.state);
        this.port.close();
      }
    };
    this.port.postMessage('ready');
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.disposed) return false;
    const channels = inputs[0] ?? [];
    const output = outputs[0]?.[0];
    if (!output) return true;
    const heapOffset = this.pointer / 4;
    // Seeded with one frame of silence: fixed buffering delay, no periodic
    // gaps when Web Audio block lengths don't divide RNNoise's 480 samples.
    for (let index = 0; index < output.length; index++) {
      let input = 0;
      for (const channel of channels) input += channel[index] ?? 0;
      if (channels.length) input /= channels.length;
      this.module.HEAPF32[heapOffset + this.inputCount++] = input * PCM_SCALE;
      if (this.inputCount === FRAME_SIZE) {
        this.module._rnnoise_process_frame(this.state, this.pointer, this.pointer);
        for (let frameIndex = 0; frameIndex < FRAME_SIZE; frameIndex++) {
          this.queue[this.writeIndex] = this.module.HEAPF32[heapOffset + frameIndex]! / PCM_SCALE;
          this.writeIndex = (this.writeIndex + 1) % this.queue.length;
        }
        this.inputCount = 0;
      }
      output[index] = this.queue[this.readIndex]!;
      this.readIndex = (this.readIndex + 1) % this.queue.length;
    }
    return true;
  }
}

registerProcessor('baker-rnnoise', RnnoiseWorklet);
