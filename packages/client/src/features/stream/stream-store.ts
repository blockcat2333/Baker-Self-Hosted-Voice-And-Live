import { create } from 'zustand';

import type {
  GatewayCommandName,
  IceServer,
  MediaSignalRelayEventData,
  StreamPublication,
  StreamQualitySettings,
  StreamSourceType,
  StreamStateUpdatedEventData,
  StreamViewer,
} from '@baker/protocol';
import {
  StreamStartAckDataSchema,
  StreamWatchAckDataSchema,
} from '@baker/protocol';
import { WebRtcManager } from '@baker/sdk';

import { useAuthStore } from '../auth/auth-store';
import {
  buildCameraCaptureConstraints,
  buildScreenCaptureConstraints,
  clampStreamPlaybackVolume,
  DEFAULT_STREAM_CODEC_PREFERENCE,
  DEFAULT_STREAM_PLAYBACK_VOLUME,
  type StreamCodecPreference,
} from './stream-media';

export type OwnedPublishStatus = 'capturing' | 'starting' | 'live' | 'stopping';
export type WatchedStreamStatus = 'starting' | 'reconnecting' | 'watching' | 'stopping' | 'ended';

export interface OwnedPublishState {
  channelId: string;
  codecPreference: StreamCodecPreference;
  localPreviewStream: MediaStream | null;
  quality: StreamQualitySettings;
  sessionId: string | null;
  sourceType: StreamSourceType;
  status: OwnedPublishStatus;
  streamId: string | null;
  viewers: StreamViewer[];
}

export interface WatchedStreamState {
  channelId: string;
  hostSessionId: string;
  hostUserId: string;
  playbackVolume: number;
  remoteStream: MediaStream | null;
  sessionId: string;
  sourceType: StreamSourceType | null;
  status: WatchedStreamStatus;
  streamId: string;
  viewers: StreamViewer[];
}

export interface WatchedStreamVideoStats {
  bitrateKbps: number | null;
  codec: string | null;
  frameRate: number | null;
  framesDropped: number | null;
  jitterMs: number | null;
  packetsLost: number | null;
  packetsReceived: number | null;
  resolution: string | null;
}

export interface OwnedStreamVideoStats {
  activePeerCount: number;
  bitrateKbps: number | null;
  codec: string | null;
  encoderLimited: boolean;
  frameRate: number | null;
  qualityLimitationReason: 'bandwidth' | 'cpu' | 'none' | 'other';
  resolution: string | null;
}

interface StreamState {
  ownedStream: OwnedPublishState | null;
  watchedStreamsById: Record<string, WatchedStreamState>;
  roomStateByChannel: Record<string, Record<string, StreamPublication>>;
  error: string | null;

  startSharing(
    channelId: string,
    quality: StreamQualitySettings,
    sourceType: StreamSourceType,
    sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
    sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
    codecPreference?: StreamCodecPreference,
  ): Promise<void>;

  stopSharing(sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>): Promise<void>;

  watchStream(
    channelId: string,
    streamId: string,
    sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
    sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
  ): Promise<void>;

  unwatchStream(
    streamId: string,
    sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
  ): Promise<void>;

  setPlaybackVolume(streamId: string, volume: number): void;

  disconnectCurrentStream(sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>): Promise<void>;

  handleStreamStateUpdated(data: StreamStateUpdatedEventData): void;
  handleMediaSignal(data: MediaSignalRelayEventData): void;
  handleGatewayWillReconnect(): void;
  handleGatewayReconnected(
    sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
    sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
  ): Promise<void>;
  handleGatewayDisconnected(): void;
  reset(): void;
}

interface OwnedPublishRuntime {
  channelId: string;
  codecPreference: StreamCodecPreference;
  iceServers: IceServer[];
  localStream: MediaStream;
  manager: WebRtcManager;
  quality: StreamQualitySettings;
  sendRawCommand: (command: GatewayCommandName, data: unknown) => void;
  sessionId: string;
  sourceType: StreamSourceType;
  streamId: string;
  userId: string;
}

interface WatchedStreamRuntime {
  channelId: string;
  hostSessionId: string;
  hostUserId: string;
  iceServers: IceServer[];
  manager: WebRtcManager;
  remoteStream: MediaStream | null;
  sendRawCommand: (command: GatewayCommandName, data: unknown) => void;
  sessionId: string;
  streamId: string;
  userId: string;
}

let ownedRuntime: OwnedPublishRuntime | null = null;
const watchedRuntimes = new Map<string, WatchedStreamRuntime>();
const watchedReceiverSyncTimers = new Map<string, ReturnType<typeof setInterval>>();
const cancelledWatchRequests = new Set<string>();
const pendingWatchedSignals = new Map<string, MediaSignalRelayEventData[]>();
const pendingOwnedIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const pendingWatchedIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const WATCHED_RECEIVER_SYNC_INTERVAL_MS = 500;
const lastWatchedIceRestartRequestAt = new Map<string, number>();
const pendingWatchedIceRestartTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastWatchedVideoStatsSamples = new Map<string, {
  bytesReceived: number | null;
  framesDecoded: number | null;
  timestampMs: number | null;
}>();
const lastOwnedVideoStatsSample: {
  bytesSent: number | null;
  framesEncoded: number | null;
  timestampMs: number | null;
} = {
  bytesSent: null,
  framesEncoded: null,
  timestampMs: null,
};

function watchedIceQueueKey(streamId: string, hostUserId: string) {
  return `${streamId}:${hostUserId}`;
}

function formatVideoResolution(width: number | null, height: number | null): string | null {
  if (!width || !height) {
    return null;
  }

  return `${width}x${height}`;
}

