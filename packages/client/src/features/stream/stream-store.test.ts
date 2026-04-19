import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebRtcManagerCallbacks } from '@baker/sdk';

const handleRecvOnlyOffer = vi.fn();
const addIceCandidate = vi.fn();
const restartIce = vi.fn();
const closePeer = vi.fn();
const closeAll = vi.fn();
const createOffer = vi.fn();
const getPeerIds = vi.fn(() => []);
const getRemoteTracks = vi.fn(() => []);
const getAggregatePeerVideoSendSample = vi.fn();
const getPeerVideoReceiveSample = vi.fn();
const getDisplayMedia = vi.fn();
const getUserMedia = vi.fn();
let latestCallbacks: WebRtcManagerCallbacks | null = null;
const OriginalMediaStream = globalThis.MediaStream;

class MockMediaStream {
  private readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }

  getTracks() {
    return [...this.tracks];
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

vi.mock('@baker/sdk', () => {
  class MockWebRtcManager {
    constructor(callbacks: WebRtcManagerCallbacks) {
      latestCallbacks = callbacks;
    }

    handleRecvOnlyOffer = handleRecvOnlyOffer;
    addIceCandidate = addIceCandidate;
    restartIce = restartIce;
    closePeer = closePeer;
    closeAll = closeAll;
    createOffer = createOffer;
    handleAnswer = vi.fn();
    getPeerIds = getPeerIds;
    getRemoteTracks = getRemoteTracks;
    getAggregatePeerVideoSendSample = getAggregatePeerVideoSendSample;
    getPeerVideoReceiveSample = getPeerVideoReceiveSample;
  }

  return {
    WebRtcManager: MockWebRtcManager,
  };
});

import { useAuthStore } from '../auth/auth-store';
import { getOwnedStreamVideoStats, useStreamStore } from './stream-store';

const channelId = '11111111-1111-4111-8111-111111111111';
const hostUserId = '22222222-2222-4222-8222-222222222222';
const viewerUserId = '33333333-3333-4333-8333-333333333333';
const streamId = '44444444-4444-4444-8444-444444444444';
const hostSessionId = '55555555-5555-4555-8555-555555555555';
const viewerSessionId = '66666666-6666-4666-8666-666666666666';
const localPreviewTrack = {
  contentHint: '',
  enabled: true,
  id: 'local-video-track',
  kind: 'video',
  muted: false,
  readyState: 'live',
  stop: vi.fn(),
} as unknown as MediaStreamTrack;

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  globalThis.MediaStream = MockMediaStream as unknown as typeof MediaStream;
  handleRecvOnlyOffer.mockReset();
  handleRecvOnlyOffer.mockResolvedValue({ type: 'answer', sdp: 'viewer-answer' });
  addIceCandidate.mockReset();
  restartIce.mockReset();
  closePeer.mockReset();
  closeAll.mockReset();
  createOffer.mockReset();
  createOffer.mockResolvedValue({ type: 'offer', sdp: 'viewer-offer' });
  getPeerIds.mockReset();
  getPeerIds.mockReturnValue([]);
  getRemoteTracks.mockReset();
  getRemoteTracks.mockReturnValue([]);
  getAggregatePeerVideoSendSample.mockReset();
  getAggregatePeerVideoSendSample.mockResolvedValue(null);
  getPeerVideoReceiveSample.mockReset();
  getPeerVideoReceiveSample.mockResolvedValue(null);
  getDisplayMedia.mockReset();
  getUserMedia.mockReset();
  getDisplayMedia.mockResolvedValue(new MockMediaStream([localPreviewTrack]));
  getUserMedia.mockResolvedValue(new MockMediaStream([localPreviewTrack]));
  latestCallbacks = null;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getDisplayMedia,
      getUserMedia,
    },
  });

  useAuthStore.setState({
    accessToken: null,
    error: null,
    isLoading: false,
    refreshToken: null,
    user: {
      email: 'viewer@example.com',
      id: viewerUserId,
      username: 'viewer',
    },
  });

  useStreamStore.getState().reset();
});

afterEach(() => {
  globalThis.MediaStream = OriginalMediaStream;
  useStreamStore.getState().reset();
  useAuthStore.setState({
    accessToken: null,
    error: null,
    isLoading: false,
    refreshToken: null,
    user: null,
  });
});

