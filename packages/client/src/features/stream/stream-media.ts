import type { StreamQualitySettings, StreamSourceType } from '@baker/protocol';

export const DEFAULT_STREAM_PLAYBACK_VOLUME = 1;
export type StreamCodecPreference = 'default' | 'h264' | 'vp8' | 'vp9' | 'av1';
export type PopupPlaybackStartResult = 'playing' | 'audio_blocked' | 'blocked';
export const DEFAULT_STREAM_CODEC_PREFERENCE: StreamCodecPreference = 'default';
export const DEFAULT_STREAM_QUALITY: StreamQualitySettings = {
  bitrateKbps: 4000,
  frameRate: 30,
  resolution: '720p',
};

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

export function hasPlayableStreamAudioTrack(stream: Pick<MediaStream, 'getAudioTracks'> | null): boolean {
  if (!stream) {
    return false;
  }

  return stream.getAudioTracks().some((track) => track.readyState !== 'ended' && track.enabled !== false);
}

export function buildCameraCaptureConstraints(quality: StreamQualitySettings = DEFAULT_STREAM_QUALITY): MediaStreamConstraints {
  const audioConstraints: MediaTrackConstraints = {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  };

  return {
    audio: audioConstraints,
    video: videoConstraintsForQuality(quality),
  };
}

export function buildScreenCaptureConstraints(quality: StreamQualitySettings = DEFAULT_STREAM_QUALITY): DisplayMediaStreamOptions {
  // Chromium/Electron may treat local-playback suppression as an OS-level mute
  // for shared system audio on Windows, so keep only non-destructive audio hints.
  const audioConstraints: MediaTrackConstraints = {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  };

  return {
    audio: audioConstraints,
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
