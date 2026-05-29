export interface DesktopMusicSourceSelection {
  processId: number;
}

interface DesktopAudioCaptureSession {
  channelCount: number;
  sampleRate: number;
  sessionId: string;
}

type DesktopMusicSelector = {
  isWindowAudioCaptureAvailable?(): Promise<boolean>;
  onWindowAudioCaptureChunk?(
    sessionId: string,
    callback: (chunk: Uint8Array) => void,
  ): () => void;
  selectMusicSource?(): Promise<DesktopMusicSourceSelection | null>;
  startWindowAudioCapture?(processId: number): Promise<DesktopAudioCaptureSession>;
  stopWindowAudioCapture?(sessionId: string): Promise<void>;
};

type DesktopWindowLike = {
  bakerDesktop?: DesktopMusicSelector;
};

export const DEFAULT_MUSIC_PLAYBACK_VOLUME = 1;

export function clampMusicPlaybackVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_MUSIC_PLAYBACK_VOLUME;
  }

  if (volume <= 0) {
    return 0;
  }

  if (volume >= 1) {
    return 1;
  }

  return volume;
}

function getDesktopMusicSelector(): DesktopMusicSelector | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return (window as DesktopWindowLike).bakerDesktop ?? null;
}

const windowAudioWorkletProcessor = `
class BakerWindowAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channelCount = Math.max(1, options.processorOptions.channelCount || 2);
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.port.onmessage = (event) => {
      this.queue.push(new Float32Array(event.data));
    };
  }

  readSample() {
    while (!this.current || this.offset >= this.current.length) {
      this.current = this.queue.shift() || null;
      this.offset = 0;
      if (!this.current) {
        return null;
      }
    }

    return this.current[this.offset++];
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const frameCount = output[0].length;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const frameSamples = [];
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        frameSamples[channel] = this.readSample();
      }

      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel][frame] = frameSamples[channel] ?? frameSamples[0] ?? 0;
      }
    }

    return true;
  }
}

registerProcessor('baker-window-audio', BakerWindowAudioProcessor);
`;

let windowAudioWorkletUrl: string | null = null;

function getWindowAudioWorkletUrl() {
  if (!windowAudioWorkletUrl) {
    windowAudioWorkletUrl = URL.createObjectURL(
      new Blob([windowAudioWorkletProcessor], { type: 'text/javascript' }),
    );
  }

  return windowAudioWorkletUrl;
}

function transferChunk(chunk: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy.buffer;
}

function patchAudioTrackStop(track: MediaStreamTrack, stopCapture: () => void) {
  const originalStop = track.stop.bind(track);
  let stopped = false;
  track.stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    stopCapture();
    originalStop();
  };
}

export function canCaptureDesktopMusic(): boolean {
  const selector = getDesktopMusicSelector();
  return Boolean(
    selector?.isWindowAudioCaptureAvailable &&
    selector?.selectMusicSource &&
      selector.startWindowAudioCapture &&
      selector.stopWindowAudioCapture &&
      selector.onWindowAudioCaptureChunk,
  );
}

export async function resolveDesktopMusicCaptureAvailability(): Promise<boolean> {
  const selector = getDesktopMusicSelector();
  if (
    !selector?.isWindowAudioCaptureAvailable ||
    !selector.selectMusicSource ||
    !selector.startWindowAudioCapture ||
    !selector.stopWindowAudioCapture ||
    !selector.onWindowAudioCaptureChunk
  ) {
    return false;
  }

  try {
    return await selector.isWindowAudioCaptureAvailable();
  } catch {
    return false;
  }
}

export async function captureDesktopMusicStream(): Promise<MediaStream> {
  const selector = getDesktopMusicSelector();
  if (
    !selector?.isWindowAudioCaptureAvailable ||
    !(await selector.isWindowAudioCaptureAvailable()) ||
    !selector.selectMusicSource ||
    !selector.startWindowAudioCapture ||
    !selector.stopWindowAudioCapture ||
    !selector.onWindowAudioCaptureChunk
  ) {
    throw new Error('Window audio capture is only available in Baker Desktop on Windows.');
  }

  const selection = await selector.selectMusicSource();
  if (!selection) {
    throw new Error('Music source selection was canceled.');
  }

  const session = await selector.startWindowAudioCapture(selection.processId);
  let unsubscribe: (() => void) | null = null;
  let context: AudioContext | null = null;

  try {
    context = new AudioContext({ sampleRate: session.sampleRate });
    await context.audioWorklet.addModule(getWindowAudioWorkletUrl());
    const node = new AudioWorkletNode(context, 'baker-window-audio', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [session.channelCount],
      processorOptions: {
        channelCount: session.channelCount,
      },
    });
    const destination = context.createMediaStreamDestination();
    node.connect(destination);
    if (context.state === 'suspended') {
      await context.resume();
    }

    unsubscribe = selector.onWindowAudioCaptureChunk(session.sessionId, (chunk) => {
      const buffer = transferChunk(chunk);
      node.port.postMessage(buffer, [buffer]);
    });

    const stopCapture = () => {
      unsubscribe?.();
      unsubscribe = null;
      void selector.stopWindowAudioCapture?.(session.sessionId);
      void context?.close().catch(() => {
        // Best effort: the media track is already stopping.
      });
      context = null;
    };

    for (const track of destination.stream.getAudioTracks()) {
      patchAudioTrackStop(track, stopCapture);
    }

    return destination.stream;
  } catch (error) {
    unsubscribe?.();
    await selector.stopWindowAudioCapture(session.sessionId);
    await context?.close().catch(() => {
      // Best effort cleanup after setup failure.
    });
    throw error;
  }
}