function normalizeFrameRate(frameRate: number | null): number | null {
  if (!Number.isFinite(frameRate) || (frameRate ?? 0) <= 0) {
    return null;
  }

  return Math.round((frameRate ?? 0) * 10) / 10;
}

function isEncoderLikelyLimited(
  reason: OwnedStreamVideoStats['qualityLimitationReason'],
  actualFrameRate: number | null,
  targetFrameRate: number | null,
): boolean {
  if (reason === 'cpu') {
    return true;
  }

  if (
    actualFrameRate === null ||
    targetFrameRate === null ||
    !Number.isFinite(targetFrameRate) ||
    targetFrameRate <= 0 ||
    reason === 'bandwidth'
  ) {
    return false;
  }

  return actualFrameRate < Math.max(targetFrameRate * 0.85, targetFrameRate - 10);
}

function applyCaptureTrackPreferences(sourceType: StreamSourceType, stream: MediaStream) {
  for (const track of stream.getVideoTracks()) {
    if (sourceType === 'screen' && 'contentHint' in track) {
      track.contentHint = 'detail';
    }
  }
}

function getMyUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

function emptyState(): Pick<StreamState, 'error' | 'ownedStream' | 'roomStateByChannel' | 'watchedStreamsById'> {
  return {
    error: null,
    ownedStream: null,
    roomStateByChannel: {},
    watchedStreamsById: {},
  };
}

function mapStreamsById(streams: StreamPublication[]): Record<string, StreamPublication> {
  const byId: Record<string, StreamPublication> = {};
  for (const stream of streams) {
    byId[stream.streamId] = stream;
  }
  return byId;
}

function normalizePublications(data: StreamStateUpdatedEventData): StreamPublication[] {
  if (data.streams.length > 0) {
    return data.streams;
  }

  if (!data.session) {
    return [];
  }

  const streamId = data.session.streamId ?? data.session.sessionId;
  return [
    {
      channelId: data.channelId,
      hostUserId: data.session.hostUserId,
      sessionId: data.session.sessionId,
      sourceType: data.session.sourceType,
      status: data.session.status,
      streamId,
      viewers: data.viewers,
    },
  ];
}

function removeWatchedStreamState(streamId: string) {
  useStreamStore.setState((state) => {
    if (!state.watchedStreamsById[streamId]) {
      return state;
    }

    const { [streamId]: _removed, ...rest } = state.watchedStreamsById;
    return { watchedStreamsById: rest };
  });
}

function updateWatchedStreamState(streamId: string, updater: (state: WatchedStreamState) => WatchedStreamState) {
  useStreamStore.setState((state) => {
    const watched = state.watchedStreamsById[streamId];
    if (!watched) {
      return state;
    }

    return {
      watchedStreamsById: {
        ...state.watchedStreamsById,
        [streamId]: updater(watched),
      },
    };
  });
}

function sendSignal(
  sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
  descriptor: {
    channelId: string;
    mode: 'stream_publish' | 'stream_watch';
    sessionId: string;
    streamId: string;
    userId: string;
  },
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
  const commands: Record<string, GatewayCommandName> = {
    answer: 'media.signal.answer',
    end: 'media.signal.end',
    ice_candidate: 'media.signal.ice_candidate',
    offer: 'media.signal.offer',
    restart_ice: 'media.signal.restart_ice',
  };

  const command = commands[payload.type];
  if (!command) {
    return;
  }

  sendRawCommand(command, {
    signal: {
      ...payload,
      session: descriptor,
    },
    targetUserId,
  });
}

function sendOwnedSignal(
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
  if (!ownedRuntime) {
    return;
  }

  sendSignal(
    ownedRuntime.sendRawCommand,
    {
      channelId: ownedRuntime.channelId,
      mode: 'stream_publish',
      sessionId: ownedRuntime.sessionId,
      streamId: ownedRuntime.streamId,
      userId: ownedRuntime.userId,
    },
    targetUserId,
    payload,
  );
}

function sendWatchSignal(
  streamId: string,
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
  const runtime = watchedRuntimes.get(streamId);
  if (!runtime) {
    return;
  }

  sendSignal(
    runtime.sendRawCommand,
    {
      channelId: runtime.channelId,
      mode: 'stream_watch',
      sessionId: runtime.sessionId,
      streamId: runtime.streamId,
      userId: runtime.userId,
    },
    targetUserId,
    payload,
  );
}

function teardownOwnedRuntime() {
  if (!ownedRuntime) {
    return;
  }

  ownedRuntime.manager.closeAll();
  lastOwnedVideoStatsSample.bytesSent = null;
  lastOwnedVideoStatsSample.framesEncoded = null;
  lastOwnedVideoStatsSample.timestampMs = null;
  pendingOwnedIceCandidates.clear();
  for (const track of ownedRuntime.localStream.getTracks()) {
    track.stop();
  }

  ownedRuntime = null;
}

function teardownWatchedRuntime(streamId: string) {
  const runtime = watchedRuntimes.get(streamId);
  const receiverSyncTimer = watchedReceiverSyncTimers.get(streamId);
  if (receiverSyncTimer) {
    clearInterval(receiverSyncTimer);
    watchedReceiverSyncTimers.delete(streamId);
  }
  const restartTimer = pendingWatchedIceRestartTimers.get(streamId);
  if (restartTimer) {
    clearTimeout(restartTimer);
    pendingWatchedIceRestartTimers.delete(streamId);
  }
  lastWatchedIceRestartRequestAt.delete(streamId);
  lastWatchedVideoStatsSamples.delete(streamId);
  pendingWatchedSignals.delete(streamId);
  for (const key of [...pendingWatchedIceCandidates.keys()]) {
    if (key.startsWith(`${streamId}:`)) {
      pendingWatchedIceCandidates.delete(key);
    }
  }
  if (!runtime) {
    return;
  }

  runtime.manager.closeAll();
  for (const track of runtime.remoteStream?.getTracks() ?? []) {
    track.stop();
  }

  watchedRuntimes.delete(streamId);
}

