import type { StreamQualitySettings, StreamSourceType } from '@baker/protocol';

export const DEFAULT_STREAM_PLAYBACK_VOLUME = 1;
export type StreamCodecPreference = 'default' | 'h264' | 'vp8' | 'vp9' | 'av1';
export type PopupPlaybackStartResult = 'playing' | 'audio_blocked' | 'blocked';
export type CameraFacingMode = 'environment' | 'user';
export type CameraSelection =
  | { kind: 'default' }
  | { deviceId: string; kind: 'device' }
  | { facingMode: CameraFacingMode; kind: 'facing' };
export interface CameraOption {
  key: string;
  label: string | null;
  selection: CameraSelection;
}
type CameraDeviceLike = Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>;
type DesktopScreenSelector = {
  onExcludedSystemAudioChunk?(
    sessionId: string,
    callback: (chunk: Uint8Array) => void,
  ): () => void;
  selectScreenSource(): Promise<DesktopScreenSourceSelection | string | null>;
  startExcludedSystemAudioCapture?(): Promise<ExcludedSystemAudioSession>;
  stopExcludedSystemAudioCapture?(sessionId: string): Promise<void>;
};
type DesktopWindowLike = {
  bakerDesktop?: DesktopScreenSelector;
};
export interface DesktopScreenSourceSelection {
  shareAudio: boolean;
  sourceId: string;
}
interface ExcludedSystemAudioSession {
  channelCount: number;
  sampleRate: number;
  sessionId: string;
}
type ElectronMediaTrackConstraints = MediaTrackConstraints & {
  mandatory: Record<string, number | string>;
};

export const DEFAULT_STREAM_CODEC_PREFERENCE: StreamCodecPreference = 'default';
export const DEFAULT_STREAM_QUALITY: StreamQualitySettings = {
  bitrateKbps: 4000,
  frameRate: 30,
  resolution: '720p',
};
export const DEFAULT_CAMERA_SELECTION: CameraSelection = { kind: 'default' };

export const STREAM_RESOLUTION_OPTIONS: StreamQualitySettings['resolution'][] = ['480p', '720p', '1080p', '1440p'];
export const STREAM_FRAME_RATE_OPTIONS: StreamQualitySettings['frameRate'][] = [15, 30, 60];
export const STREAM_BITRATE_OPTIONS: StreamQualitySettings['bitrateKbps'][] = [2000, 4000, 6000, 10000, 16000];
export const STREAM_CODEC_OPTIONS: StreamCodecPreference[] = ['default', 'h264', 'vp8', 'vp9', 'av1'];

const dimensionsByResolution: Record<StreamQualitySettings['resolution'], { height: number; width: number }> = {
  '480p': { height: 480, width: 854 },
  '720p': { height: 720, width: 1280 },
  '1080p': { height: 1080, width: 1920 },
  '1440p': { height: 1440, width: 2560 },
};

function getVideoDimensions(quality: StreamQualitySettings) {
  return dimensionsByResolution[quality.resolution];
}

function videoConstraintsForQuality(quality: StreamQualitySettings): MediaTrackConstraints {
  const dimensions = getVideoDimensions(quality);

  return {
    frameRate: {
      ideal: quality.frameRate,
      max: quality.frameRate,
    },
    height: {
      ideal: dimensions.height,
      max: dimensions.height,
    },
    width: {
      ideal: dimensions.width,
      max: dimensions.width,
    },
  };
}

function audioCaptureConstraints(): MediaTrackConstraints {
  return {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  };
}

function getDesktopScreenSelector(): DesktopScreenSelector | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return (window as DesktopWindowLike).bakerDesktop ?? null;
}

export function clampStreamPlaybackVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_STREAM_PLAYBACK_VOLUME;
  }

  if (volume <= 0) {
    return 0;
  }

  if (volume >= 1) {
    return 1;
  }

  return volume;
}

export function getCameraSelectionKey(selection: CameraSelection): string {
  if (selection.kind === 'device') {
    return `device:${selection.deviceId}`;
  }

  if (selection.kind === 'facing') {
    return `facing:${selection.facingMode}`;
  }

  return 'default';
}

export function getFallbackCameraOptions(): CameraOption[] {
  return [
    {
      key: getCameraSelectionKey({ facingMode: 'user', kind: 'facing' }),
      label: null,
      selection: { facingMode: 'user', kind: 'facing' },
    },
    {
      key: getCameraSelectionKey({ facingMode: 'environment', kind: 'facing' }),
      label: null,
      selection: { facingMode: 'environment', kind: 'facing' },
    },
  ];
}

