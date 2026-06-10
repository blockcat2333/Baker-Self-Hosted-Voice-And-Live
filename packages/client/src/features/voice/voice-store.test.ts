import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebRtcManagerCallbacks } from '@baker/sdk';

const createOffer = vi.fn();
const handleOffer = vi.fn();
const handleAnswer = vi.fn();
const addIceCandidate = vi.fn();
const restartIce = vi.fn();
const replaceOutgoingAudioTrack = vi.fn();
const closePeer = vi.fn();
const closeAll = vi.fn();
const getPeerIds = vi.fn((): string[] => []);
const getLocalOutboundNetworkSample = vi.fn();
const sfuLoad = vi.fn();
const sfuProduceTracks = vi.fn();
const sfuConsumeProducer = vi.fn();
const sfuReplaceProducedTrack = vi.fn();
const sfuGetLocalOutboundNetworkSample = vi.fn();
const sfuClose = vi.fn();
let latestCallbacks: WebRtcManagerCallbacks | null = null;
const { playVoiceSfx } = vi.hoisted(() => ({
  playVoiceSfx: vi.fn(),
}));
let analyserAmplitude = 0;
const OriginalAudio = globalThis.Audio;
const OriginalMediaStream = globalThis.MediaStream;
const OriginalAudioContext = globalThis.AudioContext;
const OriginalNavigator = globalThis.navigator;
const OriginalRTCPeerConnection = globalThis.RTCPeerConnection;
const OriginalWindow = globalThis.window;
const audioElements: MockAudio[] = [];
const mockGainNodes: Array<{ gain: { value: number } }> = [];

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

class MockAudio {
  autoplay = false;
  pause = vi.fn();
  play = vi.fn().mockResolvedValue(undefined);
  srcObject: MediaStream | null = null;
  private currentVolume = 1;

  constructor() {
    audioElements.push(this);
  }

  get volume() {
    return this.currentVolume;
  }

  set volume(value: number) {
    if (value < 0 || value > 1) {
      throw new Error(
        `HTMLMediaElement volume must be between 0 and 1, received ${value}.`,
      );
    }
    this.currentVolume = value;
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
    const gainNode = {
      connect() {},
      gain: { value: 1 },
    };
    mockGainNodes.push(gainNode);
    return gainNode;
  }

  createMediaStreamDestination() {
    return {
      stream: new MockMediaStream([
        new MockTrack(
          'send-audio-track',
          'audio',
        ) as unknown as MediaStreamTrack,
      ]),
    };
  }

  createMediaStreamSource(_stream: MediaStream) {
    return {
      connect() {},
    };
  }

  createMediaElementSource(_audio: HTMLAudioElement) {
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
    constructor(callbacks: WebRtcManagerCallbacks) {
      latestCallbacks = callbacks;
    }

    createOffer = createOffer;
    handleOffer = handleOffer;
    handleAnswer = handleAnswer;
    addIceCandidate = addIceCandidate;
    restartIce = restartIce;
    replaceOutgoingAudioTrack = replaceOutgoingAudioTrack;
    closePeer = closePeer;
    closeAll = closeAll;
    getPeerIds = getPeerIds;
    getLocalOutboundNetworkSample = getLocalOutboundNetworkSample;
  }

  return {
    SfuClientSession: class MockSfuClientSession {
      load = sfuLoad;
      produceTracks = sfuProduceTracks;
      consumeProducer = sfuConsumeProducer;
      replaceProducedTrack = sfuReplaceProducedTrack;
      getLocalOutboundNetworkSample = sfuGetLocalOutboundNetworkSample;
      close = sfuClose;
    },
    WebRtcManager: MockWebRtcManager,
  };
});

vi.mock('./voice-sfx', () => ({
  playVoiceSfx,
}));

import { useAuthStore } from '../auth/auth-store';
import { useGatewayStore } from '../gateway/gateway-store';
import { useAudioDeviceStore } from '../media/audio-device-store';
import { CLIENT_PREFERENCES_STORAGE_KEY } from '../preferences/client-preferences';
import { useVoiceStore } from './voice-store';

const channelId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const peerSessionId = '44444444-4444-4444-8444-444444444444';
const sessionIdB = '55555555-5555-4555-8555-555555555555';
const getUserMedia = vi.fn();

function createMockStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    get length() {
      return values.size;
    },
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

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
  replaceOutgoingAudioTrack.mockReset();
  replaceOutgoingAudioTrack.mockResolvedValue(undefined);
  closePeer.mockReset();
  closeAll.mockReset();
  getPeerIds.mockReset();
  getPeerIds.mockReturnValue([]);
  getLocalOutboundNetworkSample.mockReset();
  getLocalOutboundNetworkSample.mockResolvedValue(null);
  sfuLoad.mockReset();
  sfuLoad.mockResolvedValue(undefined);
  sfuProduceTracks.mockReset();
  sfuProduceTracks.mockResolvedValue(undefined);
  sfuConsumeProducer.mockReset();
  sfuConsumeProducer.mockResolvedValue(null);
  sfuReplaceProducedTrack.mockReset();
  sfuReplaceProducedTrack.mockResolvedValue(undefined);
  sfuGetLocalOutboundNetworkSample.mockReset();
  sfuGetLocalOutboundNetworkSample.mockResolvedValue(null);
  sfuClose.mockReset();
  playVoiceSfx.mockReset();
  latestCallbacks = null;
  audioElements.length = 0;
  mockGainNodes.length = 0;

  globalThis.Audio = MockAudio as unknown as typeof Audio;
  globalThis.MediaStream = MockMediaStream as unknown as typeof MediaStream;
  globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: createMockStorage(),
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: globalThis.navigator ?? {},
  });
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
    },
  });

  getUserMedia.mockResolvedValue(
    new MockMediaStream([
      new MockTrack(
        'capture-audio-track',
        'audio',
      ) as unknown as MediaStreamTrack,
    ]),
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
    connectionIssue: null,
    error: null,
    inputVolume: 1,
    isMuted: false,
    localMediaSelfLossPct: null,
    localMediaSelfUpdatedAt: null,
    participantPlaybackVolume: {},
    participants: [],
    playbackVolume: 1,
    peerNetwork: {},
    speakingUserIds: new Set(),
    status: 'idle',
  });

  useAudioDeviceStore.setState({
    audioInputDevices: [],
    audioOutputDevices: [],
    error: null,
    isRefreshing: false,
    selectedAudioInputId: null,
    selectedAudioOutputId: null,
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
    await useVoiceStore
      .getState()
      .leaveVoiceChannel(async () => ({ channelId }));
  }
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  globalThis.Audio = OriginalAudio;
  globalThis.MediaStream = OriginalMediaStream;
  globalThis.AudioContext = OriginalAudioContext;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: OriginalNavigator,
  });
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: OriginalRTCPeerConnection,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: OriginalWindow,
  });
});

describe('participant playback volume preferences', () => {
  it('persists participant playback volume by user id', () => {
    useVoiceStore.getState().setParticipantPlaybackVolume('peer-user', 1.5);

    const raw = window.localStorage.getItem(CLIENT_PREFERENCES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      voiceParticipantPlaybackVolume: {
        'peer-user': 1.5,
      },
    });
  });

  it('removes participant playback volume preference when reset', () => {
    useVoiceStore.getState().setParticipantPlaybackVolume('peer-user', 1.5);
    useVoiceStore.getState().clearParticipantPlaybackVolume('peer-user');

    const raw = window.localStorage.getItem(CLIENT_PREFERENCES_STORAGE_KEY);
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      voiceParticipantPlaybackVolume: {},
    });
  });

  it('clamps participant playback volume before persisting', () => {
    useVoiceStore.getState().setParticipantPlaybackVolume('peer-user', 3);

    const raw = window.localStorage.getItem(CLIENT_PREFERENCES_STORAGE_KEY);
    expect(JSON.parse(raw ?? '{}')).toMatchObject({
      voiceParticipantPlaybackVolume: {
        'peer-user': 2,
      },
    });
  });

  it('clamps the media element volume and applies gain when remote audio first attaches above 100%', async () => {
    const peerUserId = '77777777-7777-4777-8777-777777777777';

    useVoiceStore.getState().setParticipantPlaybackVolume(peerUserId, 2);

    await useVoiceStore.getState().joinVoiceChannel(
      channelId,
      async () => ({
        channelId,
        iceServers: [],
        participants: [
          { isMuted: false, sessionId, userId },
          { isMuted: false, sessionId: peerSessionId, userId: peerUserId },
        ],
        sessionId,
      }),
      vi.fn(),
    );

    const track = new MockTrack(
      'remote-audio-track',
      'audio',
    ) as unknown as MediaStreamTrack;
    const stream = new MockMediaStream([track]) as unknown as MediaStream;

    expect(() =>
      latestCallbacks!.onRemoteTrack(peerUserId, track, [stream]),
    ).not.toThrow();
    expect(audioElements).toHaveLength(1);
    expect(audioElements[0]?.volume).toBe(1);
    expect(mockGainNodes.map((node) => node.gain.value)).toEqual([1, 2]);
  });
});