function teardownAllRuntimes() {
  teardownOwnedRuntime();
  for (const streamId of [...watchedRuntimes.keys()]) {
    teardownWatchedRuntime(streamId);
  }
  for (const timer of pendingWatchedIceRestartTimers.values()) {
    clearTimeout(timer);
  }
  pendingWatchedIceRestartTimers.clear();
  lastWatchedIceRestartRequestAt.clear();
  for (const timer of watchedReceiverSyncTimers.values()) {
    clearInterval(timer);
  }
  watchedReceiverSyncTimers.clear();
  pendingOwnedIceCandidates.clear();
  pendingWatchedIceCandidates.clear();
  cancelledWatchRequests.clear();
  pendingWatchedSignals.clear();
}

function queuePendingWatchedSignal(streamId: string, data: MediaSignalRelayEventData) {
  const existing = pendingWatchedSignals.get(streamId) ?? [];
  existing.push(data);
  pendingWatchedSignals.set(streamId, existing);
}

function queuePendingOwnedIceCandidate(userId: string, candidate: RTCIceCandidateInit) {
  const existing = pendingOwnedIceCandidates.get(userId) ?? [];
  existing.push(candidate);
  pendingOwnedIceCandidates.set(userId, existing);
}

function takePendingOwnedIceCandidates(userId: string): RTCIceCandidateInit[] {
  const queued = pendingOwnedIceCandidates.get(userId) ?? [];
  pendingOwnedIceCandidates.delete(userId);
  return queued;
}

function queuePendingWatchedIceCandidate(streamId: string, hostUserId: string, candidate: RTCIceCandidateInit) {
  const key = watchedIceQueueKey(streamId, hostUserId);
  const existing = pendingWatchedIceCandidates.get(key) ?? [];
  existing.push(candidate);
  pendingWatchedIceCandidates.set(key, existing);
}

function takePendingWatchedIceCandidates(streamId: string, hostUserId: string): RTCIceCandidateInit[] {
  const key = watchedIceQueueKey(streamId, hostUserId);
  const queued = pendingWatchedIceCandidates.get(key) ?? [];
  pendingWatchedIceCandidates.delete(key);
  return queued;
}

function takePendingWatchedSignals(streamId: string): MediaSignalRelayEventData[] {
  const queued = pendingWatchedSignals.get(streamId) ?? [];
  pendingWatchedSignals.delete(streamId);
  return queued;
}

function movePendingWatchedSignals(sourceStreamId: string, targetStreamId: string) {
  if (sourceStreamId === targetStreamId) {
    return;
  }

  const sourceSignals = takePendingWatchedSignals(sourceStreamId);
  if (sourceSignals.length === 0) {
    return;
  }

  const targetSignals = pendingWatchedSignals.get(targetStreamId) ?? [];
  pendingWatchedSignals.set(targetStreamId, [...targetSignals, ...sourceSignals]);
}

function createOwnedManager(): WebRtcManager {
  return new WebRtcManager({
    onLocalIceCandidate(targetUserId, candidate) {
      sendOwnedSignal(targetUserId, {
        type: 'ice_candidate',
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        },
      });
    },
    onRemoteTrack() {
      // Publishers do not render remote media in the stream store.
    },
    onPeerConnectionStateChange() {
      // Authoritative room snapshots drive viewer reconciliation.
    },
  });
}

function syncWatchedRuntimeRemoteTracks(streamId: string) {
  const runtime = watchedRuntimes.get(streamId);
  if (!runtime) {
    return;
  }

  const receiverTracks = runtime.manager.getRemoteTracks(runtime.hostUserId);
  if (receiverTracks.length === 0) {
    return;
  }

  runtime.remoteStream ??= new MediaStream();
  for (const track of receiverTracks) {
    if (!runtime.remoteStream.getTracks().some((existing) => existing.id === track.id)) {
      runtime.remoteStream.addTrack(track);
    }
  }

  updateWatchedStreamState(streamId, (watched) => ({
    ...watched,
    remoteStream: runtime.remoteStream,
  }));
}

function createWatchedManager(streamId: string): WebRtcManager {
  return new WebRtcManager({
    onLocalIceCandidate(targetUserId, candidate) {
      sendWatchSignal(streamId, targetUserId, {
        type: 'ice_candidate',
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        },
      });
    },
    onRemoteTrack(_fromUserId, track, streams) {
      const runtime = watchedRuntimes.get(streamId);
      if (!runtime) {
        return;
      }

      runtime.remoteStream ??= new MediaStream();
      for (const incomingStream of streams) {
        for (const incomingTrack of incomingStream.getTracks()) {
          if (!runtime.remoteStream.getTracks().some((existing) => existing.id === incomingTrack.id)) {
            runtime.remoteStream.addTrack(incomingTrack);
          }
        }
      }

      if (!runtime.remoteStream.getTracks().some((existing) => existing.id === track.id)) {
        runtime.remoteStream.addTrack(track);
      }

      updateWatchedStreamState(streamId, (watched) => ({
        ...watched,
        remoteStream: runtime.remoteStream,
      }));
    },
    onPeerConnectionStateChange(fromUserId, state) {
      const runtime = watchedRuntimes.get(streamId);
      if (!runtime || runtime.hostUserId !== fromUserId) {
        return;
      }

      if (state === 'connected' || state === 'connecting') {
        syncWatchedRuntimeRemoteTracks(streamId);
        lastWatchedIceRestartRequestAt.delete(streamId);
        const timer = pendingWatchedIceRestartTimers.get(streamId);
        if (timer) {
          clearTimeout(timer);
          pendingWatchedIceRestartTimers.delete(streamId);
        }
      }

      if (state === 'disconnected' || state === 'failed') {
        const now = Date.now();
        const lastAt = lastWatchedIceRestartRequestAt.get(streamId) ?? 0;
        if (now - lastAt >= 10_000 && !pendingWatchedIceRestartTimers.has(streamId)) {
          const delayMs = state === 'failed' ? 0 : 1_500;
          const timer = setTimeout(() => {
            pendingWatchedIceRestartTimers.delete(streamId);
            const current = watchedRuntimes.get(streamId);
            if (!current || current.hostUserId !== fromUserId) return;
            lastWatchedIceRestartRequestAt.set(streamId, Date.now());
            sendWatchSignal(streamId, fromUserId, { type: 'restart_ice' });
          }, delayMs);
          pendingWatchedIceRestartTimers.set(streamId, timer);
        }
      }

      if (state === 'closed' || state === 'failed') {
        runtime.remoteStream = null;
        updateWatchedStreamState(streamId, (watched) => ({
          ...watched,
          remoteStream: null,
        }));
      }
    },
  });
}