export function listCameraOptions(
  devices: readonly CameraDeviceLike[],
  currentSelectionKey: string | null = null,
): CameraOption[] {
  const videoDevices = devices.filter((device) => device.kind === 'videoinput');
  const deviceOptions = videoDevices.map((device, index) => ({
    key: getCameraSelectionKey({ deviceId: device.deviceId, kind: 'device' }),
    label: device.label.trim() || `Camera ${index + 1}`,
    selection: {
      deviceId: device.deviceId,
      kind: 'device' as const,
    },
  }));
  const hasReadableLabel = videoDevices.some((device) => device.label.trim().length > 0);

  if (deviceOptions.length === 0 || !hasReadableLabel) {
    return getFallbackCameraOptions();
  }

  if (currentSelectionKey?.startsWith('facing:')) {
    const currentFallbackOption = getFallbackCameraOptions().find((option) => option.key === currentSelectionKey);
    if (currentFallbackOption) {
      return [currentFallbackOption, ...deviceOptions];
    }
  }

  return deviceOptions;
}

export function getCameraSelectionFromOptions(
  options: readonly CameraOption[],
  selectedKey: string | null,
): CameraSelection {
  return options.find((option) => option.key === selectedKey)?.selection ?? DEFAULT_CAMERA_SELECTION;
}

export function hasPlayableStreamAudioTrack(stream: Pick<MediaStream, 'getAudioTracks'> | null): boolean {
  if (!stream) {
    return false;
  }

  return stream.getAudioTracks().some((track) => track.readyState !== 'ended' && track.enabled !== false);
}

export function buildCameraCaptureConstraints(
  quality: StreamQualitySettings = DEFAULT_STREAM_QUALITY,
  selection: CameraSelection = DEFAULT_CAMERA_SELECTION,
  includeAudio = true,
): MediaStreamConstraints {
  const videoConstraints = videoConstraintsForQuality(quality);

  if (selection.kind === 'device') {
    videoConstraints.deviceId = { exact: selection.deviceId };
  }

  if (selection.kind === 'facing') {
    videoConstraints.facingMode = { ideal: selection.facingMode };
  }

  return {
    audio: includeAudio ? audioCaptureConstraints() : false,
    video: videoConstraints,
  };
}

export function buildScreenCaptureConstraints(
  quality: StreamQualitySettings = DEFAULT_STREAM_QUALITY,
): DisplayMediaStreamOptions {
  // Chromium/Electron may treat local-playback suppression as an OS-level mute
  // for shared system audio on Windows, so keep only non-destructive audio hints.
  return {
    audio: audioCaptureConstraints(),
    video: videoConstraintsForQuality(quality),
  };
}

export function buildElectronScreenCaptureConstraints(
  quality: StreamQualitySettings = DEFAULT_STREAM_QUALITY,
  sourceId: string,
  includeAudio = true,
): MediaStreamConstraints {
  const dimensions = getVideoDimensions(quality);
  const video: ElectronMediaTrackConstraints = {
    ...videoConstraintsForQuality(quality),
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxFrameRate: quality.frameRate,
      maxHeight: dimensions.height,
      maxWidth: dimensions.width,
      minFrameRate: Math.min(15, quality.frameRate),
    },
  };

  return {
    audio: includeAudio
      ? ({
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          },
        } as ElectronMediaTrackConstraints)
      : false,
    video,
  };
}

function getLiveTracks(stream: MediaStream, kind: 'audio' | 'video'): MediaStreamTrack[] {
  const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
  return tracks.filter((track) => track.readyState !== 'ended');
}

function stopStream(stream: MediaStream | null) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

const excludedSystemAudioWorkletProcessor = `
class BakerExcludedSystemAudioProcessor extends AudioWorkletProcessor {
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

registerProcessor('baker-excluded-system-audio', BakerExcludedSystemAudioProcessor);
`;

let excludedSystemAudioWorkletUrl: string | null = null;