describe('voice channel switch', () => {
  const channelIdB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const peerId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  it('sends end signals and voice.leave for old channel before joining new channel', async () => {
    const sendRawCommand = vi.fn();
    // Calls in order: voice.join(A) → voice.leave(A) [best-effort] → voice.join(B)
    const sendCommandAwaitAck = vi
      .fn()
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

    await useVoiceStore
      .getState()
      .joinVoiceChannel(channelId, sendCommandAwaitAck, sendRawCommand);
    expect(useVoiceStore.getState().status).toBe('active');

    sendRawCommand.mockClear();
    sendCommandAwaitAck.mockClear();

    await useVoiceStore
      .getState()
      .joinVoiceChannel(channelIdB, sendCommandAwaitAck, sendRawCommand);

    // end signal dispatched to peer in old channel
    expect(sendRawCommand).toHaveBeenCalledWith(
      'media.signal.end',
      expect.objectContaining({ targetUserId: peerId }),
    );

    // voice.leave sent for old channel before joining new one
    const calls = sendCommandAwaitAck.mock.calls as [
      string,
      Record<string, unknown>,
    ][];
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

    expect(positiveSpeakingCallsAfterMute).toBe(
      positiveSpeakingCallsBeforeMute,
    );
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

describe('voice audio device selection', () => {
  it('uses the selected microphone when joining a voice channel', async () => {
    useAudioDeviceStore.getState().setSelectedAudioInputId('desk-mic');

    await useVoiceStore.getState().joinVoiceChannel(
      channelId,
      async () => ({
        channelId,
        iceServers: [],
        participants: [{ isMuted: false, sessionId, userId }],
        sessionId,
      }),
      vi.fn(),
    );

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: true,
        deviceId: { exact: 'desk-mic' },
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  });

  it('replaces the active outgoing audio track when the microphone changes', async () => {
    await useVoiceStore.getState().joinVoiceChannel(
      channelId,
      async () => ({
        channelId,
        iceServers: [],
        participants: [
          { isMuted: false, sessionId, userId },
          {
            isMuted: false,
            sessionId: peerSessionId,
            userId: '77777777-7777-4777-8777-777777777777',
          },
        ],
        sessionId,
      }),
      vi.fn(),
    );

    useAudioDeviceStore.getState().setSelectedAudioInputId('headset-mic');
    await useVoiceStore.getState().switchAudioInputDevice();

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: {
        autoGainControl: true,
        deviceId: { exact: 'headset-mic' },
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    expect(replaceOutgoingAudioTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'send-audio-track', kind: 'audio' }),
    );
    expect(useVoiceStore.getState().status).toBe('active');
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

describe('voice media network stats', () => {
  it('self-reports SFU local media loss from outbound producer stats', async () => {
    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      configurable: true,
      value: function MockRTCPeerConnection() {},
    });

    const sendRawCommand = vi.fn();
    const sendCommandAwaitAck = vi.fn().mockResolvedValue({
      channelId,
      iceServers: [],
      mediaMode: 'sfu',
      participants: [{ isMuted: false, sessionId, userId }],
      sessionId,
      sfu: {
        producers: [],
        routerRtpCapabilities: {},
      },
    });

    sfuGetLocalOutboundNetworkSample
      .mockResolvedValueOnce({ packetsLost: 0, packetsSent: 100 })
      .mockResolvedValueOnce({ packetsLost: 2, packetsSent: 198 });

    await useVoiceStore
      .getState()
      .joinVoiceChannel(channelId, sendCommandAwaitAck, sendRawCommand);
    await Promise.resolve();

    expect(sfuLoad).toHaveBeenCalledOnce();
    expect(sfuProduceTracks).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'send-audio-track', kind: 'audio' }),
    ]);
    expect(sendRawCommand).not.toHaveBeenCalledWith(
      'voice.network.self_report',
      expect.anything(),
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(useVoiceStore.getState().localMediaSelfLossPct).toBe(2);
    expect(sendRawCommand).toHaveBeenCalledWith('voice.network.self_report', {
      channelId,
      mediaSelfLossPct: 2,
    });
  });
});

describe('voice connection issues', () => {
  it('surfaces and clears a connection error when a peer stays failed', async () => {
    const sendRawCommand = vi.fn();
    const peerId = '77777777-7777-4777-8777-777777777777';

    await useVoiceStore.getState().joinVoiceChannel(
      channelId,
      async () => ({
        channelId,
        iceServers: [],
        participants: [
          { isMuted: false, sessionId, userId },
          { isMuted: false, sessionId: peerSessionId, userId: peerId },
        ],
        sessionId,
      }),
      sendRawCommand,
    );

    expect(latestCallbacks).not.toBeNull();

    latestCallbacks!.onPeerConnectionStateChange(peerId, 'failed');
    vi.advanceTimersByTime(2_000);

    expect(useVoiceStore.getState().connectionIssue).toBe('connection_error');

    latestCallbacks!.onPeerConnectionStateChange(peerId, 'connected');

    expect(useVoiceStore.getState().connectionIssue).toBeNull();
  });
});
