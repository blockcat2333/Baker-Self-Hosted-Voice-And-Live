import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebRtcManagerCallbacks } from '@baker/sdk';

const createOffer = vi.fn();
const handleOffer = vi.fn();
const handleAnswer = vi.fn();
const addIceCandidate = vi.fn();
const restartIce = vi.fn();
const closePeer = vi.fn();
const closeAll = vi.fn();
const getPeerIds = vi.fn((): string[] => []);
const { playVoiceSfx } = vi.hoisted(() => ({
  playVoiceSfx: vi.fn(),
}));
let analyserAmplitude = 0;
const OriginalMediaStream = globalThis.MediaStream;
const OriginalAudioContext = globalThis.AudioContext;

class MockTrack {
  enabled = true;
  id: string;
  kind: 'audio' | 'video';
  muted = false;
  readyState: MediaStreamTrackState = 'live';
  stop = vi.fn();

  constructor(id: string, kind: 'audio' | 'video') {
    this.id = id;
    this.kind = kind;
  }
}

class MockMediaStream {
  private readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks() {
    return [...this.tracks];
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

class MockAudioContext {
  createAnalyser() {
    return {
      fftSize: 0,
      frequencyBinCount: 4,
      disconnect() {},
      getFloatTimeDomainData(buffer: Float32Array) {
        buffer.fill(analyserAmplitude);
      },
    };
  }

  createGain() {
    return {
      connect() {},
      gain: { value: 1 },
    };
  }

  createMediaStreamDestination() {
    return {
      stream: new MockMediaStream([new MockTrack('send-audio-track', 'audio') as unknown as MediaStreamTrack]),
    };
  }

  createMediaStreamSource(_stream: MediaStream) {
    return {
      connect() {},
    };
  }

  close() {
    return Promise.resolve();
  }

  resume() {
    return Promise.resolve();
  }
}

vi.mock('@baker/sdk', () => {
  class MockWebRtcManager {
    constructor(_callbacks: WebRtcManagerCallbacks) {}

    createOffer = createOffer;
    handleOffer = handleOffer;
    handleAnswer = handleAnswer;
    addIceCandidate = addIceCandidate;
    restartIce = restartIce;
    closePeer = closePeer;
    closeAll = closeAll;
    getPeerIds = getPeerIds;
  }

  return {
    WebRtcManager: MockWebRtcManager,
  };
});

vi.mock('./voice-sfx', () => ({
  playVoiceSfx,
}));

import { useAuthStore } from '../auth/auth-store';
import { useGatewayStore } from '../gateway/gateway-store';
import { useVoiceStore } from './voice-store';

const channelId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const peerSessionId = '44444444-4444-4444-8444-444444444444';
const sessionIdB = '55555555-5555-4555-8555-555555555555';
const getUserMedia = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  analyserAmplitude = 0;
  createOffer.mockReset();
  createOffer.mockResolvedValue({ sdp: 'mock-offer-sdp', type: 'offer' });
  handleOffer.mockReset();
  handleOffer.mockResolvedValue({ sdp: 'mock-answer-sdp', type: 'answer' });
  handleAnswer.mockReset();
  handleAnswer.mockResolvedValue(undefined);
  addIceCandidate.mockReset();
  addIceCandidate.mockResolvedValue(undefined);
  restartIce.mockReset();
  restartIce.mockResolvedValue(null);
  closePeer.mockReset();
  closeAll.mockReset();
  getPeerIds.mockReset();
  getPeerIds.mockReturnValue([]);
  playVoiceSfx.mockReset();

  globalThis.MediaStream = MockMediaStream as unknown as typeof MediaStream;
  globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
    },
  });

  getUserMedia.mockResolvedValue(
    new MockMediaStream([new MockTrack('capture-audio-track', 'audio') as unknown as MediaStreamTrack]),
  );

  useAuthStore.setState({
    accessToken: null,
    error: null,
    isLoading: false,
    refreshToken: null,
    user: {
      email: 'voice@example.com',
      id: userId,
      username: 'voice-user',
    },
  });

  useVoiceStore.setState({
    channelId: null,
    error: null,
    inputVolume: 1,
    isMuted: false,
    participantPlaybackVolume: {},
    participants: [],
    playbackVolume: 1,
    speakingUserIds: new Set(),
    status: 'idle',
  });

  useGatewayStore.setState({
    error: null,
    gatewayRttMs: null,
    presenceMap: {},
    reconnectAttempt: 0,
    status: 'ready',
    voiceNetworkByChannel: {},
    voiceRosterByChannel: {},
  });
});

afterEach(async () => {
  if (useVoiceStore.getState().status === 'active') {
    await useVoiceStore.getState().leaveVoiceChannel(async () => ({ channelId }));
  }
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  globalThis.MediaStream = OriginalMediaStream;
  globalThis.AudioContext = OriginalAudioContext;
});