function getExcludedSystemAudioWorkletUrl() {
  if (!excludedSystemAudioWorkletUrl) {
    excludedSystemAudioWorkletUrl = URL.createObjectURL(
      new Blob([excludedSystemAudioWorkletProcessor], { type: 'text/javascript' }),
    );
  }

  return excludedSystemAudioWorkletUrl;
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

function transferChunk(chunk: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy.buffer;
}

async function captureExcludedSystemAudioStream(
  desktopScreenSelector: DesktopScreenSelector,
): Promise<MediaStream> {
  if (
    !desktopScreenSelector.startExcludedSystemAudioCapture ||
    !desktopScreenSelector.stopExcludedSystemAudioCapture ||
    !desktopScreenSelector.onExcludedSystemAudioChunk
  ) {
    throw new Error('Excluded system audio capture is unavailable in this desktop client.');
  }

  const session = await desktopScreenSelector.startExcludedSystemAudioCapture();
  let unsubscribe: (() => void) | null = null;
  let context: AudioContext | null = null;

  try {
    context = new AudioContext({ sampleRate: session.sampleRate });
    await context.audioWorklet.addModule(getExcludedSystemAudioWorkletUrl());
    const node = new AudioWorkletNode(context, 'baker-excluded-system-audio', {
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

    unsubscribe = desktopScreenSelector.onExcludedSystemAudioChunk(session.sessionId, (chunk) => {
      const buffer = transferChunk(chunk);
      node.port.postMessage(buffer, [buffer]);
    });

    const stopCapture = () => {
      unsubscribe?.();
      unsubscribe = null;
      void desktopScreenSelector.stopExcludedSystemAudioCapture?.(session.sessionId);
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
    await desktopScreenSelector.stopExcludedSystemAudioCapture(session.sessionId);
    await context?.close().catch(() => {
      // Best effort cleanup after setup failure.
    });
    throw error;
  }
}

function normalizeDesktopScreenSelection(
  selection: DesktopScreenSourceSelection | string | null,
): DesktopScreenSourceSelection | null {
  if (typeof selection === 'string') {
    return { shareAudio: false, sourceId: selection };
  }

  if (!selection || typeof selection.sourceId !== 'string') {
    return null;
  }

  return {
    shareAudio: selection.shareAudio === true,
    sourceId: selection.sourceId,
  };
}

async function captureElectronScreenStream(
  quality: StreamQualitySettings,
  sourceId: string,
  includeAudio: boolean,
  desktopScreenSelector: DesktopScreenSelector,
): Promise<MediaStream> {
  const videoOnlyStream = await navigator.mediaDevices.getUserMedia(
    buildElectronScreenCaptureConstraints(quality, sourceId, false),
  );

  const videoTracks = getLiveTracks(videoOnlyStream, 'video');
  if (videoTracks.length === 0) {
    stopStream(videoOnlyStream);
    throw new Error('Desktop capture did not provide a video track.');
  }

  if (!includeAudio) {
    return videoOnlyStream;
  }

  let audioStream: MediaStream | null = null;
  try {
    audioStream = await captureExcludedSystemAudioStream(desktopScreenSelector);
  } catch (error) {
    stopStream(videoOnlyStream);
    throw error;
  }

  const mergedStream = new MediaStream();
  for (const track of videoTracks) {
    mergedStream.addTrack(track);
  }
  for (const track of getLiveTracks(audioStream, 'audio')) {
    mergedStream.addTrack(track);
  }

  return mergedStream;
}

export async function captureScreenStream(
  quality: StreamQualitySettings = DEFAULT_STREAM_QUALITY,
): Promise<MediaStream> {
  const desktopScreenSelector = getDesktopScreenSelector();
  if (!desktopScreenSelector) {
    return navigator.mediaDevices.getDisplayMedia(buildScreenCaptureConstraints(quality));
  }

  const selection = normalizeDesktopScreenSelection(await desktopScreenSelector.selectScreenSource());
  if (!selection) {
    throw new Error('Screen share selection was canceled.');
  }

  return captureElectronScreenStream(
    quality,
    selection.sourceId,
    selection.shareAudio,
    desktopScreenSelector,
  );
}

export function isDisplayAudioSource(sourceType: StreamSourceType): boolean {
  return sourceType === 'screen';
}

export async function startPopupStreamPlayback(
  element: Pick<HTMLVideoElement, 'muted' | 'play'>,
  stream: Pick<MediaStream, 'getAudioTracks'> | null,
): Promise<PopupPlaybackStartResult> {
  const preferAudio = hasPlayableStreamAudioTrack(stream);

  if (preferAudio) {
    element.muted = false;
    try {
      await element.play();
      return 'playing';
    } catch {
      // Fall back to muted autoplay so video still renders when the browser
      // blocks autoplay-with-audio in the popup.
    }
  }

  element.muted = true;
  try {
    await element.play();
    return preferAudio ? 'audio_blocked' : 'playing';
  } catch {
    return 'blocked';
  }
}
