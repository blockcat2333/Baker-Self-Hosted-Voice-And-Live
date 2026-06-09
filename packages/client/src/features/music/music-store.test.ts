import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handleRecvOnlyOffer = vi.fn();
let latestCallbacks: {
  onRemoteTrack?: (fromUserId: string, track: MediaStreamTrack, streams: MediaStream[]) => void;
} | null = null;

vi.mock('@baker/sdk', () => {
  class MockWebRtcManager {
    constructor(callbacks: typeof latestCallbacks) {
      latestCallbacks = callbacks;
    }

    closeAll = vi.fn();
    getPeerIds = vi.fn(() => []);
    handleRecvOnlyOffer = handleRecvOnlyOffer;
  }

  class MockSfuClientSession {
    close = vi.fn();
    consumeProducer = vi.fn();
    load = vi.fn();
    produceTracks = vi.fn();
  }

  return {
    SfuClientSession: MockSfuClientSession,
    WebRtcManager: MockWebRtcManager,
  };
});

vi.mock('./music-media', () => ({
  DEFAULT_MUSIC_PLAYBACK_VOLUME: 1,
  canCaptureDesktopMusic: vi.fn(() => false),
  captureDesktopMusicStream: vi.fn(),
  clampMusicPlaybackVolume: (volume: number) => Math.max(0, Math.min(1, volume)),
  resolveDesktopMusicCaptureAvailability: vi.fn(async () => false),
}));

import { useAuthStore } from '../auth/auth-store';
import { useMusicStore } from './music-store';

const channelId = '11111111-1111-4111-8111-111111111111';
const hostUserId = '22222222-2222-4222-8222-222222222222';
const listenerUserId = '33333333-3333-4333-8333-333333333333';
const musicId = '44444444-4444-4444-8444-444444444444';
const hostSessionId = '55555555-5555-4555-8555-555555555555';
const listenerSessionId = '66666666-6666-4666-8666-666666666666';

const OriginalAudio = globalThis.Audio;
const OriginalMediaStream = globalThis.MediaStream;

const audioElements: MockAudio[] = [];

class MockAudio {
  autoplay = false;
  parentNode: { removeChild: (node: unknown) => void } | null = null;
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
  srcObject: MediaStream | null = null;
  style = { display: '' };
  private currentVolume = 1;

  constructor() {
    audioElements.push(this);
  }

  get volume() {
    return this.currentVolume;
  }

  set volume(value: number) {
    if (value < 0 || value > 1 || !Number.isFinite(value)) {
      throw new Error(`HTMLMediaElement volume must be between 0 and 1, received ${value}.`);
    }
    this.currentVolume = value;
  }
}

class MockMediaStream {
  private readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }

  getTracks() {
    return [...this.tracks];
  }

  removeTrack(track: MediaStreamTrack) {
    const index = this.tracks.findIndex((entry) => entry.id === track.id);
    if (index >= 0) {
      this.tracks.splice(index, 1);
    }
  }
}

function createTrack(id: string): MediaStreamTrack {
  return {
    enabled: true,
    id,
    kind: 'audio',
    muted: false,
    readyState: 'live',
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function publication() {
  return {
    channelId,
    hostUserId,
    listeners: [],
    musicId,
    sessionId: hostSessionId,
    status: 'live' as const,
  };
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  audioElements.length = 0;
  latestCallbacks = null;
  handleRecvOnlyOffer.mockReset();
  handleRecvOnlyOffer.mockResolvedValue({ sdp: 'answer-sdp', type: 'answer' });
  vi.stubGlobal('Audio', MockAudio);
  vi.stubGlobal('MediaStream', MockMediaStream);
  vi.stubGlobal('document', {
    body: {
      appendChild: vi.fn((node: MockAudio) => {
        node.parentNode = { removeChild: vi.fn() };
      }),
    },
  });

  useAuthStore.setState({
    accessToken: null,
    error: null,
    isLoading: false,
    refreshToken: null,
    user: {
      email: 'listener@example.com',
      id: listenerUserId,
      username: 'listener',
    },
  });
  useMusicStore.getState().reset();
});

afterEach(() => {
  useMusicStore.getState().reset();
  useAuthStore.setState({
    accessToken: null,
    error: null,
    isLoading: false,
    refreshToken: null,
    user: null,
  });
  vi.unstubAllGlobals();
  globalThis.Audio = OriginalAudio;
  globalThis.MediaStream = OriginalMediaStream;
});

describe('music store playback', () => {
  it('does not auto-listen to the current user music publication', async () => {
    useAuthStore.setState({
      user: {
        email: 'host@example.com',
        id: hostUserId,
        username: 'host',
      },
    });
    const sendCommandAwaitAck = vi.fn();

    useMusicStore.getState().handleMusicStateUpdated(
      { channelId, publications: [publication()] },
      sendCommandAwaitAck,
      vi.fn(),
    );
    await flushPromises();

    expect(sendCommandAwaitAck).not.toHaveBeenCalled();
    expect(useMusicStore.getState().listeningById).toEqual({});
    expect(audioElements).toHaveLength(0);
  });

  it('auto-listens to remote music and applies shared music volume to audio elements', async () => {
    const sendCommandAwaitAck = vi.fn().mockResolvedValue({
      channelId,
      hostSessionId,
      hostUserId,
      iceServers: [],
      mediaMode: 'p2p',
      musicId,
      sessionId: listenerSessionId,
    });

    useMusicStore.getState().handleMusicStateUpdated(
      { channelId, publications: [publication()] },
      sendCommandAwaitAck,
      vi.fn(),
    );
    await flushPromises();

    expect(sendCommandAwaitAck).toHaveBeenCalledWith('music.listen', { channelId, musicId });
    expect(useMusicStore.getState().listeningById[musicId]).toMatchObject({
      hostUserId,
      sessionId: listenerSessionId,
      status: 'listening',
    });

    const track = createTrack('remote-music-track');
    const stream = new MockMediaStream([track]) as unknown as MediaStream;
    latestCallbacks?.onRemoteTrack?.(hostUserId, track, [stream]);

    expect(audioElements).toHaveLength(1);
    expect((audioElements[0]?.srcObject as unknown as MockMediaStream).getAudioTracks()).toContain(track);
    expect(audioElements[0]?.volume).toBe(1);

    useMusicStore.getState().setPlaybackVolume(0.25);
    expect(audioElements[0]?.volume).toBe(0.25);

    useMusicStore.getState().setPlaybackVolume(2);
    expect(audioElements[0]?.volume).toBe(1);
  });

  it('clamps stored playback volume before writing it to a remote audio element', async () => {
    const sendCommandAwaitAck = vi.fn().mockResolvedValue({
      channelId,
      hostSessionId,
      hostUserId,
      iceServers: [],
      mediaMode: 'p2p',
      musicId,
      sessionId: listenerSessionId,
    });

    useMusicStore.getState().handleMusicStateUpdated(
      { channelId, publications: [publication()] },
      sendCommandAwaitAck,
      vi.fn(),
    );
    await flushPromises();

    useMusicStore.setState({ playbackVolume: 2 });

    const track = createTrack('remote-music-track');
    const stream = new MockMediaStream([track]) as unknown as MediaStream;

    expect(() => latestCallbacks?.onRemoteTrack?.(hostUserId, track, [stream])).not.toThrow();
    expect(audioElements[0]?.volume).toBe(1);
  });
});
