/**
 * Voice store manages the full lifecycle of a voice channel session.
 *
 * Phases:
 *   idle -> requesting_mic -> joining -> active -> leaving -> idle
 *   (any phase) -> error on unrecoverable failure
 *
 * WebRTC:
 *   P2P (no SFU). Current user sends an offer to every participant already
 *   in the room at join time, and to any new participant when voice.state.updated
 *   is received.
 */

import { create } from 'zustand';

import type {
  GatewayCommandName,
  IceServer,
  MediaSignalRelayEventData,
  VoiceMemberUpdatedEventData,
  VoiceParticipant,
  VoiceSpeakingUpdatedEventData,
  VoiceStateUpdatedEventData,
} from '@baker/protocol';
import { VoiceJoinAckDataSchema } from '@baker/protocol';
import { WebRtcManager } from '@baker/sdk';

import { useAuthStore } from '../auth/auth-store';
import { useGatewayStore } from '../gateway/gateway-store';
import {
  clampVoiceInputVolume,
  clampVoicePlaybackVolume,
  computeEffectiveParticipantPlaybackVolume,
  DEFAULT_VOICE_INPUT_VOLUME,
  DEFAULT_VOICE_PARTICIPANT_VOLUME,
  DEFAULT_VOICE_PLAYBACK_VOLUME,
} from './voice-audio';
import { playVoiceSfx } from './voice-sfx';

const SPEAKING_POLL_MS = 100;
const SPEAKING_TRANSITION_TICKS = 2;
const SPEAKING_THRESHOLD = 0.02;

let localCaptureStream: MediaStream | null = null;
let localSendStream: MediaStream | null = null;
let webrtcManager: WebRtcManager | null = null;

let speakingAudioCtx: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let speakingTimer: ReturnType<typeof setInterval> | null = null;
let speakingTicks = 0;
let isSpeakingLocal = false;

let micProcessingCtx: AudioContext | null = null;
let micGainNode: GainNode | null = null;

let savedChannelId: string | null = null;
let savedMySessionId: string | null = null;
let savedMyUserId: string | null = null;
let savedIceServers: IceServer[] = [];
let savedSendRawCommand: ((command: GatewayCommandName, data: unknown) => void) | null = null;
let savedSendCommandAwaitAck:
  | ((command: GatewayCommandName, data: unknown, timeoutMs?: number) => Promise<unknown>)
  | null = null;
let lastLocalMuteChangedAtMs = 0;
let lastLocalMuteValue: boolean | null = null;

const remoteAudioElements = new Map<string, HTMLAudioElement>();

function attachRemoteAudio(audio: HTMLAudioElement) {
  if (typeof document !== 'undefined') {
    audio.style.display = 'none';
    document.body.appendChild(audio);
  }
}

function detachRemoteAudio(audio: HTMLAudioElement) {
  audio.pause();
  audio.srcObject = null;
  audio.parentNode?.removeChild(audio);
}

let networkStatsTimer: ReturnType<typeof setInterval> | null = null;
let networkStatsInFlight = false;
const lastInboundTotals = new Map<string, { packetsLost: number; packetsReceived: number }>();
const lastIceRestartRequestAt = new Map<string, number>();
const pendingIceRestartTimers = new Map<string, ReturnType<typeof setTimeout>>();
let lastLocalMediaReportAtMs = 0;
let lastLocalOutboundTotals: { packetsLost: number; packetsSent: number } | null = null;
const SELF_REPORT_INTERVAL_MS = 2_000;

export type VoiceStatus = 'idle' | 'requesting_mic' | 'joining' | 'reconnecting' | 'active' | 'leaving' | 'error';

function getMicUnavailableReason(): string | null {
  if (typeof navigator === 'undefined') return 'not_connected';
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    // Non-secure context (HTTP on mobile) or very old browser
    return 'insecure_context';
  }
  return null;
}

export interface VoiceState {
  status: VoiceStatus;
  channelId: string | null;
  participants: VoiceParticipant[];
  speakingUserIds: Set<string>;
  isMuted: boolean;
  error: string | null;
  inputVolume: number;
  playbackVolume: number;
  participantPlaybackVolume: Record<string, number>;
  localMediaSelfLossPct: number | null;
  localMediaSelfUpdatedAt: number | null;
  peerNetwork: Record<string, { lossPct: number | null; rttMs: number | null; updatedAt: number; connectionState?: RTCPeerConnectionState }>;

