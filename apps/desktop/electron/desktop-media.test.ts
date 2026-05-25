import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { desktopMediaCapturePatchScript, isDesktopMediaPermissionAllowed } from './desktop-media';

class MockTrack {
  public stopped = false;

  constructor(
    public readonly id: string,
    public readonly kind: 'audio' | 'video',
    public readonly readyState: 'ended' | 'live' = 'live',
  ) {}

  stop() {
    this.stopped = true;
  }
}

class MockMediaStream {
  private readonly tracks: MockTrack[] = [];

  constructor(tracks: MockTrack[] = []) {
    this.tracks.push(...tracks);
  }

  addTrack(track: MockTrack) {
    this.tracks.push(track);
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getTracks() {
    return [...this.tracks];
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

function installPatch(getUserMedia: (constraints: unknown) => Promise<MockMediaStream>) {
  const context = vm.createContext({
    MediaStream: MockMediaStream,
    navigator: {
      mediaDevices: {
        getUserMedia,
      },
    },
  });

  vm.runInContext(desktopMediaCapturePatchScript, context);

  return context.navigator.mediaDevices as {
    getUserMedia(constraints: unknown): Promise<MockMediaStream>;
  };
}

function desktopCaptureConstraints(includeAudio = true) {
  return {
    audio: includeAudio
      ? {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: 'screen:1:0',
          },
        }
      : false,
    video: {
      frameRate: { ideal: 30, max: 30 },
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: 'screen:1:0',
        maxFrameRate: 30,
        maxHeight: 720,
        maxWidth: 1280,
        minFrameRate: 15,
      },
    },
  };
}

function sanitizedDesktopCaptureConstraints(includeAudio = true) {
  const constraints = desktopCaptureConstraints(includeAudio);
  return {
    audio: includeAudio ? constraints.audio : false,
    video: {
      mandatory: constraints.video.mandatory,
    },
  };
}

describe('desktop media capture patch', () => {
  it('allows only the desktop media permissions Electron needs', () => {
    expect(isDesktopMediaPermissionAllowed('media')).toBe(true);
    expect(isDesktopMediaPermissionAllowed('display-capture')).toBe(true);
    expect(isDesktopMediaPermissionAllowed('fullscreen')).toBe(true);
    expect(isDesktopMediaPermissionAllowed('speaker-selection')).toBe(true);
    expect(isDesktopMediaPermissionAllowed('notifications')).toBe(false);
  });

  it('leaves normal camera or microphone requests untouched', async () => {
    const getUserMedia = vi.fn(async () => new MockMediaStream([new MockTrack('camera-video', 'video')]));
    const mediaDevices = installPatch(getUserMedia);
    const constraints = { audio: true, video: true };

    await mediaDevices.getUserMedia(constraints);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(constraints);
  });

  it('retries Electron desktop capture and merges audio when the first stream has no video track', async () => {
    const systemAudioTrack = new MockTrack('system-audio', 'audio');
    const screenVideoTrack = new MockTrack('screen-video', 'video');
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(new MockMediaStream([systemAudioTrack]))
      .mockResolvedValueOnce(new MockMediaStream([screenVideoTrack]));
    const mediaDevices = installPatch(getUserMedia);
    const constraints = desktopCaptureConstraints();

    const stream = await mediaDevices.getUserMedia(constraints);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, sanitizedDesktopCaptureConstraints(true));
    expect(getUserMedia).toHaveBeenNthCalledWith(2, sanitizedDesktopCaptureConstraints(false));
    expect(stream.getVideoTracks()).toEqual([screenVideoTrack]);
    expect(stream.getAudioTracks()).toEqual([systemAudioTrack]);
  });

  it('fails instead of publishing an audio-only desktop stream when retry also has no video track', async () => {
    const systemAudioTrack = new MockTrack('system-audio', 'audio');
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(new MockMediaStream([systemAudioTrack]))
      .mockResolvedValueOnce(new MockMediaStream([]));
    const mediaDevices = installPatch(getUserMedia);

    await expect(mediaDevices.getUserMedia(desktopCaptureConstraints())).rejects.toThrow(
      'Desktop capture did not provide a video track.',
    );

    expect(systemAudioTrack.stopped).toBe(true);
  });
});