function ensureWatchedReceiverSync(streamId: string) {
  if (watchedReceiverSyncTimers.has(streamId)) {
    return;
  }

  const timer = setInterval(() => {
    if (!watchedRuntimes.has(streamId)) {
      const staleTimer = watchedReceiverSyncTimers.get(streamId);
      if (staleTimer) {
        clearInterval(staleTimer);
        watchedReceiverSyncTimers.delete(streamId);
      }
      return;
    }

    syncWatchedRuntimeRemoteTracks(streamId);
  }, WATCHED_RECEIVER_SYNC_INTERVAL_MS);

  watchedReceiverSyncTimers.set(streamId, timer);
}

async function captureStream(sourceType: StreamSourceType, quality: StreamQualitySettings): Promise<MediaStream> {
  const stream =
    sourceType === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia(buildScreenCaptureConstraints(quality))
      : await navigator.mediaDevices.getUserMedia(buildCameraCaptureConstraints(quality));

  applyCaptureTrackPreferences(sourceType, stream);
  return stream;
}

function reconcileOwnedPublication(channelId: string, streamsById: Record<string, StreamPublication>) {
  if (!ownedRuntime || ownedRuntime.channelId !== channelId) {
    return;
  }

  const publication = streamsById[ownedRuntime.streamId];
  const myUserId = getMyUserId();
  if (
    !publication ||
    !myUserId ||
    publication.hostUserId !== myUserId ||
    publication.sessionId !== ownedRuntime.sessionId
  ) {
    teardownOwnedRuntime();
    useStreamStore.setState({ ownedStream: null });
    return;
  }

  const previousViewerIds = new Set(useStreamStore.getState().ownedStream?.viewers.map((viewer) => viewer.userId) ?? []);
  const nextViewerIds = new Set(publication.viewers.map((viewer) => viewer.userId));

  for (const viewerId of previousViewerIds) {
    if (!nextViewerIds.has(viewerId)) {
      ownedRuntime.manager.closePeer(viewerId);
      pendingOwnedIceCandidates.delete(viewerId);
    }
  }

  for (const viewer of publication.viewers) {
    if (!previousViewerIds.has(viewer.userId)) {
      void ownedRuntime.manager
        .createOffer(viewer.userId, ownedRuntime.localStream, ownedRuntime.iceServers, {
          degradationPreference: 'balanced',
          maxVideoBitrateKbps: ownedRuntime.quality.bitrateKbps,
          preferredVideoCodec: ownedRuntime.codecPreference,
        })
        .then((offer) => {
          sendOwnedSignal(viewer.userId, { type: 'offer', sdp: offer.sdp ?? '' });
        })
        .catch((err) => {
          console.warn('[stream] offer failed for viewer', viewer.userId, err);
        });
    }
  }

  useStreamStore.setState((state) => {
    if (!state.ownedStream) {
      return state;
    }

    return {
      ownedStream: {
        ...state.ownedStream,
        localPreviewStream: ownedRuntime?.localStream ?? state.ownedStream.localPreviewStream,
        sessionId: publication.sessionId,
        sourceType: publication.sourceType,
        status: 'live',
        streamId: publication.streamId,
        viewers: publication.viewers,
      },
    };
  });
}

function reconcileWatchedPublications(channelId: string, streamsById: Record<string, StreamPublication>) {
  const myUserId = getMyUserId();
  const watchedForChannel = [...watchedRuntimes.values()].filter((runtime) => runtime.channelId === channelId);

  for (const runtime of watchedForChannel) {
    const watchedState = useStreamStore.getState().watchedStreamsById[runtime.streamId];
    const isPendingWatchStart = watchedState?.status === 'starting';
    const publication = streamsById[runtime.streamId];
    if (!publication) {
      if (isPendingWatchStart) {
        continue;
      }

      teardownWatchedRuntime(runtime.streamId);
      updateWatchedStreamState(runtime.streamId, (watched) => ({
        ...watched,
        remoteStream: null,
        status: 'ended',
        viewers: [],
      }));
      continue;
    }

    const stillWatching =
      !!myUserId &&
      publication.hostUserId === runtime.hostUserId &&
      publication.sessionId === runtime.hostSessionId &&
      publication.viewers.some((viewer) => viewer.userId === myUserId);

    if (!stillWatching) {
      if (isPendingWatchStart) {
        continue;
      }

      teardownWatchedRuntime(runtime.streamId);
      removeWatchedStreamState(runtime.streamId);
      continue;
    }

    updateWatchedStreamState(runtime.streamId, (watched) => ({
      ...watched,
      hostSessionId: publication.sessionId,
      remoteStream: watchedRuntimes.get(runtime.streamId)?.remoteStream ?? watched.remoteStream,
      sourceType: publication.sourceType,
      status: 'watching',
      viewers: publication.viewers,
    }));
  }
}

