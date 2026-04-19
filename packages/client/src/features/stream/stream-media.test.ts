import { describe, expect, it, vi } from 'vitest';

import {
  buildCameraCaptureConstraints,
  buildScreenCaptureConstraints,
  clampStreamPlaybackVolume,
  DEFAULT_STREAM_PLAYBACK_VOLUME,
  isDisplayAudioSource,
  startPopupStreamPlayback,
} from './stream-media';

describe('stream-media helpers', () => {
  it('clamps playback volume into the supported range', () => {
    expect(clampStreamPlaybackVolume(Number.NaN)).toBe(DEFAULT_STREAM_PLAYBACK_VOLUME);
    expect(clampStreamPlaybackVolume(-1)).toBe(0);
    expect(clampStreamPlaybackVolume(0.42)).toBe(0.42);
    expect(clampStreamPlaybackVolume(4)).toBe(1);
  });

  it('builds camera capture constraints with livestream audio enabled', () => {
    expect(buildCameraCaptureConstraints()).toEqual({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: {
        frameRate: {
          ideal: 30,
          max: 30,
        },
        height: {
          ideal: 720,
          max: 720,
        },
        width: {
          ideal: 1280,
          max: 1280,
        },
      },
    });
  });

  it('builds screen capture constraints without forcing local playback suppression', () => {
    expect(buildScreenCaptureConstraints()).toEqual({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: {
        frameRate: {
          ideal: 30,
          max: 30,
        },
        height: {
          ideal: 720,
          max: 720,
        },
        width: {
          ideal: 1280,
          max: 1280,
        },
      },
    });
    expect(buildScreenCaptureConstraints().audio).not.toHaveProperty('suppressLocalAudioPlayback');
  });

  it('applies the requested livestream quality to capture constraints', () => {
    expect(buildScreenCaptureConstraints({ bitrateKbps: 10000, frameRate: 60, resolution: '1080p' }).video).toEqual({
      frameRate: {
        ideal: 60,
        max: 60,
      },
      height: {
        ideal: 1080,
        max: 1080,
      },
      width: {
        ideal: 1920,
        max: 1920,
      },
    });
  });

  it('supports 1440p quality constraints', () => {
    expect(buildCameraCaptureConstraints({ bitrateKbps: 16000, frameRate: 30, resolution: '1440p' }).video).toEqual({
      frameRate: {
        ideal: 30,
        max: 30,
      },
      height: {
        ideal: 1440,
        max: 1440,
      },
      width: {
        ideal: 2560,
        max: 2560,
      },
    });
  });

  it('detects display-audio stream sources', () => {
    expect(isDisplayAudioSource('screen')).toBe(true);
    expect(isDisplayAudioSource('camera')).toBe(false);
  });

  it('tries popup playback with audio first when the stream has audio tracks', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const element = {
      muted: true,
      play,
    } as unknown as Pick<HTMLVideoElement, 'muted' | 'play'>;
    const stream = {
      getAudioTracks: () => [{ enabled: true, readyState: 'live' } as MediaStreamTrack],
    } as Pick<MediaStream, 'getAudioTracks'>;

    await expect(startPopupStreamPlayback(element, stream)).resolves.toBe('playing');
    expect(play).toHaveBeenCalledTimes(1);
    expect(element.muted).toBe(false);
  });

  it('falls back to muted popup playback when autoplay with audio is blocked', async () => {
    const play = vi.fn()
      .mockRejectedValueOnce(new Error('audio autoplay blocked'))
      .mockResolvedValueOnce(undefined);
    const element = {
      muted: true,
      play,
    } as unknown as Pick<HTMLVideoElement, 'muted' | 'play'>;
    const stream = {
      getAudioTracks: () => [{ enabled: true, readyState: 'live' } as MediaStreamTrack],
    } as Pick<MediaStream, 'getAudioTracks'>;

    await expect(startPopupStreamPlayback(element, stream)).resolves.toBe('audio_blocked');
    expect(play).toHaveBeenCalledTimes(2);
    expect(element.muted).toBe(true);
  });

  it('keeps video-only popup playback on muted autoplay', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const element = {
      muted: false,
      play,
    } as unknown as Pick<HTMLVideoElement, 'muted' | 'play'>;
    const stream = {
      getAudioTracks: () => [],
    } as Pick<MediaStream, 'getAudioTracks'>;

    await expect(startPopupStreamPlayback(element, stream)).resolves.toBe('playing');
    expect(play).toHaveBeenCalledTimes(1);
    expect(element.muted).toBe(true);
  });
});
