import rnnoiseWorkletUrl from './rnnoise-worklet.ts?worker&url';
import { clampVoiceInputVolume, connectVoiceLimiter, setVoiceGain } from './voice-audio';

export type VoiceNoiseSuppressionMode = 'browser' | 'rnnoise';
export const VOICE_NOISE_SUPPRESSION_MODES = ['browser', 'rnnoise'] as const;

export interface VoiceInputProcessor {
  readonly stream: MediaStream;
  readonly mode: VoiceNoiseSuppressionMode;
  setVolume(volume: number): void;
  prepareMode(mode: VoiceNoiseSuppressionMode): Promise<void>;
  setMode(mode: VoiceNoiseSuppressionMode, capture?: MediaStream): Promise<void>;
  dispose(): void;
}

const LOAD_TIMEOUT_MS = 10000;

async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RNNoise initialization timed out.')), LOAD_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Owns only the processing graph; the voice session owns capture/send tracks. */
export function createVoiceInputProcessor(
  capture: MediaStream,
  volume: number,
  onFallback: () => void,
): VoiceInputProcessor {
  let context: AudioContext;
  let source: MediaStreamAudioSourceNode;
  let gain: GainNode;
  let destination: MediaStreamAudioDestinationNode;
  let partialContext: AudioContext | null = null;
  try {
    context = partialContext = new AudioContext({ sampleRate: 48000, latencyHint: 'balanced' });
    source = context.createMediaStreamSource(capture);
    gain = context.createGain();
    gain.gain.value = clampVoiceInputVolume(volume);
    destination = context.createMediaStreamDestination();
    source.connect(gain);
    connectVoiceLimiter(context, gain, destination);
    void context.resume().catch(() => {});
  } catch {
    // Existing basic-mode behavior on browsers without a usable AudioContext.
    // The partially initialized context, if any, still needs to be released.
    void partialContext?.close().catch(() => {});
    let fallbackCapture = capture;
    return {
      get stream() { return fallbackCapture; },
      mode: 'browser',
      setVolume() {},
      async prepareMode(mode) {
        if (mode === 'rnnoise') throw new Error('RNNoise is not supported.');
      },
      async setMode(mode, nextCapture) {
        if (mode === 'rnnoise') throw new Error('RNNoise is not supported.');
        if (nextCapture) fallbackCapture = nextCapture;
      },
      dispose() {},
    };
  }

  let mode: VoiceNoiseSuppressionMode = 'browser';
  let node: AudioWorkletNode | null = null;
  let moduleLoaded = false;
  let disposed = false;
  let captureTrack = capture.getAudioTracks()[0];
  const errorHandlers = new WeakMap<AudioWorkletNode, EventListener>();

  function setErrorHandler(target: AudioWorkletNode, handler: EventListener | null) {
    const previous = errorHandlers.get(target);
    if (previous) target.removeEventListener('processorerror', previous);
    if (handler) {
      errorHandlers.set(target, handler);
      target.addEventListener('processorerror', handler);
    } else {
      errorHandlers.delete(target);
    }
  }

  function releaseNode(target: AudioWorkletNode | null) {
    if (!target) return;
    setErrorHandler(target, null);
    target.port.postMessage('dispose');
    target.disconnect();
  }

  function bypass() {
    source.disconnect();
    source.connect(gain);
    releaseNode(node);
    node = null;
    mode = 'browser';
  }

  async function setNativeSuppression(track: MediaStreamTrack | undefined, enabled: boolean) {
    if (track?.getSettings?.().noiseSuppression === enabled) return;
    // AEC and AGC remain as captured; only native noise suppression changes.
    await track?.applyConstraints?.({ ...track.getConstraints?.(), noiseSuppression: enabled });
    const actual = track?.getSettings?.().noiseSuppression;
    if (typeof actual === 'boolean' && actual !== enabled) {
      throw new Error('The browser did not change native microphone noise suppression.');
    }
  }

  async function prepareMode(nextMode: VoiceNoiseSuppressionMode) {
    if (disposed) throw new Error('Microphone processing has been disposed.');
    if (nextMode === 'browser') return;
    if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined' || context.sampleRate !== 48000) {
      throw new Error('RNNoise is not supported.');
    }
    if (!moduleLoaded) {
      await withTimeout(context.audioWorklet.addModule(rnnoiseWorkletUrl));
      moduleLoaded = true;
    }
  }

  return {
    stream: new MediaStream(destination.stream.getAudioTracks()),
    get mode() { return mode; },
    setVolume(nextVolume) { setVoiceGain(gain.gain, clampVoiceInputVolume(nextVolume), context); },
    prepareMode,
    async setMode(nextMode, nextCapture) {
      if (disposed) throw new Error('Microphone processing has been disposed.');
      if (mode === nextMode && !nextCapture) return;
      const nextTrack = nextCapture?.getAudioTracks()[0] ?? captureTrack;
      if (nextMode === 'browser') {
        await setNativeSuppression(nextTrack, true);
        if (disposed) return;
        const nextSource = nextCapture ? context.createMediaStreamSource(nextCapture) : source;
        source.disconnect();
        source = nextSource;
        captureTrack = nextTrack;
        bypass();
        return;
      }
      let nextNode: AudioWorkletNode | null = null;
      try {
        await prepareMode(nextMode);
        if (disposed) return;
        nextNode = new AudioWorkletNode(context, 'baker-rnnoise', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          channelCount: 1, channelCountMode: 'explicit',
        });
        const initializedNode = nextNode;
        await withTimeout(new Promise<void>((resolve, reject) => {
          initializedNode.port.onmessage = (event: MessageEvent) => {
            if (event.data === 'ready') resolve();
          };
          setErrorHandler(initializedNode, () => reject(new Error('RNNoise initialization failed.')));
        }));
        if (disposed) { releaseNode(nextNode); return; }
        await setNativeSuppression(nextTrack, false);
        if (disposed) { releaseNode(nextNode); return; }
        const nextSource = nextCapture ? context.createMediaStreamSource(nextCapture) : source;
        source.disconnect();
        source = nextSource;
        captureTrack = nextTrack;
        source.connect(nextNode);
        nextNode.connect(gain);
        releaseNode(node);
        node = nextNode;
        mode = 'rnnoise';
        setErrorHandler(nextNode, () => {
          if (disposed || node !== initializedNode) return;
          bypass();
          void setNativeSuppression(captureTrack, true).catch(() => {}).finally(() => {
            if (!disposed) onFallback();
          });
        });
      } catch (error) {
        releaseNode(nextNode);
        if (!disposed) {
          bypass();
          await setNativeSuppression(captureTrack, true).catch(() => {});
        }
        throw error;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseNode(node);
      source.disconnect();
      void context.close().catch(() => {});
    },
  };
}
