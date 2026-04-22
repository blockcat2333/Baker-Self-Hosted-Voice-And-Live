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

function videoConstraintsForQuality(quality: StreamQualitySettings): MediaTrackConstraints {
  const dimensionsByResolution: Record<StreamQualitySettings['resolution'], { height: number; width: number }> = {
    '480p': { height: 480, width: 854 },
    '720p': { height: 720, width: 1280 },
    '1080p': { height: 1080, width: 1920 },
    '1440p': { height: 1440, width: 2560 },
  };
  const dimensions = dimensionsByResolution[quality.resolution];

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