describe('voice channel switch', () => {
  const channelIdB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const peerId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  it('sends end signals and voice.leave for old channel before joining new channel', async () => {
    const sendRawCommand = vi.fn();
    // Calls in order: voice.join(A) → voice.leave(A) [best-effort] → voice.join(B)
    const sendCommandAwaitAck = vi.fn()
      .mockResolvedValueOnce({
        channelId,
        iceServers: [],
        participants: [
          { isMuted: false, sessionId, userId },
          { isMuted: false, sessionId: peerSessionId, userId: peerId },
        ],
        sessionId,
      })
      .mockResolvedValueOnce({}) // voice.leave(A) — best-effort
      .mockResolvedValueOnce({
        channelId: channelIdB,
        iceServers: [],
        participants: [{ isMuted: false, sessionId: sessionIdB, userId }],
        sessionId: sessionIdB,
      });

    getPeerIds.mockReturnValue([peerId]);

    await useVoiceStore.getState().joinVoiceChannel(channelId, sendCommandAwaitAck, sendRawCommand);
    expect(useVoiceStore.getState().status).toBe('active');

    sendRawCommand.mockClear();
    sendCommandAwaitAck.mockClear();

    await useVoiceStore.getState().joinVoiceChannel(channelIdB, sendCommandAwaitAck, sendRawCommand);

    // end signal dispatched to peer in old channel
    expect(sendRawCommand).toHaveBeenCalledWith(
      'media.signal.end',
      expect.objectContaining({ targetUserId: peerId }),
    );

    // voice.leave sent for old channel before joining new one
    const calls = sendCommandAwaitAck.mock.calls as [string, Record<string, unknown>][];
    const leaveCall = calls.find(([cmd]) => cmd === 'voice.leave');
    expect(leaveCall).toBeDefined();
    expect(leaveCall![1]).toEqual({ channelId });

    // now active in the new channel
    expect(useVoiceStore.getState().status).toBe('active');
    expect(useVoiceStore.getState().channelId).toBe(channelIdB);
  });
});

describe('voice mute behavior', () => {
  it('stops reporting local speaking while muted', async () => {
    const sendRawCommand = vi.fn();

    await useVoiceStore.getState().joinVoiceChannel(
      channelId,
      async () => ({
        channelId,
        iceServers: [],
        participants: [
          {
            isMuted: false,
            sessionId,
            userId,
          },
        ],
        sessionId,
      }),
      sendRawCommand,
    );

    analyserAmplitude = 0.1;
    vi.advanceTimersByTime(250);

    expect(sendRawCommand).toHaveBeenCalledWith('voice.speaking.updated', {
      channelId,
      isMuted: false,
      isSpeaking: true,
    });
    expect(useVoiceStore.getState().speakingUserIds.has(userId)).toBe(true);

    const positiveSpeakingCallsBeforeMute = sendRawCommand.mock.calls.filter(
      ([command, payload]) =>
        command === 'voice.speaking.updated' &&
        typeof payload === 'object' &&
        payload !== null &&
        'isSpeaking' in payload &&
        payload.isSpeaking === true,
    ).length;

    useVoiceStore.getState().toggleMute(sendRawCommand);

    expect(useVoiceStore.getState().isMuted).toBe(true);
    expect(useVoiceStore.getState().speakingUserIds.has(userId)).toBe(false);
    expect(sendRawCommand).toHaveBeenLastCalledWith('voice.speaking.updated', {
      channelId,
      isMuted: true,
      isSpeaking: false,
    });

    analyserAmplitude = 0.1;
    vi.advanceTimersByTime(500);

    const positiveSpeakingCallsAfterMute = sendRawCommand.mock.calls.filter(
      ([command, payload]) =>
        command === 'voice.speaking.updated' &&
        typeof payload === 'object' &&
        payload !== null &&
        'isSpeaking' in payload &&
        payload.isSpeaking === true,
    ).length;

    expect(positiveSpeakingCallsAfterMute).toBe(positiveSpeakingCallsBeforeMute);
  });

  it('preserves local mute state across gateway reconnect and resyncs it to the gateway', async () => {
    const sendRawCommand = vi.fn();

    await useVoiceStore.getState().joinVoiceChannel(
      channelId,
      async () => ({
        channelId,
        iceServers: [],
        participants: [
          {
            isMuted: false,
            sessionId,
            userId,
          },
        ],
        sessionId,
      }),
      sendRawCommand,
    );

    useVoiceStore.getState().toggleMute(sendRawCommand);
    expect(useVoiceStore.getState().isMuted).toBe(true);

    sendRawCommand.mockClear();

    useVoiceStore.getState().handleGatewayWillReconnect();
    expect(useVoiceStore.getState().status).toBe('reconnecting');

    await useVoiceStore.getState().handleGatewayReconnected();

    expect(useVoiceStore.getState().status).toBe('active');
    expect(useVoiceStore.getState().isMuted).toBe(true);
    expect(sendRawCommand).toHaveBeenCalledWith('voice.speaking.updated', {
      channelId,
      isMuted: true,
      isSpeaking: false,
    });
  });
});

describe('voice join cues', () => {
  it('plays a peer_join cue even when this client is not the offer initiator', async () => {
    const sendRawCommand = vi.fn();
    const higherPeerId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const joiningPeerId = '11111111-2222-4333-8444-555555555555';

    await useVoiceStore.getState().joinVoiceChannel(
      channelId,
      async () => ({
        channelId,
        iceServers: [],
        participants: [
          { isMuted: false, sessionId, userId },
          { isMuted: false, sessionId: peerSessionId, userId: higherPeerId },
        ],
        sessionId,
      }),
      sendRawCommand,
    );

    playVoiceSfx.mockClear();
    createOffer.mockClear();

    useVoiceStore.getState().handleVoiceStateUpdated({
      channelId,
      participants: [
        { isMuted: false, sessionId, userId },
        { isMuted: false, sessionId: peerSessionId, userId: higherPeerId },
        {
          isMuted: false,
          sessionId: '66666666-6666-4666-8666-666666666666',
          userId: joiningPeerId,
        },
      ],
    });

    expect(playVoiceSfx).toHaveBeenCalledWith('peer_join');
    expect(createOffer).not.toHaveBeenCalled();
  });
});