  joinVoiceChannel(
    channelId: string,
    sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
    sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
  ): Promise<void>;

  leaveVoiceChannel(
    sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
  ): Promise<void>;

  toggleMute(sendRawCommand: (command: GatewayCommandName, data: unknown) => void): void;
  setInputVolume(volume: number): void;
  setPlaybackVolume(volume: number): void;
  setParticipantPlaybackVolume(userId: string, volume: number): void;
  clearParticipantPlaybackVolume(userId: string): void;

  handleVoiceStateUpdated(data: VoiceStateUpdatedEventData): void;
  handleVoiceMemberUpdated(data: VoiceMemberUpdatedEventData): void;
  handleVoiceSpeakingUpdated(data: VoiceSpeakingUpdatedEventData): void;
  handleMediaSignal(data: MediaSignalRelayEventData): void;
  /** Called before the gateway store starts a reconnect loop (keep local media, rejoin later). */
  handleGatewayWillReconnect(): void;
  /** Called after the gateway reconnects/authenticates (attempt to rejoin the previous voice channel). */
  handleGatewayReconnected(): Promise<void>;
  /** Called when the gateway connection drops or the user explicitly disconnects. */
  handleGatewayDisconnected(): void;
  /** Dismiss a voice error and return to idle so the user can retry. */
  clearError(): void;
}

function mySessionDescriptor() {
  return {
    channelId: savedChannelId!,
    mode: 'voice' as const,
    sessionId: savedMySessionId!,
    userId: savedMyUserId!,
  };
}

function sendSignal(
  targetUserId: string,
  payload: {
    type: 'offer' | 'answer' | 'ice_candidate' | 'restart_ice' | 'end';
    sdp?: string;
    candidate?: {
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    };
  },
) {
  if (!savedSendRawCommand || !savedChannelId) return;
  const cmdMap: Record<string, GatewayCommandName> = {
    answer: 'media.signal.answer',
    end: 'media.signal.end',
    ice_candidate: 'media.signal.ice_candidate',
    offer: 'media.signal.offer',
    restart_ice: 'media.signal.restart_ice',
  };
  const cmd = cmdMap[payload.type];
  if (!cmd) return;
  savedSendRawCommand(cmd, {
    signal: { ...payload, session: mySessionDescriptor() },
    targetUserId,
  });
}

function getEffectivePlaybackVolumeForUser(userId: string) {
  const state = useVoiceStore.getState();
  const perUser = state.participantPlaybackVolume[userId] ?? DEFAULT_VOICE_PARTICIPANT_VOLUME;
  return computeEffectiveParticipantPlaybackVolume(state.playbackVolume, perUser);
}

function applyRemoteAudioElementVolumeForUser(userId: string) {
  const audio = remoteAudioElements.get(userId);
  if (!audio) return;
  audio.volume = getEffectivePlaybackVolumeForUser(userId);
}

function syncRemoteAudioElementVolumes() {
  for (const [userId] of remoteAudioElements) {
    applyRemoteAudioElementVolumeForUser(userId);
  }
}

function createLocalSendStream(captureStream: MediaStream, inputVolume: number): MediaStream {
  const clampedInputVolume = clampVoiceInputVolume(inputVolume);
  try {
    micProcessingCtx = new AudioContext();
    const source = micProcessingCtx.createMediaStreamSource(captureStream);
    micGainNode = micProcessingCtx.createGain();
    micGainNode.gain.value = clampedInputVolume;
    const destination = micProcessingCtx.createMediaStreamDestination();
    source.connect(micGainNode);
    micGainNode.connect(destination);
    void micProcessingCtx.resume().catch(() => {
      // Some browsers keep this suspended until user gesture. Join flow is already user-triggered.
    });
    return new MediaStream(destination.stream.getAudioTracks());
  } catch {
    if (micProcessingCtx) {
      void micProcessingCtx.close();
    }
    micProcessingCtx = null;
    micGainNode = null;
    return captureStream;
  }
}