function getConfirmedWatchedPublication(
  channelId: string,
  streamId: string,
  hostSessionId: string,
  hostUserId: string,
  viewerUserId: string,
) {
  const publication = useStreamStore.getState().roomStateByChannel[channelId]?.[streamId];
  if (
    !publication ||
    publication.hostUserId !== hostUserId ||
    publication.sessionId !== hostSessionId ||
    !publication.viewers.some((viewer) => viewer.userId === viewerUserId)
  ) {
    return null;
  }

  return publication;
}

async function processWatchedSignal(data: MediaSignalRelayEventData) {
  const { fromUserId, signal } = data;
  const streamId = signal.session.streamId;
  if (!streamId) {
    return;
  }

  const runtime = watchedRuntimes.get(streamId);
  if (!runtime || runtime.hostUserId !== fromUserId) {
    const watchedState = useStreamStore.getState().watchedStreamsById[streamId];
    if (watchedState?.status === 'starting' && signal.session.mode === 'stream_publish') {
      queuePendingWatchedSignal(streamId, data);
    }
    return;
  }

  switch (signal.type) {
    case 'offer': {
      if (!signal.sdp) {
        return;
      }

      try {
        const answer = await runtime.manager.handleRecvOnlyOffer(
          fromUserId,
          { type: 'offer', sdp: signal.sdp },
          runtime.iceServers,
        );
        syncWatchedRuntimeRemoteTracks(runtime.streamId);
        sendWatchSignal(runtime.streamId, fromUserId, { type: 'answer', sdp: answer.sdp ?? '' });

        const pendingIceCandidates = takePendingWatchedIceCandidates(runtime.streamId, fromUserId);
        for (const candidate of pendingIceCandidates) {
          try {
            await runtime.manager.addIceCandidate(fromUserId, candidate);
          } catch (err) {
            queuePendingWatchedIceCandidate(runtime.streamId, fromUserId, candidate);
            console.warn('[stream] recv-only queued ICE flush failed from', fromUserId, err);
            break;
          }
        }
      } catch (err) {
        console.warn('[stream] recv-only offer failed from', fromUserId, err);
      }
      return;
    }
    case 'ice_candidate': {
      if (!signal.candidate) {
        return;
      }
      if (!runtime.manager.getPeerIds().includes(fromUserId)) {
        queuePendingWatchedIceCandidate(runtime.streamId, fromUserId, signal.candidate);
        return;
      }

      try {
        await runtime.manager.addIceCandidate(fromUserId, signal.candidate);
        syncWatchedRuntimeRemoteTracks(runtime.streamId);
      } catch (err) {
        queuePendingWatchedIceCandidate(runtime.streamId, fromUserId, signal.candidate);
        console.warn('[stream] recv-only ICE add failed from', fromUserId, err);
      }
      return;
    }
    case 'restart_ice': {
      const offer = await runtime.manager.restartIce(fromUserId);
      if (offer) {
        sendWatchSignal(runtime.streamId, fromUserId, { type: 'offer', sdp: offer.sdp ?? '' });
      }
      return;
    }
    case 'end': {
      runtime.manager.closePeer(fromUserId);
      runtime.remoteStream = null;
      updateWatchedStreamState(runtime.streamId, (watched) => ({
        ...watched,
        remoteStream: null,
      }));
      return;
    }
    case 'answer':
      return;
  }
}

async function flushPendingWatchedSignals(streamId: string) {
  const queuedSignals = takePendingWatchedSignals(streamId);
  for (const signal of queuedSignals) {
    await processWatchedSignal(signal);
  }
}

export async function getWatchedStreamVideoStats(streamId: string): Promise<WatchedStreamVideoStats | null> {
  const runtime = watchedRuntimes.get(streamId);
  if (!runtime) {
    lastWatchedVideoStatsSamples.delete(streamId);
    return null;
  }

  const sample = await runtime.manager.getPeerVideoReceiveSample(runtime.hostUserId);
  if (!sample) {
    return null;
  }

  const previous = lastWatchedVideoStatsSamples.get(streamId);
  const previousBytesReceived = previous?.bytesReceived ?? null;
  const previousFramesDecoded = previous?.framesDecoded ?? null;
  const previousTimestampMs = previous?.timestampMs ?? null;
  lastWatchedVideoStatsSamples.set(streamId, {
    bytesReceived: sample.bytesReceived,
    framesDecoded: sample.framesDecoded,
    timestampMs: sample.timestampMs,
  });

  let bitrateKbps: number | null = null;
  if (
    previousBytesReceived !== null &&
    sample.bytesReceived !== null &&
    previousTimestampMs !== null &&
    sample.timestampMs !== null &&
    sample.timestampMs > previousTimestampMs
  ) {
    const deltaBytes = sample.bytesReceived - previousBytesReceived;
    const deltaMs = sample.timestampMs - previousTimestampMs;
    if (deltaBytes >= 0 && deltaMs > 0) {
      bitrateKbps = Math.round((deltaBytes * 8) / deltaMs);
    }
  }

  let frameRate = normalizeFrameRate(sample.framesPerSecond);
  if (
    frameRate === null &&
    previousFramesDecoded !== null &&
    sample.framesDecoded !== null &&
    previousTimestampMs !== null &&
    sample.timestampMs !== null &&
    sample.timestampMs > previousTimestampMs
  ) {
    const deltaFrames = sample.framesDecoded - previousFramesDecoded;
    const deltaMs = sample.timestampMs - previousTimestampMs;
    if (deltaFrames >= 0 && deltaMs > 0) {
      frameRate = normalizeFrameRate((deltaFrames * 1000) / deltaMs);
    }
  }

  return {
    bitrateKbps,
    codec: sample.codec,
    frameRate,
    framesDropped: sample.framesDropped,
    jitterMs: sample.jitterMs,
    packetsLost: sample.packetsLost,
    packetsReceived: sample.packetsReceived,
    resolution: formatVideoResolution(sample.frameWidth, sample.frameHeight),
  };
}