describe('stream store watch startup', () => {
  it('sends the selected livestream quality through capture and stream.start', async () => {
    const sendCommandAwaitAck = vi.fn().mockResolvedValue({
      channelId,
      iceServers: [],
      sessionId: hostSessionId,
      streamId,
    });
    const sendRawCommand = vi.fn();

    await useStreamStore
      .getState()
      .startSharing(
        channelId,
        { bitrateKbps: 10000, frameRate: 60, resolution: '1080p' },
        'screen',
        sendCommandAwaitAck,
        sendRawCommand,
      );

    expect(getDisplayMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: {
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
      },
    });
    expect(sendCommandAwaitAck).toHaveBeenCalledWith('stream.start', {
      channelId,
      quality: { bitrateKbps: 10000, frameRate: 60, resolution: '1080p' },
      sourceType: 'screen',
    });
    expect(localPreviewTrack.contentHint).toBe('detail');
    expect(useStreamStore.getState().ownedStream).toMatchObject({
      channelId,
      codecPreference: 'default',
      quality: { bitrateKbps: 10000, frameRate: 60, resolution: '1080p' },
      sessionId: hostSessionId,
      sourceType: 'screen',
      status: 'live',
      streamId,
    });
  });

  it('applies screen-share sender preferences when offering to a new viewer', async () => {
    const sendCommandAwaitAck = vi.fn().mockResolvedValue({
      channelId,
      iceServers: [],
      sessionId: hostSessionId,
      streamId,
    });
    const sendRawCommand = vi.fn();

    await useStreamStore
      .getState()
      .startSharing(
        channelId,
        { bitrateKbps: 10000, frameRate: 60, resolution: '1080p' },
        'screen',
        sendCommandAwaitAck,
        sendRawCommand,
      );

    useStreamStore.getState().handleStreamStateUpdated({
      channelId,
      session: {
        hostUserId: viewerUserId,
        sessionId: hostSessionId,
        sourceType: 'screen',
        status: 'live',
        streamId,
      },
      streams: [
        {
          channelId,
          hostUserId: viewerUserId,
          sessionId: hostSessionId,
          sourceType: 'screen',
          status: 'live',
          streamId,
          viewers: [{ sessionId: viewerSessionId, userId: hostUserId }],
        },
      ],
      viewers: [{ sessionId: viewerSessionId, userId: hostUserId }],
    });

    await flushPromises();

    expect(createOffer).toHaveBeenCalledWith(
      hostUserId,
      expect.any(MockMediaStream),
      [],
      {
        degradationPreference: 'balanced',
        maxVideoBitrateKbps: 10000,
        preferredVideoCodec: 'default',
      },
    );
    expect(sendRawCommand).toHaveBeenCalledWith('media.signal.offer', {
      signal: {
        sdp: 'viewer-offer',
        session: {
          channelId,
          mode: 'stream_publish',
          sessionId: hostSessionId,
          streamId,
          userId: viewerUserId,
        },
        type: 'offer',
      },
      targetUserId: hostUserId,
    });
  });

  it('replays a queued host offer that arrives before the watch ack finishes', async () => {
    let resolveAck: ((value: unknown) => void) | null = null;
    const sendCommandAwaitAck = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveAck = resolve;
        }),
    );
    const sendRawCommand = vi.fn();

    const watchPromise = useStreamStore
      .getState()
      .watchStream(channelId, streamId, sendCommandAwaitAck, sendRawCommand);

    expect(useStreamStore.getState().watchedStreamsById[streamId]?.status).toBe('starting');

    useStreamStore.getState().handleStreamStateUpdated({
      channelId,
      session: {
        hostUserId,
        sessionId: hostSessionId,
        sourceType: 'screen',
        status: 'live',
        streamId,
      },
      streams: [
        {
          channelId,
          hostUserId,
          sessionId: hostSessionId,
          sourceType: 'screen',
          status: 'live',
          streamId,
          viewers: [{ sessionId: viewerSessionId, userId: viewerUserId }],
        },
      ],
      viewers: [{ sessionId: viewerSessionId, userId: viewerUserId }],
    });

    useStreamStore.getState().handleMediaSignal({
      fromUserId: hostUserId,
      signal: {
        session: {
          channelId,
          mode: 'stream_publish',
          sessionId: hostSessionId,
          streamId,
          userId: hostUserId,
        },
        sdp: 'host-offer',
        type: 'offer',
      },
    });

    expect(handleRecvOnlyOffer).not.toHaveBeenCalled();

    expect(resolveAck).not.toBeNull();
    resolveAck!({
      channelId,
      hostSessionId,
      hostUserId,
      iceServers: [],
      sessionId: viewerSessionId,
      streamId,
    });

    await watchPromise;
    await flushPromises();

    expect(handleRecvOnlyOffer).toHaveBeenCalledOnce();
    expect(handleRecvOnlyOffer).toHaveBeenCalledWith(
      hostUserId,
      { sdp: 'host-offer', type: 'offer' },
      [],
    );
    expect(sendRawCommand).toHaveBeenCalledWith('media.signal.answer', {
      signal: {
        sdp: 'viewer-answer',
        session: {
          channelId,
          mode: 'stream_watch',
          sessionId: viewerSessionId,
          streamId,
          userId: viewerUserId,
        },
        type: 'answer',
      },
      targetUserId: hostUserId,
    });
    expect(useStreamStore.getState().watchedStreamsById[streamId]).toMatchObject({
      hostSessionId,
      hostUserId,
      sourceType: 'screen',
      status: 'watching',
      streamId,
      viewers: [{ sessionId: viewerSessionId, userId: viewerUserId }],
    });
  });

  it('builds a playable remote stream when the incoming event stream is empty', async () => {
    const sendCommandAwaitAck = vi.fn().mockResolvedValue({
      channelId,
      hostSessionId,
      hostUserId,
      iceServers: [],
      sessionId: viewerSessionId,
      streamId,
    });
    const sendRawCommand = vi.fn();

    useStreamStore.getState().handleStreamStateUpdated({
      channelId,
      session: {
        hostUserId,
        sessionId: hostSessionId,
        sourceType: 'screen',
        status: 'live',
        streamId,
      },
      streams: [
        {
          channelId,
          hostUserId,
          sessionId: hostSessionId,
          sourceType: 'screen',
          status: 'live',
          streamId,
          viewers: [{ sessionId: viewerSessionId, userId: viewerUserId }],
        },
      ],
      viewers: [{ sessionId: viewerSessionId, userId: viewerUserId }],
    });

    await useStreamStore.getState().watchStream(channelId, streamId, sendCommandAwaitAck, sendRawCommand);

    expect(latestCallbacks).not.toBeNull();

    const track = {
      enabled: true,
      id: 'remote-video-track',
      kind: 'video',
      muted: false,
      readyState: 'live',
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;

    const emptyIncoming = {
      getTracks: () => [],
    } as unknown as MediaStream;

    latestCallbacks!.onRemoteTrack(hostUserId, track, [emptyIncoming]);

    const watched = useStreamStore.getState().watchedStreamsById[streamId];
    expect(watched?.remoteStream).not.toBeNull();
    expect(watched?.remoteStream?.getTracks()).toHaveLength(1);
    expect(watched?.remoteStream?.getTracks()[0]).toBe(track);
  });

  it('queues host ICE candidates until the recv-only offer is applied', async () => {
    let resolveAck: ((value: unknown) => void) | null = null;
    const sendCommandAwaitAck = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveAck = resolve;
        }),
    );
    const sendRawCommand = vi.fn();

    const watchPromise = useStreamStore
      .getState()
      .watchStream(channelId, streamId, sendCommandAwaitAck, sendRawCommand);

    const queuedCandidate = {
      candidate: 'candidate:1 1 UDP 1 127.0.0.1 12345 typ host',
      sdpMLineIndex: 0,
      sdpMid: '0',
    };

    useStreamStore.getState().handleMediaSignal({
      fromUserId: hostUserId,
      signal: {
        candidate: queuedCandidate,
        session: {
          channelId,
          mode: 'stream_publish',
          sessionId: hostSessionId,
          streamId,
          userId: hostUserId,
        },
        type: 'ice_candidate',
      },
    });

    useStreamStore.getState().handleMediaSignal({
      fromUserId: hostUserId,
      signal: {
        session: {
          channelId,
          mode: 'stream_publish',
          sessionId: hostSessionId,
          streamId,
          userId: hostUserId,
        },
        sdp: 'host-offer',
        type: 'offer',
      },
    });

    expect(resolveAck).not.toBeNull();
    resolveAck!({
      channelId,
      hostSessionId,
      hostUserId,
      iceServers: [],
      sessionId: viewerSessionId,
      streamId,
    });

    await watchPromise;
    await flushPromises();

    expect(handleRecvOnlyOffer).toHaveBeenCalledWith(
      hostUserId,
      { sdp: 'host-offer', type: 'offer' },
      [],
    );
    expect(addIceCandidate).toHaveBeenCalledWith(hostUserId, queuedCandidate);
  });

  it('summarizes owned-stream sender stats for broadcaster diagnostics', async () => {
    const sendCommandAwaitAck = vi.fn().mockResolvedValue({
      channelId,
      iceServers: [],
      sessionId: hostSessionId,
      streamId,
    });
    const sendRawCommand = vi.fn();

    await useStreamStore
      .getState()
      .startSharing(
        channelId,
        { bitrateKbps: 6000, frameRate: 60, resolution: '1080p' },
        'screen',
        sendCommandAwaitAck,
        sendRawCommand,
      );

    getAggregatePeerVideoSendSample
      .mockResolvedValueOnce({
        activePeerCount: 1,
        bytesSent: 1000,
        codec: 'H264',
        frameHeight: 1080,
        frameWidth: 1920,
        framesEncoded: 100,
        framesPerSecond: null,
        packetsSent: 100,
        qualityLimitationReason: 'cpu',
        timestampMs: 1000,
      })
      .mockResolvedValueOnce({
        activePeerCount: 1,
        bytesSent: 751000,
        codec: 'H264',
        frameHeight: 1080,
        frameWidth: 1920,
        framesEncoded: 140,
        framesPerSecond: null,
        packetsSent: 160,
        qualityLimitationReason: 'cpu',
        timestampMs: 2000,
      });

    const first = await getOwnedStreamVideoStats();
    const second = await getOwnedStreamVideoStats();

    expect(first).toMatchObject({
      activePeerCount: 1,
      bitrateKbps: null,
      codec: 'H264',
      encoderLimited: true,
      qualityLimitationReason: 'cpu',
      resolution: '1920x1080',
    });
    expect(second).toMatchObject({
      activePeerCount: 1,
      bitrateKbps: 6000,
      codec: 'H264',
      encoderLimited: true,
      frameRate: 40,
      qualityLimitationReason: 'cpu',
      resolution: '1920x1080',
    });
  });

  it('passes a preferred video codec into publish offers', async () => {
    const sendCommandAwaitAck = vi.fn().mockResolvedValue({
      channelId,
      iceServers: [],
      sessionId: hostSessionId,
      streamId,
    });
    const sendRawCommand = vi.fn();

    await useStreamStore
      .getState()
      .startSharing(
        channelId,
        { bitrateKbps: 10000, frameRate: 60, resolution: '1080p' },
        'screen',
        sendCommandAwaitAck,
        sendRawCommand,
        'h264',
      );

    useStreamStore.getState().handleStreamStateUpdated({
      channelId,
      session: {
        hostUserId: viewerUserId,
        sessionId: hostSessionId,
        sourceType: 'screen',
        status: 'live',
        streamId,
      },
      streams: [
        {
          channelId,
          hostUserId: viewerUserId,
          sessionId: hostSessionId,
          sourceType: 'screen',
          status: 'live',
          streamId,
          viewers: [{ sessionId: viewerSessionId, userId: hostUserId }],
        },
      ],
      viewers: [{ sessionId: viewerSessionId, userId: hostUserId }],
    });

    await flushPromises();

    expect(createOffer).toHaveBeenCalledWith(
      hostUserId,
      expect.any(MockMediaStream),
      [],
      {
        degradationPreference: 'balanced',
        maxVideoBitrateKbps: 10000,
        preferredVideoCodec: 'h264',
      },
    );
  });

  it('does not create an orphaned runtime when unwatch completes before the watch ACK arrives', async () => {
    // Simulate the race: stream.watch ACK is delayed; stream.unwatch resolves
    // immediately (completes before the watch ACK is delivered).
    let resolveWatchAck: ((value: unknown) => void) | null = null;

    const sendCommandAwaitAck = vi.fn((command: string) => {
      if (command === 'stream.watch') {
        return new Promise((resolve) => {
          resolveWatchAck = resolve;
        });
      }
      // stream.unwatch and anything else resolves immediately.
      return Promise.resolve({});
    });
    const sendRawCommand = vi.fn();

    // Start watching — ACK is pending.
    const watchPromise = useStreamStore
      .getState()
      .watchStream(channelId, streamId, sendCommandAwaitAck, sendRawCommand);

    expect(useStreamStore.getState().watchedStreamsById[streamId]?.status).toBe('starting');

    // User closes popup: unwatch resolves immediately (before watch ACK).
    await useStreamStore.getState().unwatchStream(streamId, sendCommandAwaitAck);

    // Now the delayed watch ACK arrives.
    expect(resolveWatchAck).not.toBeNull();
    resolveWatchAck!({
      channelId,
      hostSessionId,
      hostUserId,
      iceServers: [],
      sessionId: viewerSessionId,
      streamId,
    });
    await watchPromise;
    await flushPromises();

    // watchStream must detect the cancel and NOT leave an orphaned runtime.
    expect(useStreamStore.getState().watchedStreamsById[streamId]).toBeUndefined();
    const unwatchCalls = (sendCommandAwaitAck.mock.calls as [string][]).filter(
      ([cmd]) => cmd === 'stream.unwatch',
    );
    // At least one stream.unwatch was dispatched (from unwatchStream or the
    // cancel path inside watchStream).
    expect(unwatchCalls.length).toBeGreaterThanOrEqual(1);
  });
});