function createManager(): WebRtcManager {
  return new WebRtcManager({
    onLocalIceCandidate(targetUserId, candidate) {
      sendSignal(targetUserId, {
        type: 'ice_candidate',
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        },
      });
    },
    onRemoteTrack(fromUserId, track, streams) {
      if (track.kind !== 'audio') return;
      let audio = remoteAudioElements.get(fromUserId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        // Attach to the DOM so Chrome's autoplay policy allows play() to succeed.
        // Audio elements not in the document tree are often blocked by the browser.
        attachRemoteAudio(audio);
        remoteAudioElements.set(fromUserId, audio);
      }
      audio.srcObject = streams[0] ?? new MediaStream([track]);
      audio.volume = getEffectivePlaybackVolumeForUser(fromUserId);
      audio.play().catch((err) => {
        console.warn('[voice] remote audio play() blocked:', err);
      });
    },
    onPeerConnectionStateChange(userId, state) {
      // Track connection state for diagnostics (shown in VoicePanel per-participant).
      useVoiceStore.setState((prev) => ({
        peerNetwork: {
          ...prev.peerNetwork,
          [userId]: {
            lossPct: null,
            rttMs: null,
            updatedAt: Date.now(),
            ...prev.peerNetwork[userId],
            connectionState: state,
          },
        },
      }));

      // Best-effort: ask the remote peer to restart ICE after transient network drops.
      // This helps recover audio without forcing a full leave/join cycle.
      const store = useVoiceStore.getState();
      if (store.status !== 'active') return;

      if (state !== 'disconnected' && state !== 'failed') {
        if (state === 'connected') {
          lastIceRestartRequestAt.delete(userId);
          const timer = pendingIceRestartTimers.get(userId);
          if (timer) {
            clearTimeout(timer);
            pendingIceRestartTimers.delete(userId);
          }
        }
        return;
      }

      const now = Date.now();
      const lastAt = lastIceRestartRequestAt.get(userId) ?? 0;
      if (now - lastAt < 10_000) return;
      if (pendingIceRestartTimers.has(userId)) return;

      const delayMs = state === 'failed' ? 0 : 1_500;
      const timer = setTimeout(() => {
        pendingIceRestartTimers.delete(userId);
        const current = useVoiceStore.getState();
        if (current.status !== 'active') return;
        lastIceRestartRequestAt.set(userId, Date.now());
        sendSignal(userId, { type: 'restart_ice' });
      }, delayMs);

      pendingIceRestartTimers.set(userId, timer);
    },
  });
}

function startSpeakingDetection() {
  const sourceStream = localSendStream ?? localCaptureStream;
  if (!sourceStream || !savedChannelId) return;

  speakingAudioCtx = new AudioContext();
  analyserNode = speakingAudioCtx.createAnalyser();
  analyserNode.fftSize = 256;
  const source = speakingAudioCtx.createMediaStreamSource(sourceStream);
  source.connect(analyserNode);

  const buf = new Float32Array(analyserNode.frequencyBinCount);

  speakingTimer = setInterval(() => {
    if (!analyserNode || !savedSendRawCommand || !savedChannelId) return;
    const { isMuted } = useVoiceStore.getState();

    if (isMuted) {
      speakingTicks = 0;
      if (isSpeakingLocal) {
        isSpeakingLocal = false;
        savedSendRawCommand('voice.speaking.updated', {
          channelId: savedChannelId,
          isMuted: true,
          isSpeaking: false,
        });
        if (savedMyUserId && savedChannelId) {
          useVoiceStore.getState().handleVoiceSpeakingUpdated({
            channelId: savedChannelId,
            isSpeaking: false,
            userId: savedMyUserId,
          });
        }
      }
      return;
    }

    analyserNode.getFloatTimeDomainData(buf);
    let sumSq = 0;
    for (const v of buf) sumSq += v * v;
    const rms = Math.sqrt(sumSq / buf.length);
    const speakingNow = rms > SPEAKING_THRESHOLD;

    if (speakingNow === isSpeakingLocal) {
      speakingTicks = 0;
    } else {
      speakingTicks += 1;
      if (speakingTicks >= SPEAKING_TRANSITION_TICKS) {
        isSpeakingLocal = speakingNow;
        speakingTicks = 0;
        savedSendRawCommand('voice.speaking.updated', {
          channelId: savedChannelId,
          isMuted,
          isSpeaking: isSpeakingLocal,
        });
        if (savedMyUserId && savedChannelId) {
          useVoiceStore.getState().handleVoiceSpeakingUpdated({
            channelId: savedChannelId,
            isSpeaking: isSpeakingLocal,
            userId: savedMyUserId,
          });
        }
      }
    }
  }, SPEAKING_POLL_MS);
}