export async function getOwnedStreamVideoStats(): Promise<OwnedStreamVideoStats | null> {
  if (!ownedRuntime) {
    lastOwnedVideoStatsSample.bytesSent = null;
    lastOwnedVideoStatsSample.framesEncoded = null;
    lastOwnedVideoStatsSample.timestampMs = null;
    return null;
  }

  const sample = await ownedRuntime.manager.getAggregatePeerVideoSendSample();
  if (!sample) {
    return {
      activePeerCount: 0,
      bitrateKbps: null,
      codec: null,
      encoderLimited: false,
      frameRate: null,
      qualityLimitationReason: 'none',
      resolution: null,
    };
  }

  let bitrateKbps: number | null = null;
  if (
    lastOwnedVideoStatsSample.bytesSent !== null &&
    sample.bytesSent !== null &&
    lastOwnedVideoStatsSample.timestampMs !== null &&
    sample.timestampMs !== null &&
    sample.timestampMs > lastOwnedVideoStatsSample.timestampMs
  ) {
    const deltaBytes = sample.bytesSent - lastOwnedVideoStatsSample.bytesSent;
    const deltaMs = sample.timestampMs - lastOwnedVideoStatsSample.timestampMs;
    if (deltaBytes >= 0 && deltaMs > 0) {
      bitrateKbps = Math.round((deltaBytes * 8) / deltaMs);
    }
  }

  let frameRate = normalizeFrameRate(sample.framesPerSecond);
  if (
    frameRate === null &&
    lastOwnedVideoStatsSample.framesEncoded !== null &&
    sample.framesEncoded !== null &&
    lastOwnedVideoStatsSample.timestampMs !== null &&
    sample.timestampMs !== null &&
    sample.timestampMs > lastOwnedVideoStatsSample.timestampMs
  ) {
    const deltaFrames = sample.framesEncoded - lastOwnedVideoStatsSample.framesEncoded;
    const deltaMs = sample.timestampMs - lastOwnedVideoStatsSample.timestampMs;
    if (deltaFrames >= 0 && deltaMs > 0) {
      frameRate = normalizeFrameRate((deltaFrames * 1000) / deltaMs);
    }
  }

  lastOwnedVideoStatsSample.bytesSent = sample.bytesSent;
  lastOwnedVideoStatsSample.framesEncoded = sample.framesEncoded;
  lastOwnedVideoStatsSample.timestampMs = sample.timestampMs;

  return {
    activePeerCount: sample.activePeerCount,
    bitrateKbps,
    codec: sample.codec,
    encoderLimited: isEncoderLikelyLimited(
      sample.qualityLimitationReason,
      frameRate,
      ownedRuntime.quality.frameRate,
    ),
    frameRate,
    qualityLimitationReason: sample.qualityLimitationReason,
    resolution: formatVideoResolution(sample.frameWidth, sample.frameHeight),
  };
}

