import { describe, expect, it } from 'vitest';

import {
  getPopupStreamTrackSignature,
  shouldReattachPopupStreamAfterSourceTrackChange,
} from './stream-popup-reattach';

class MockTrack {
  public readonly enabled = true;
  public readonly readyState = 'live';

  constructor(
    public readonly id: string,
    public readonly kind: 'audio' | 'video',
  ) {}
}

class MockMediaStream {
  constructor(private readonly tracks: MockTrack[]) {}

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getTracks() {
    return [...this.tracks];
  }
}

function videoElementState(options: {
  muted?: boolean;
  paused?: boolean;
  srcObject?: MockMediaStream | null;
}) {
  return {
    muted: options.muted ?? false,
    paused: options.paused ?? false,
    srcObject: options.srcObject ?? null,
  } as unknown as Pick<HTMLVideoElement, 'muted' | 'paused' | 'srcObject'>;
}

describe('StreamPopupHost helpers', () => {
  it('reattaches when SFU video arrives after an audio-only popup stream was already playing', () => {
    const audioTrack = new MockTrack('audio-1', 'audio');
    const videoTrack = new MockTrack('video-1', 'video');
    const attachedAudioOnly = new MockMediaStream([audioTrack]);
    const sourceWithVideo = new MockMediaStream([audioTrack, videoTrack]);

    expect(
      shouldReattachPopupStreamAfterSourceTrackChange(
        videoElementState({ srcObject: attachedAudioOnly }),
        sourceWithVideo as unknown as Pick<MediaStream, 'getAudioTracks' | 'getTracks'>,
      ),
    ).toBe(true);
  });

  it('does not reattach a stable playing popup stream when the same tracks are already attached', () => {
    const audioTrack = new MockTrack('audio-1', 'audio');
    const videoTrack = new MockTrack('video-1', 'video');
    const attached = new MockMediaStream([audioTrack, videoTrack]);
    const source = new MockMediaStream([audioTrack, videoTrack]);

    expect(
      shouldReattachPopupStreamAfterSourceTrackChange(
        videoElementState({ srcObject: attached }),
        source as unknown as Pick<MediaStream, 'getAudioTracks' | 'getTracks'>,
      ),
    ).toBe(false);
  });

  it('changes the stream track signature when a later video track is present', () => {
    const audioTrack = new MockTrack('audio-1', 'audio');
    const videoTrack = new MockTrack('video-1', 'video');

    expect(getPopupStreamTrackSignature(new MockMediaStream([audioTrack]) as unknown as MediaStream)).toBe(
      'audio:audio-1:live',
    );
    expect(getPopupStreamTrackSignature(new MockMediaStream([audioTrack, videoTrack]) as unknown as MediaStream)).toBe(
      'audio:audio-1:live|video:video-1:live',
    );
  });
});