function teardown() {
  stopNetworkStatsPolling();
  stopSpeakingDetection();

  if (micProcessingCtx) {
    void micProcessingCtx.close();
    micProcessingCtx = null;
  }
  micGainNode = null;

  if (webrtcManager) {
    webrtcManager.closeAll();
    webrtcManager = null;
  }

  for (const [, audio] of remoteAudioElements) {
    detachRemoteAudio(audio);
  }
  remoteAudioElements.clear();

  const tracksToStop = new Map<string, MediaStreamTrack>();
  for (const track of localCaptureStream?.getTracks() ?? []) {
    tracksToStop.set(track.id, track);
  }
  for (const track of localSendStream?.getTracks() ?? []) {
    tracksToStop.set(track.id, track);
  }
  for (const [, track] of tracksToStop) {
    track.stop();
  }
  localCaptureStream = null;
  localSendStream = null;

  savedChannelId = null;
  savedMySessionId = null;
  savedMyUserId = null;
  savedIceServers = [];
  savedSendRawCommand = null;
  savedSendCommandAwaitAck = null;
}

function teardownPeersForReconnect() {
  stopNetworkStatsPolling();
  stopSpeakingDetection();

  if (webrtcManager) {
    webrtcManager.closeAll();
    webrtcManager = null;
  }

  for (const [, audio] of remoteAudioElements) {
    detachRemoteAudio(audio);
  }
  remoteAudioElements.clear();

  // Keep local streams and mic processing so a reconnect does not prompt again.
  savedMySessionId = null;
  savedMyUserId = null;
  savedIceServers = [];
}

function stopSpeakingDetection() {
  if (speakingTimer) {
    clearInterval(speakingTimer);
    speakingTimer = null;
  }
  speakingTicks = 0;
  isSpeakingLocal = false;

  if (analyserNode) {
    analyserNode.disconnect();
    analyserNode = null;
  }

  if (speakingAudioCtx) {
    void speakingAudioCtx.close().catch(() => {
      // ignore
    });
  }
  speakingAudioCtx = null;
}

function stopNetworkStatsPolling() {
  if (networkStatsTimer !== null) {
    clearInterval(networkStatsTimer);
    networkStatsTimer = null;
  }
  networkStatsInFlight = false;
  lastInboundTotals.clear();
  lastLocalOutboundTotals = null;
  lastLocalMediaReportAtMs = 0;
  for (const [, timer] of pendingIceRestartTimers) {
    clearTimeout(timer);
  }
  pendingIceRestartTimers.clear();
  lastIceRestartRequestAt.clear();
}

function applyLocalMuteToTracks(isMuted: boolean) {
  const sendStream = localSendStream ?? localCaptureStream;
  if (!sendStream) return;

  for (const track of sendStream.getAudioTracks()) {
    track.enabled = !isMuted;
  }
}