export const useStreamStore = create<StreamState>((set, get) => ({
  ...emptyState(),

  async startSharing(
    channelId,
    quality,
    sourceType,
    sendCommandAwaitAck,
    sendRawCommand,
    codecPreference = DEFAULT_STREAM_CODEC_PREFERENCE,
  ) {
    if (ownedRuntime) {
      return;
    }

    set({
      error: null,
      ownedStream: {
        channelId,
        codecPreference,
        localPreviewStream: null,
        quality,
        sessionId: null,
        sourceType,
        status: 'capturing',
        streamId: null,
        viewers: [],
      },
    });

    let captured: MediaStream;
    try {
      captured = await captureStream(sourceType, quality);
    } catch {
      set({
        error: sourceType === 'screen' ? 'Screen share capture failed.' : 'Camera capture failed.',
        ownedStream: null,
      });
      return;
    }

    set((state) => ({
      error: null,
      ownedStream: state.ownedStream
        ? {
            ...state.ownedStream,
            localPreviewStream: captured,
            status: 'starting',
          }
        : null,
    }));

    let ackData: ReturnType<typeof StreamStartAckDataSchema.parse>;
    try {
      const raw = await sendCommandAwaitAck('stream.start', { channelId, quality, sourceType });
      ackData = StreamStartAckDataSchema.parse(raw);
    } catch (err) {
      for (const track of captured.getTracks()) {
        track.stop();
      }
      set({
        error: err instanceof Error ? err.message : 'Failed to start stream.',
        ownedStream: null,
      });
      return;
    }

    const streamId = ackData.streamId ?? ackData.sessionId;
    const userId = getMyUserId();
    if (!userId) {
      for (const track of captured.getTracks()) {
        track.stop();
      }
      set({
        error: 'Authenticated user required to start a stream.',
        ownedStream: null,
      });
      return;
    }

    ownedRuntime = {
      channelId,
      codecPreference,
      iceServers: ackData.iceServers,
      localStream: captured,
      manager: createOwnedManager(),
      quality,
      sendRawCommand,
      sessionId: ackData.sessionId,
      sourceType,
      streamId,
      userId,
    };

    set({
      error: null,
      ownedStream: {
        channelId,
        codecPreference,
        localPreviewStream: captured,
        quality,
        sessionId: ackData.sessionId,
        sourceType,
        status: 'live',
        streamId,
        viewers: [],
      },
    });
  },

  async stopSharing(sendCommandAwaitAck) {
    if (!ownedRuntime) {
      return;
    }

    const runtime = ownedRuntime;
    set((state) => ({
      ownedStream: state.ownedStream
        ? {
            ...state.ownedStream,
            status: 'stopping',
          }
        : null,
    }));

    for (const peerId of runtime.manager.getPeerIds()) {
      sendOwnedSignal(peerId, { type: 'end' });
    }

    teardownOwnedRuntime();

    try {
      await sendCommandAwaitAck('stream.stop', { channelId: runtime.channelId, streamId: runtime.streamId });
    } catch {
      // Best effort: local publish teardown already completed.
    }

    set({ ownedStream: null });
  },

  async watchStream(channelId, streamId, sendCommandAwaitAck, sendRawCommand) {
    if (watchedRuntimes.has(streamId) || get().watchedStreamsById[streamId]) {
      return;
    }

    cancelledWatchRequests.delete(streamId);

    set((state) => ({
      error: null,
      watchedStreamsById: {
        ...state.watchedStreamsById,
        [streamId]: {
          channelId,
          hostSessionId: '',
          hostUserId: '',
          playbackVolume: DEFAULT_STREAM_PLAYBACK_VOLUME,
          remoteStream: null,
          sessionId: '',
          sourceType: null,
          status: 'starting',
          streamId,
          viewers: [],
        },
      },
    }));

    let ackData: ReturnType<typeof StreamWatchAckDataSchema.parse>;
    try {
      const raw = await sendCommandAwaitAck('stream.watch', { channelId, streamId });
      ackData = StreamWatchAckDataSchema.parse(raw);
    } catch (err) {
      removeWatchedStreamState(streamId);
      // ACK failed — the cancel flag (if any) will never be checked further, so
      // clean it up here to prevent a stale entry from blocking future watches.
      cancelledWatchRequests.delete(streamId);
      set({ error: err instanceof Error ? err.message : 'Failed to watch stream.' });
      throw err;
    }

    const resolvedStreamId = ackData.streamId ?? streamId;
    movePendingWatchedSignals(streamId, resolvedStreamId);
    if (resolvedStreamId !== streamId) {
      cancelledWatchRequests.delete(resolvedStreamId);
    }
    const userId = getMyUserId();
    if (!userId) {
      removeWatchedStreamState(streamId);
      // Clean up cancel flag so it cannot ghost-block future watches.
      cancelledWatchRequests.delete(streamId);
      set({ error: 'Authenticated user required to watch a stream.' });
      throw new Error('Authenticated user required to watch a stream.');
    }

    if (cancelledWatchRequests.has(streamId) || cancelledWatchRequests.has(resolvedStreamId)) {
      cancelledWatchRequests.delete(streamId);
      cancelledWatchRequests.delete(resolvedStreamId);
      removeWatchedStreamState(streamId);
      removeWatchedStreamState(resolvedStreamId);

      try {
        await sendCommandAwaitAck('stream.unwatch', { channelId, streamId: resolvedStreamId });
      } catch {
        // Best effort: the popup was closed before watch setup completed.
      }

      return;
    }

    const manager = createWatchedManager(resolvedStreamId);
    watchedRuntimes.set(resolvedStreamId, {
      channelId,
      hostSessionId: ackData.hostSessionId,
      hostUserId: ackData.hostUserId,
      iceServers: ackData.iceServers,
      manager,
      remoteStream: null,
      sendRawCommand,
      sessionId: ackData.sessionId,
      streamId: resolvedStreamId,
      userId,
    });
    ensureWatchedReceiverSync(resolvedStreamId);

    const confirmedPublication = getConfirmedWatchedPublication(
      channelId,
      resolvedStreamId,
      ackData.hostSessionId,
      ackData.hostUserId,
      userId,
    );

    set((state) => {
      const nextWatched = { ...state.watchedStreamsById };
      if (resolvedStreamId !== streamId) {
        delete nextWatched[streamId];
      }

      nextWatched[resolvedStreamId] = {
        channelId,
        hostSessionId: ackData.hostSessionId,
        hostUserId: ackData.hostUserId,
        playbackVolume: state.watchedStreamsById[resolvedStreamId]?.playbackVolume ?? DEFAULT_STREAM_PLAYBACK_VOLUME,
        remoteStream: null,
        sessionId: ackData.sessionId,
        sourceType: confirmedPublication?.sourceType ?? state.roomStateByChannel[channelId]?.[resolvedStreamId]?.sourceType ?? null,
        status: confirmedPublication ? 'watching' : 'starting',
        streamId: resolvedStreamId,
        viewers: confirmedPublication?.viewers ?? state.roomStateByChannel[channelId]?.[resolvedStreamId]?.viewers ?? [],
      };

      return {
        error: null,
        watchedStreamsById: nextWatched,
      };
    });

    void flushPendingWatchedSignals(resolvedStreamId);
  },

  async unwatchStream(streamId, sendCommandAwaitAck) {
    const runtime = watchedRuntimes.get(streamId);
    const watchedState = get().watchedStreamsById[streamId];

    if (!runtime && !watchedState) {
      return;
    }

    cancelledWatchRequests.add(streamId);

    if (watchedState) {
      updateWatchedStreamState(streamId, (watched) => ({
        ...watched,
        status: 'stopping',
      }));
    }

    if (runtime) {
      sendWatchSignal(streamId, runtime.hostUserId, { type: 'end' });
      teardownWatchedRuntime(streamId);
    }

    const channelId = runtime?.channelId ?? watchedState?.channelId;
    removeWatchedStreamState(streamId);
    if (!channelId) {
      cancelledWatchRequests.delete(streamId);
      return;
    }

    try {
      await sendCommandAwaitAck('stream.unwatch', { channelId, streamId });
    } catch {
      // Best effort: local per-stream teardown already completed.
    }
    // Do NOT delete from cancelledWatchRequests here: the in-flight watchStream
    // may still be awaiting its ACK and needs to see the cancel flag when it
    // resumes. watchStream is responsible for cleaning up the flag once it
    // detects cancellation (or fails before reaching the check).
  },

  setPlaybackVolume(streamId, volume) {
    updateWatchedStreamState(streamId, (watched) => ({
      ...watched,
      playbackVolume: clampStreamPlaybackVolume(volume),
    }));
  },

  async disconnectCurrentStream(sendCommandAwaitAck) {
    const watchedStreamIds = Object.keys(get().watchedStreamsById);

    if (ownedRuntime) {
      await get().stopSharing(sendCommandAwaitAck);
    }

    for (const streamId of watchedStreamIds) {
      await get().unwatchStream(streamId, sendCommandAwaitAck);
    }
  },

  handleStreamStateUpdated(data) {
    const streams = normalizePublications(data);
    const streamsById = mapStreamsById(streams);

    set((state) => {
      const nextRoomStateByChannel = { ...state.roomStateByChannel };
      if (streams.length > 0) {
        nextRoomStateByChannel[data.channelId] = streamsById;
      } else {
        delete nextRoomStateByChannel[data.channelId];
      }

      return { roomStateByChannel: nextRoomStateByChannel };
    });

    reconcileOwnedPublication(data.channelId, streamsById);
    reconcileWatchedPublications(data.channelId, streamsById);
  },

  handleMediaSignal(data) {
    const { fromUserId, signal } = data;

    if (!signal.session.streamId) {
      return;
    }

    if (signal.session.mode === 'stream_publish') {
      void processWatchedSignal(data);

      return;
    }

    if (
      signal.session.mode !== 'stream_watch' ||
      !ownedRuntime ||
      ownedRuntime.streamId !== signal.session.streamId
    ) {
      return;
    }

    void (async () => {
      switch (signal.type) {
        case 'answer': {
          if (!signal.sdp) {
            return;
          }
          await ownedRuntime?.manager.handleAnswer(fromUserId, { type: 'answer', sdp: signal.sdp });

          const pendingCandidates = takePendingOwnedIceCandidates(fromUserId);
          for (const candidate of pendingCandidates) {
            try {
              await ownedRuntime?.manager.addIceCandidate(fromUserId, candidate);
            } catch (err) {
              queuePendingOwnedIceCandidate(fromUserId, candidate);
              console.warn('[stream] publish queued ICE flush failed for', fromUserId, err);
              break;
            }
          }
          break;
        }
        case 'ice_candidate': {
          if (!signal.candidate) {
            return;
          }
          if (!ownedRuntime?.manager.getPeerIds().includes(fromUserId)) {
            queuePendingOwnedIceCandidate(fromUserId, signal.candidate);
            break;
          }

          try {
            await ownedRuntime?.manager.addIceCandidate(fromUserId, signal.candidate);
          } catch (err) {
            queuePendingOwnedIceCandidate(fromUserId, signal.candidate);
            console.warn('[stream] publish ICE add failed from', fromUserId, err);
          }
          break;
        }
        case 'restart_ice': {
          const offer = await ownedRuntime?.manager.restartIce(fromUserId);
          if (offer) {
            sendOwnedSignal(fromUserId, { type: 'offer', sdp: offer.sdp ?? '' });
          }
          break;
        }
        case 'end': {
          ownedRuntime?.manager.closePeer(fromUserId);
          break;
        }
        case 'offer':
          break;
      }
    })();
  },

  handleGatewayWillReconnect() {
    const hasAnyWatched = Object.keys(get().watchedStreamsById).length > 0;
    const hasOwned = Boolean(get().ownedStream);
    if (!hasAnyWatched && !hasOwned) {
      return;
    }

    teardownAllRuntimes();

    set((state) => {
      const nextWatched: Record<string, WatchedStreamState> = {};
      for (const [streamId, watched] of Object.entries(state.watchedStreamsById)) {
        if (watched.status === 'ended') {
          nextWatched[streamId] = watched;
          continue;
        }
        nextWatched[streamId] = {
          ...watched,
          remoteStream: null,
          status: 'reconnecting',
          viewers: [],
        };
      }

      return {
        ownedStream: null,
        watchedStreamsById: nextWatched,
        error: null,
      };
    });
  },

  async handleGatewayReconnected(sendCommandAwaitAck, sendRawCommand) {
    const entries = Object.values(get().watchedStreamsById).filter((w) => w.status !== 'ended');
    if (entries.length === 0) return;

    for (const entry of entries) {
      const desiredVolume = entry.playbackVolume;
      const { channelId, streamId } = entry;

      // Force a full re-watch so the gateway can issue a fresh session + ICE servers.
      teardownWatchedRuntime(streamId);
      removeWatchedStreamState(streamId);

      try {
        await get().watchStream(channelId, streamId, sendCommandAwaitAck, sendRawCommand);
        get().setPlaybackVolume(streamId, desiredVolume);
      } catch {
        // Best-effort: leave it removed; the UI will show the stream as no longer watched.
      }
    }
  },

  handleGatewayDisconnected() {
    teardownAllRuntimes();
    set(emptyState());
  },

  reset() {
    teardownAllRuntimes();
    set(emptyState());
  },
}));