async function pollPeerNetworkStats() {
  const manager = webrtcManager;
  if (!manager) return;
  if (networkStatsInFlight) return;
  networkStatsInFlight = true;
  try {
    const peerIds = manager.getPeerIds();
    const samples = peerIds.length > 0
      ? await Promise.all(
          peerIds.map(async (userId) => {
            const sample = await manager.getPeerNetworkSample(userId);
            return { userId, sample };
          }),
        )
      : [];

    const localOutboundSample = await manager.getLocalOutboundNetworkSample();
    const now = Date.now();
    const next: Record<string, { lossPct: number | null; rttMs: number | null; updatedAt: number }> = {};

    for (const { userId, sample } of samples) {
      if (!sample) continue;
      const prevTotals = lastInboundTotals.get(userId);
      const received = sample.packetsReceived;
      const lost = sample.packetsLost;

      let lossPct: number | null = null;
      if (received !== null && lost !== null) {
        if (prevTotals) {
          const deltaReceived = Math.max(0, received - prevTotals.packetsReceived);
          const deltaLost = Math.max(0, lost - prevTotals.packetsLost);
          const denom = deltaReceived + deltaLost;
          if (denom > 0) {
            lossPct = (deltaLost / denom) * 100;
          }
        }
        lastInboundTotals.set(userId, { packetsLost: lost, packetsReceived: received });
      }

      next[userId] = {
        lossPct,
        rttMs: sample.rttMs,
        updatedAt: now,
      };
    }

    let localMediaSelfLossPct: number | null = null;
    if (
      localOutboundSample &&
      localOutboundSample.packetsSent !== null &&
      localOutboundSample.packetsLost !== null
    ) {
      const current = {
        packetsLost: localOutboundSample.packetsLost,
        packetsSent: localOutboundSample.packetsSent,
      };
      if (lastLocalOutboundTotals) {
        const deltaSent = Math.max(0, current.packetsSent - lastLocalOutboundTotals.packetsSent);
        const deltaLost = Math.max(0, current.packetsLost - lastLocalOutboundTotals.packetsLost);
        const denom = deltaSent + deltaLost;
        if (denom > 0) {
          localMediaSelfLossPct = (deltaLost / denom) * 100;
        }
      }
      lastLocalOutboundTotals = current;
    }

    useVoiceStore.setState((state) => ({
      localMediaSelfLossPct:
        localMediaSelfLossPct === null ? state.localMediaSelfLossPct : Math.round(localMediaSelfLossPct),
      localMediaSelfUpdatedAt:
        localMediaSelfLossPct === null ? state.localMediaSelfUpdatedAt : now,
      peerNetwork: {
        ...state.peerNetwork,
        ...next,
      },
    }));

    if (
      localMediaSelfLossPct !== null &&
      savedSendRawCommand &&
      savedChannelId &&
      now - lastLocalMediaReportAtMs >= SELF_REPORT_INTERVAL_MS
    ) {
      lastLocalMediaReportAtMs = now;
      savedSendRawCommand('voice.network.self_report', {
        channelId: savedChannelId,
        mediaSelfLossPct: Math.round(localMediaSelfLossPct),
      });
    }
  } finally {
    networkStatsInFlight = false;
  }
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  status: 'idle',
  channelId: null,
  participants: [],
  speakingUserIds: new Set(),
  isMuted: false,
  error: null,
  inputVolume: DEFAULT_VOICE_INPUT_VOLUME,
  playbackVolume: DEFAULT_VOICE_PLAYBACK_VOLUME,
  participantPlaybackVolume: {},
  localMediaSelfLossPct: null,
  localMediaSelfUpdatedAt: null,
  peerNetwork: {},

  async joinVoiceChannel(channelId, sendCommandAwaitAck, sendRawCommand) {
    const { status } = get();
    if (status === 'requesting_mic' || status === 'joining' || status === 'reconnecting') return;
    if (status === 'active' && get().channelId === channelId) return;
    if (useGatewayStore.getState().status !== 'ready') {
      set({
        status: 'error',
        error: 'not_connected',
        channelId: null,
      });
      return;
    }

    if (status === 'active') {
      const prevChannelId = get().channelId;
      // Send end signals to all peers before local teardown so they know the
      // connection is being dropped intentionally (mirrors leaveVoiceChannel).
      if (webrtcManager) {
        for (const peerId of webrtcManager.getPeerIds()) {
          sendSignal(peerId, { type: 'end' });
        }
      }
      teardown();
      playVoiceSfx('self_leave');
      set({
        status: 'idle',
        channelId: null,
        participants: [],
        speakingUserIds: new Set(),
        error: null,
        localMediaSelfLossPct: null,
        localMediaSelfUpdatedAt: null,
        peerNetwork: {},
      });
      // Notify gateway so the old room is cleaned up for other participants.
      if (prevChannelId) {
        try {
          await sendCommandAwaitAck('voice.leave', { channelId: prevChannelId });
        } catch {
          // Best-effort: local teardown already completed.
        }
      }
    }

    set({ status: 'requesting_mic', channelId, error: null });

    // Guard: navigator.mediaDevices is undefined in non-secure (HTTP) contexts on mobile.
    const unavailableReason = getMicUnavailableReason();
    if (unavailableReason) {
      set({
        status: 'error',
        error: unavailableReason,
        channelId: null,
      });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      const isPermissionDenied =
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      set({
        status: 'error',
        error: isPermissionDenied ? 'mic_denied' : 'mic_denied',
        channelId: null,
      });
      return;
    }
    localCaptureStream = stream;
    localSendStream = createLocalSendStream(stream, get().inputVolume);

    set({ status: 'joining' });

    let ackData: ReturnType<typeof VoiceJoinAckDataSchema.parse>;
    try {
      const raw = await sendCommandAwaitAck('voice.join', { channelId });
      ackData = VoiceJoinAckDataSchema.parse(raw);
    } catch (err) {
      teardown();
      const msg = err instanceof Error ? err.message : 'Failed to join voice channel.';
      // Surface a structured key for gateway-not-connected so VoicePanel can localise it.
      const isNotConnected = msg.includes('not connected') || msg.includes('timed out');
      set({
        status: 'error',
        error: isNotConnected ? 'not_connected' : msg,
        channelId: null,
      });
      return;
    }

    savedChannelId = channelId;
    savedMySessionId = ackData.sessionId;
    savedMyUserId = useAuthStore.getState().user?.id ?? null;
    savedIceServers = ackData.iceServers;
    savedSendRawCommand = sendRawCommand;
    savedSendCommandAwaitAck = sendCommandAwaitAck;

    webrtcManager = createManager();
    const myUserId = savedMyUserId;
    const sendStream = localSendStream;

    for (const p of ackData.participants) {
      if (p.userId === myUserId) continue;
      if (!myUserId || myUserId > p.userId || !sendStream) continue;
      try {
        const offer = await webrtcManager.createOffer(p.userId, sendStream, ackData.iceServers);
        sendSignal(p.userId, { type: 'offer', sdp: offer.sdp ?? '' });
      } catch (err) {
        console.warn('[voice] offer failed for', p.userId, err);
      }
    }

    startSpeakingDetection();
    syncRemoteAudioElementVolumes();

    if (networkStatsTimer === null) {
      // Only poll WebRTC stats in real browser environments. In unit tests, the
      // WebRtcManager is often mocked and may not implement stats APIs.
      if (typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined') {
        networkStatsTimer = setInterval(() => {
          void pollPeerNetworkStats();
        }, 1000);
        void pollPeerNetworkStats();
      }
    }

    set({
      status: 'active',
      channelId,
      isMuted: false,
      localMediaSelfLossPct: null,
      localMediaSelfUpdatedAt: null,
      participants: ackData.participants,
      speakingUserIds: new Set(),
    });
    playVoiceSfx('self_join');
  },

  async leaveVoiceChannel(sendCommandAwaitAck) {
    const { channelId, status } = get();
    if (status !== 'active' || !channelId) return;

    set({ status: 'leaving' });

    if (webrtcManager) {
      for (const peerId of webrtcManager.getPeerIds()) {
        sendSignal(peerId, { type: 'end' });
      }
    }

    teardown();

    try {
      await sendCommandAwaitAck('voice.leave', { channelId });
    } catch {
      // Best-effort: already cleaned up locally.
    }

    set({
      status: 'idle',
      channelId: null,
      error: null,
      isMuted: false,
      localMediaSelfLossPct: null,
      localMediaSelfUpdatedAt: null,
      participants: [],
      speakingUserIds: new Set(),
      peerNetwork: {},
    });
    playVoiceSfx('self_leave');
  },

  toggleMute(sendRawCommand) {
    const { isMuted, channelId, status } = get();
    if (status !== 'active' || !channelId) return;

    const newMuted = !isMuted;
    set({ isMuted: newMuted });
    playVoiceSfx(newMuted ? 'mute' : 'unmute');
    lastLocalMuteValue = newMuted;
    lastLocalMuteChangedAtMs = Date.now();

    applyLocalMuteToTracks(newMuted);

    if (newMuted) {
      speakingTicks = 0;
      isSpeakingLocal = false;
      if (savedMyUserId) {
        get().handleVoiceSpeakingUpdated({
          channelId,
          isSpeaking: false,
          userId: savedMyUserId,
        });
      }
    }

    sendRawCommand('voice.speaking.updated', {
      channelId,
      isMuted: newMuted,
      isSpeaking: !newMuted && isSpeakingLocal,
    });
  },

  setInputVolume(volume) {
    const clampedVolume = clampVoiceInputVolume(volume);
    set({ inputVolume: clampedVolume });
    if (micGainNode) {
      micGainNode.gain.value = clampedVolume;
    }
  },

  setPlaybackVolume(volume) {
    const clampedVolume = clampVoicePlaybackVolume(volume);
    set({ playbackVolume: clampedVolume });
    syncRemoteAudioElementVolumes();
  },

  setParticipantPlaybackVolume(userId, volume) {
    const clampedVolume = clampVoicePlaybackVolume(volume);
    set((state) => ({
      participantPlaybackVolume: {
        ...state.participantPlaybackVolume,
        [userId]: clampedVolume,
      },
    }));
    applyRemoteAudioElementVolumeForUser(userId);
  },

  clearParticipantPlaybackVolume(userId) {
    set((state) => {
      if (state.participantPlaybackVolume[userId] === undefined) {
        return state;
      }
      const next = { ...state.participantPlaybackVolume };
      delete next[userId];
      return { participantPlaybackVolume: next };
    });
    applyRemoteAudioElementVolumeForUser(userId);
  },

  handleVoiceStateUpdated(data) {
    const { channelId, participants } = data;
    const { channelId: currentChannelId, status } = get();

    if (channelId !== currentChannelId) return;

    const myUserId = savedMyUserId ?? useAuthStore.getState().user?.id ?? null;

    if (status === 'active' && myUserId && !participants.some((p) => p.userId === myUserId)) {
      teardown();
      set({
        status: 'idle',
        channelId: null,
        participants: [],
        speakingUserIds: new Set(),
        error: null,
        localMediaSelfLossPct: null,
        localMediaSelfUpdatedAt: null,
        peerNetwork: {},
      });
      return;
    }

    if (status === 'active') {
      const prev = get().participants;
      const prevIds = new Set(prev.map((p) => p.userId));
      const nextIds = new Set(participants.map((p) => p.userId));

      for (const p of prev) {
        if (!nextIds.has(p.userId)) {
          if (p.userId !== myUserId) {
            playVoiceSfx('peer_leave');
          }
          webrtcManager?.closePeer(p.userId);
          const remoteAudio = remoteAudioElements.get(p.userId);
          if (remoteAudio) {
            detachRemoteAudio(remoteAudio);
            remoteAudioElements.delete(p.userId);
          }
        }
      }

      const sendStream = localSendStream;
      for (const p of participants) {
        if (prevIds.has(p.userId) || p.userId === myUserId) continue;

        playVoiceSfx('peer_join');

        if (myUserId && myUserId < p.userId && sendStream && webrtcManager) {
          void webrtcManager
            .createOffer(p.userId, sendStream, savedIceServers)
            .then((offer) => {
              sendSignal(p.userId, { type: 'offer', sdp: offer.sdp ?? '' });
            })
            .catch((err) => {
              console.warn('[voice] offer failed for new peer', p.userId, err);
            });
        }
      }
    }

    const activeUserIds = new Set(participants.map((participant) => participant.userId));
    set((state) => {
      const nextParticipantPlaybackVolume: Record<string, number> = {};
      for (const [userId, volume] of Object.entries(state.participantPlaybackVolume)) {
        if (activeUserIds.has(userId)) {
          nextParticipantPlaybackVolume[userId] = volume;
        }
      }
      return {
        participants,
        participantPlaybackVolume: nextParticipantPlaybackVolume,
      };
    });
  },

  handleVoiceMemberUpdated(data) {
    const { channelId, participant } = data;
    if (channelId !== get().channelId) return;
    const previous = get().participants.find((p) => p.userId === participant.userId);

    set((state) => ({
      participants: state.participants.map((p) =>
        p.userId === participant.userId ? { ...p, ...participant } : p,
      ),
    }));

    if (!previous || previous.isMuted === participant.isMuted) {
      return;
    }

    const myUserId = savedMyUserId ?? useAuthStore.getState().user?.id ?? null;
    const isSelf = participant.userId === myUserId;
    if (isSelf) {
      const isLocalEcho =
        lastLocalMuteValue === participant.isMuted &&
        Date.now() - lastLocalMuteChangedAtMs < 1_500;
      if (!isLocalEcho) {
        playVoiceSfx(participant.isMuted ? 'mute' : 'unmute');
      }
      return;
    }

    playVoiceSfx(participant.isMuted ? 'mute' : 'unmute');
  },

  handleVoiceSpeakingUpdated(data) {
    const { channelId, isSpeaking, userId } = data;
    if (channelId !== get().channelId) return;

    set((state) => {
      const next = new Set(state.speakingUserIds);
      if (isSpeaking) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return { speakingUserIds: next };
    });
  },

  handleMediaSignal(data) {
    const { fromUserId, signal } = data;
    const { status } = get();
    const sendStream = localSendStream;

    if (status !== 'active' || !webrtcManager || !sendStream) return;

    void (async () => {
      switch (signal.type) {
        case 'offer': {
          if (!signal.sdp) return;
          try {
            const answer = await webrtcManager!.handleOffer(
              fromUserId,
              { type: 'offer', sdp: signal.sdp },
              sendStream,
              savedIceServers,
            );
            sendSignal(fromUserId, { type: 'answer', sdp: answer.sdp ?? '' });
          } catch (err) {
            console.warn('[voice] handleOffer failed from', fromUserId, err);
          }
          break;
        }
        case 'answer': {
          if (!signal.sdp) return;
          try {
            await webrtcManager!.handleAnswer(fromUserId, { type: 'answer', sdp: signal.sdp });
          } catch (err) {
            console.warn('[voice] handleAnswer failed from', fromUserId, err);
          }
          break;
        }
        case 'ice_candidate': {
          if (!signal.candidate) return;
          try {
            await webrtcManager!.addIceCandidate(fromUserId, signal.candidate);
          } catch (err) {
            console.warn('[voice] addIceCandidate failed from', fromUserId, err);
          }
          break;
        }
        case 'restart_ice': {
          const offer = await webrtcManager!.restartIce(fromUserId);
          if (offer) sendSignal(fromUserId, { type: 'offer', sdp: offer.sdp ?? '' });
          break;
        }
        case 'end': {
          webrtcManager!.closePeer(fromUserId);
          const remoteAudio = remoteAudioElements.get(fromUserId);
          if (remoteAudio) {
            detachRemoteAudio(remoteAudio);
            remoteAudioElements.delete(fromUserId);
          }
          break;
        }
      }
    })();
  },

  handleGatewayWillReconnect() {
    const { status, channelId } = get();
    if (status === 'idle' || status === 'error') return;

    // If we never completed a join, just tear down and wait for the user to retry.
    if (!channelId) {
      teardown();
      set({
        status: 'idle',
        channelId: null,
        participants: [],
        speakingUserIds: new Set(),
        error: null,
        localMediaSelfLossPct: null,
        localMediaSelfUpdatedAt: null,
        peerNetwork: {},
      });
      return;
    }

    // Preserve local mic streams so reconnect does not prompt again; drop peers/signaling state.
    teardownPeersForReconnect();
    set({
      status: 'reconnecting',
      error: null,
      speakingUserIds: new Set(),
      peerNetwork: {},
    });
  },

  async handleGatewayReconnected() {
    const { channelId, isMuted, status } = get();
    if (status !== 'reconnecting' || !channelId) return;
    if (!savedSendCommandAwaitAck || !savedSendRawCommand) return;
    if (!localSendStream) {
      set({ status: 'error', error: 'mic_denied', channelId: null });
      return;
    }

    set({ status: 'joining', error: null });

    let ackData: ReturnType<typeof VoiceJoinAckDataSchema.parse>;
    try {
      const raw = await savedSendCommandAwaitAck('voice.join', { channelId });
      ackData = VoiceJoinAckDataSchema.parse(raw);
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'not_connected',
        channelId: null,
      });
      return;
    }

    savedChannelId = channelId;
    savedMySessionId = ackData.sessionId;
    savedMyUserId = useAuthStore.getState().user?.id ?? null;
    savedIceServers = ackData.iceServers;

    webrtcManager = createManager();
    const myUserId = savedMyUserId;
    const sendStream = localSendStream;

    for (const p of ackData.participants) {
      if (p.userId === myUserId) continue;
      if (!myUserId || myUserId > p.userId || !sendStream) continue;
      try {
        const offer = await webrtcManager.createOffer(p.userId, sendStream, ackData.iceServers);
        sendSignal(p.userId, { type: 'offer', sdp: offer.sdp ?? '' });
      } catch (err) {
        console.warn('[voice] offer failed for', p.userId, err);
      }
    }

    startSpeakingDetection();
    syncRemoteAudioElementVolumes();

    if (networkStatsTimer === null) {
      if (typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined') {
        networkStatsTimer = setInterval(() => {
          void pollPeerNetworkStats();
        }, 1000);
        void pollPeerNetworkStats();
      }
    }

    set({
      status: 'active',
      channelId,
      isMuted,
      localMediaSelfLossPct: null,
      localMediaSelfUpdatedAt: null,
      participants: ackData.participants,
      speakingUserIds: new Set(),
    });

    applyLocalMuteToTracks(isMuted);
    if (isMuted) {
      savedSendRawCommand('voice.speaking.updated', {
        channelId,
        isMuted: true,
        isSpeaking: false,
      });
    }
  },

  handleGatewayDisconnected() {
    if (get().status === 'idle') return;
    teardown();
    set({
      channelId: null,
      error: null,
      isMuted: false,
      localMediaSelfLossPct: null,
      localMediaSelfUpdatedAt: null,
      participants: [],
      speakingUserIds: new Set(),
      peerNetwork: {},
      status: 'idle',
    });
  },

  clearError() {
    if (get().status !== 'error') return;
    set({
      status: 'idle',
      error: null,
      channelId: null,
      localMediaSelfLossPct: null,
      localMediaSelfUpdatedAt: null,
    });
  },
}));
