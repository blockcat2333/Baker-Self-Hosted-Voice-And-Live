import { create } from 'zustand';

import type {
  GatewayCommandName,
  IceServer,
  MediaSignalRelayEventData,
  MediaSfuProducerEventData,
  MediaTransportMode,
  MusicListener,
  MusicPublication,
  MusicStateUpdatedEventData,
  SfuProducer,
} from '@baker/protocol';
import {
  MusicListenAckDataSchema,
  MusicStartAckDataSchema,
} from '@baker/protocol';
import { SfuClientSession, WebRtcManager } from '@baker/sdk';

import { useAuthStore } from '../auth/auth-store';
import { loadNumberPreference, saveNumberPreference } from '../preferences/client-preferences';
import {
  canCaptureDesktopMusic,
  captureDesktopMusicStream,
  clampMusicPlaybackVolume,
  DEFAULT_MUSIC_PLAYBACK_VOLUME,
  resolveDesktopMusicCaptureAvailability,
} from './music-media';

export type PublishedMusicStatus = 'capturing' | 'live' | 'starting' | 'stopping';
export type ListeningMusicStatus = 'listening' | 'reconnecting' | 'starting' | 'stopping';

interface PublishedMusicState {
  channelId: string;
  listeners: MusicListener[];
  localStream: MediaStream | null;
  musicId: string | null;
  sessionId: string | null;
  status: PublishedMusicStatus;
}

interface ListeningMusicState {
  channelId: string;
  connectionState: RTCPeerConnectionState | null;
  hostSessionId: string;
  hostUserId: string;
  musicId: string;
  remoteStream: MediaStream | null;
  sessionId: string;
  status: ListeningMusicStatus;
}

interface MusicState {
  error: string | null;
  isDesktopCaptureAvailable: boolean;
  playbackVolume: number;
  publishedMusic: PublishedMusicState | null;
  listeningById: Record<string, ListeningMusicState>;
  roomStateByChannel: Record<string, Record<string, MusicPublication>>;

  refreshDesktopCaptureAvailability(): void;
  setPlaybackVolume(volume: number): void;
  startMusicShare(
    channelId: string,
    sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
    sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
  ): Promise<void>;
  stopMusicShare(sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>): Promise<void>;
  handleMusicStateUpdated(
    data: MusicStateUpdatedEventData,
    sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
    sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
  ): void;
  handleMediaSignal(data: MediaSignalRelayEventData): void;
  handleSfuProducerAdded(data: MediaSfuProducerEventData): void;
  handleSfuProducerRemoved(data: MediaSfuProducerEventData): void;
  handleGatewayWillReconnect(): void;
  handleGatewayDisconnected(): void;
  reset(): void;
}

interface PublishedMusicRuntime {
  channelId: string;
  iceServers: IceServer[];
  localStream: MediaStream;
  manager: WebRtcManager | null;
  mediaMode: MediaTransportMode;
  musicId: string;
  sendRawCommand: (command: GatewayCommandName, data: unknown) => void;
  sessionId: string;
  sfuSession: SfuClientSession | null;
  userId: string;
}

interface ListeningMusicRuntime {
  channelId: string;
  hasRemoteAudio: boolean;
  hostSessionId: string;
  hostUserId: string;
  iceServers: IceServer[];
  manager: WebRtcManager | null;
  mediaMode: MediaTransportMode;
  musicId: string;
  remoteStream: MediaStream | null;
  sendRawCommand: (command: GatewayCommandName, data: unknown) => void;
  sessionId: string;
  sfuSession: SfuClientSession | null;
  userId: string;
}

let publishedRuntime: PublishedMusicRuntime | null = null;
const listeningRuntimes = new Map<string, ListeningMusicRuntime>();
const remoteAudioElements = new Map<string, HTMLAudioElement>();
const pendingListenSignals = new Map<string, MediaSignalRelayEventData[]>();
const pendingListenIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const pendingPublishedIceCandidates = new Map<string, RTCIceCandidateInit[]>();
const sfuMusicTracks = new Map<string, { musicId: string; track: MediaStreamTrack }>();

function getMyUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}

function emptyState(): Pick<
  MusicState,
  'error' | 'isDesktopCaptureAvailable' | 'listeningById' | 'playbackVolume' | 'publishedMusic' | 'roomStateByChannel'
> {
  return {
    error: null,
    isDesktopCaptureAvailable: canCaptureDesktopMusic(),
    listeningById: {},
    playbackVolume: loadNumberPreference('musicPlaybackVolume', DEFAULT_MUSIC_PLAYBACK_VOLUME, clampMusicPlaybackVolume),
    publishedMusic: null,
    roomStateByChannel: {},
  };
}

function mapPublicationsById(publications: MusicPublication[]): Record<string, MusicPublication> {
  const byId: Record<string, MusicPublication> = {};
  for (const publication of publications) {
    byId[publication.musicId] = publication;
  }
  return byId;
}

function listenIceQueueKey(musicId: string, hostUserId: string) {
  return `${musicId}:${hostUserId}`;
}

function stopTracks(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

function detachRemoteAudioElement(musicId: string) {
  const audio = remoteAudioElements.get(musicId);
  if (!audio) {
    return;
  }

  audio.pause();
  audio.srcObject = null;
  audio.parentNode?.removeChild(audio);
  remoteAudioElements.delete(musicId);
}

function attachRemoteAudioElement(musicId: string, stream: MediaStream) {
  let audio = remoteAudioElements.get(musicId);
  if (!audio) {
    audio = new Audio();
    audio.autoplay = true;
    audio.style.display = 'none';
    if (typeof document !== 'undefined') {
      document.body.appendChild(audio);
    }
    remoteAudioElements.set(musicId, audio);
  }

  audio.srcObject = stream;
  audio.volume = clampMusicPlaybackVolume(useMusicStore.getState().playbackVolume);
  void audio.play().catch((err) => {
    console.warn('[music] remote audio play() blocked:', err);
  });
}

function syncRemoteAudioVolumes() {
  const volume = clampMusicPlaybackVolume(useMusicStore.getState().playbackVolume);
  for (const audio of remoteAudioElements.values()) {
    audio.volume = volume;
  }
}

function sendSignal(
  sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
  descriptor: {
    channelId: string;
    mode: 'music_listen' | 'music_publish';
    musicId: string;
    sessionId: string;
    userId: string;
  },
  targetUserId: string,
  payload: {
    candidate?: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
    sdp?: string;
    type: 'answer' | 'end' | 'ice_candidate' | 'offer' | 'restart_ice';
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
  if (!command) return;

  sendRawCommand(command, {
    signal: {
      ...payload,
      session: {
        channelId: descriptor.channelId,
        mode: descriptor.mode,
        sessionId: descriptor.sessionId,
        streamId: descriptor.musicId,
        userId: descriptor.userId,
      },
    },
    targetUserId,
  });
}

function sendPublishedSignal(
  targetUserId: string,
  payload: {
    candidate?: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
    sdp?: string;
    type: 'answer' | 'end' | 'ice_candidate' | 'offer' | 'restart_ice';
  },
) {
  if (!publishedRuntime) return;
  sendSignal(
    publishedRuntime.sendRawCommand,
    {
      channelId: publishedRuntime.channelId,
      mode: 'music_publish',
      musicId: publishedRuntime.musicId,
      sessionId: publishedRuntime.sessionId,
      userId: publishedRuntime.userId,
    },
    targetUserId,
    payload,
  );
}

function sendListenSignal(
  musicId: string,
  targetUserId: string,
  payload: {
    candidate?: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
    sdp?: string;
    type: 'answer' | 'end' | 'ice_candidate' | 'offer' | 'restart_ice';
  },
) {
  const runtime = listeningRuntimes.get(musicId);
  if (!runtime) return;
  sendSignal(
    runtime.sendRawCommand,
    {
      channelId: runtime.channelId,
      mode: 'music_listen',
      musicId: runtime.musicId,
      sessionId: runtime.sessionId,
      userId: runtime.userId,
    },
    targetUserId,
    payload,
  );
}

function queuePendingListenSignal(musicId: string, data: MediaSignalRelayEventData) {
  const existing = pendingListenSignals.get(musicId) ?? [];
  existing.push(data);
  pendingListenSignals.set(musicId, existing);
}

function takePendingListenSignals(musicId: string): MediaSignalRelayEventData[] {
  const queued = pendingListenSignals.get(musicId) ?? [];
  pendingListenSignals.delete(musicId);
  return queued;
}

function queuePendingPublishedIceCandidate(userId: string, candidate: RTCIceCandidateInit) {
  const existing = pendingPublishedIceCandidates.get(userId) ?? [];
  existing.push(candidate);
  pendingPublishedIceCandidates.set(userId, existing);
}

function takePendingPublishedIceCandidates(userId: string): RTCIceCandidateInit[] {
  const queued = pendingPublishedIceCandidates.get(userId) ?? [];
  pendingPublishedIceCandidates.delete(userId);
  return queued;
}

function queuePendingListenIceCandidate(musicId: string, hostUserId: string, candidate: RTCIceCandidateInit) {
  const key = listenIceQueueKey(musicId, hostUserId);
  const existing = pendingListenIceCandidates.get(key) ?? [];
  existing.push(candidate);
  pendingListenIceCandidates.set(key, existing);
}

function takePendingListenIceCandidates(musicId: string, hostUserId: string): RTCIceCandidateInit[] {
  const key = listenIceQueueKey(musicId, hostUserId);
  const queued = pendingListenIceCandidates.get(key) ?? [];
  pendingListenIceCandidates.delete(key);
  return queued;
}

function createPublishedManager(): WebRtcManager {
  return new WebRtcManager({
    onLocalIceCandidate(targetUserId, candidate) {
      sendPublishedSignal(targetUserId, {
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        },
        type: 'ice_candidate',
      });
    },
    onPeerConnectionStateChange() {
      // Music room snapshots drive listener reconciliation.
    },
    onRemoteTrack() {
      // Publishers do not render remote music.
    },
  });
}

function createListenManager(musicId: string): WebRtcManager {
  return new WebRtcManager({
    onLocalIceCandidate(targetUserId, candidate) {
      sendListenSignal(musicId, targetUserId, {
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        },
        type: 'ice_candidate',
      });
    },
    onPeerConnectionStateChange(fromUserId, state) {
      const runtime = listeningRuntimes.get(musicId);
      if (!runtime || runtime.hostUserId !== fromUserId) {
        return;
      }
      useMusicStore.setState((current) => {
        const listening = current.listeningById[musicId];
        if (!listening) {
          return {};
        }

        return {
          listeningById: {
            ...current.listeningById,
            [musicId]: { ...listening, connectionState: state },
          },
        };
      });
    },
    onRemoteTrack(_fromUserId, track, streams) {
      const runtime = listeningRuntimes.get(musicId);
      if (!runtime || track.kind !== 'audio') {
        return;
      }

      runtime.remoteStream ??= new MediaStream();
      for (const incomingStream of streams) {
        for (const incomingTrack of incomingStream.getAudioTracks()) {
          if (!runtime.remoteStream.getTracks().some((existing) => existing.id === incomingTrack.id)) {
            runtime.remoteStream.addTrack(incomingTrack);
          }
        }
      }
      if (!runtime.remoteStream.getTracks().some((existing) => existing.id === track.id)) {
        runtime.remoteStream.addTrack(track);
      }

      runtime.hasRemoteAudio = true;
      attachRemoteAudioElement(musicId, runtime.remoteStream);
      updateListeningState(musicId, (state) => ({
        ...state,
        remoteStream: runtime.remoteStream,
        status: 'listening',
      }));
    },
  });
}

function updateListeningState(musicId: string, updater: (state: ListeningMusicState) => ListeningMusicState) {
  useMusicStore.setState((state) => {
    const listening = state.listeningById[musicId];
    if (!listening) {
      return state;
    }
    return {
      listeningById: {
        ...state.listeningById,
        [musicId]: updater(listening),
      },
    };
  });
}

function removeListeningState(musicId: string) {
  useMusicStore.setState((state) => {
    if (!state.listeningById[musicId]) {
      return state;
    }
    const { [musicId]: _removed, ...rest } = state.listeningById;
    return { listeningById: rest };
  });
}

function teardownPublishedRuntime() {
  if (!publishedRuntime) {
    return;
  }

  publishedRuntime.manager?.closeAll();
  publishedRuntime.sfuSession?.close();
  stopTracks(publishedRuntime.localStream);
  pendingPublishedIceCandidates.clear();
  publishedRuntime = null;
}

function teardownListeningRuntime(musicId: string) {
  const runtime = listeningRuntimes.get(musicId);
  for (const key of [...pendingListenIceCandidates.keys()]) {
    if (key.startsWith(`${musicId}:`)) {
      pendingListenIceCandidates.delete(key);
    }
  }
  pendingListenSignals.delete(musicId);
  detachRemoteAudioElement(musicId);

  if (!runtime) {
    return;
  }

  runtime.manager?.closeAll();
  runtime.sfuSession?.close();
  stopTracks(runtime.remoteStream);
  for (const [producerId, record] of sfuMusicTracks) {
    if (record.musicId === musicId) {
      sfuMusicTracks.delete(producerId);
    }
  }
  listeningRuntimes.delete(musicId);
}

function teardownAllRuntimes() {
  teardownPublishedRuntime();
  for (const musicId of [...listeningRuntimes.keys()]) {
    teardownListeningRuntime(musicId);
  }
  pendingListenSignals.clear();
  pendingListenIceCandidates.clear();
  pendingPublishedIceCandidates.clear();
}

async function consumeSfuMusicProducers(musicId: string, producers: SfuProducer[]) {
  const runtime = listeningRuntimes.get(musicId);
  if (!runtime?.sfuSession) {
    return;
  }

  for (const producer of producers) {
    if (producer.source !== 'music' || producer.streamId !== musicId || producer.userId === runtime.userId) {
      continue;
    }

    try {
      const remote = await runtime.sfuSession.consumeProducer(producer);
      if (!remote) {
        continue;
      }
      runtime.remoteStream ??= new MediaStream();
      runtime.remoteStream.addTrack(remote.track);
      runtime.hasRemoteAudio = true;
      sfuMusicTracks.set(producer.id, { musicId, track: remote.track });
      attachRemoteAudioElement(musicId, runtime.remoteStream);
      updateListeningState(musicId, (state) => ({
        ...state,
        remoteStream: runtime.remoteStream,
        status: 'listening',
      }));
    } catch (err) {
      console.warn('[music] SFU consume failed for', producer.id, err);
    }
  }
}

async function processListenSignal(data: MediaSignalRelayEventData) {
  const { fromUserId, signal } = data;
  const musicId = signal.session.streamId;
  if (!musicId) {
    return;
  }

  const runtime = listeningRuntimes.get(musicId);
  if (!runtime || runtime.hostUserId !== fromUserId) {
    const listeningState = useMusicStore.getState().listeningById[musicId];
    if (listeningState?.status === 'starting' && signal.session.mode === 'music_publish') {
      queuePendingListenSignal(musicId, data);
    }
    return;
  }

  switch (signal.type) {
    case 'offer': {
      if (!signal.sdp || !runtime.manager) return;
      try {
        const answer = await runtime.manager.handleRecvOnlyOffer(
          fromUserId,
          { type: 'offer', sdp: signal.sdp },
          runtime.iceServers,
          ['audio'],
        );
        sendListenSignal(runtime.musicId, fromUserId, { sdp: answer.sdp ?? '', type: 'answer' });

        const pending = takePendingListenIceCandidates(runtime.musicId, fromUserId);
        for (const candidate of pending) {
          try {
            await runtime.manager.addIceCandidate(fromUserId, candidate);
          } catch (err) {
            queuePendingListenIceCandidate(runtime.musicId, fromUserId, candidate);
            console.warn('[music] queued ICE flush failed from', fromUserId, err);
            break;
          }
        }
      } catch (err) {
        console.warn('[music] offer failed from', fromUserId, err);
      }
      return;
    }
    case 'ice_candidate': {
      if (!signal.candidate) return;
      if (!runtime.manager || !runtime.manager.getPeerIds().includes(fromUserId)) {
        queuePendingListenIceCandidate(runtime.musicId, fromUserId, signal.candidate);
        return;
      }
      try {
        await runtime.manager.addIceCandidate(fromUserId, signal.candidate);
      } catch (err) {
        queuePendingListenIceCandidate(runtime.musicId, fromUserId, signal.candidate);
        console.warn('[music] ICE add failed from', fromUserId, err);
      }
      return;
    }
    case 'restart_ice': {
      if (!runtime.manager) return;
      const offer = await runtime.manager.restartIce(fromUserId);
      if (offer) {
        sendListenSignal(runtime.musicId, fromUserId, { sdp: offer.sdp ?? '', type: 'offer' });
      }
      return;
    }
    case 'end':
      teardownListeningRuntime(runtime.musicId);
      removeListeningState(runtime.musicId);
      return;
    case 'answer':
      return;
  }
}

async function flushPendingListenSignals(musicId: string) {
  const queued = takePendingListenSignals(musicId);
  for (const signal of queued) {
    await processListenSignal(signal);
  }
}

async function listenToMusic(
  publication: MusicPublication,
  sendCommandAwaitAck: (command: GatewayCommandName, data: unknown) => Promise<unknown>,
  sendRawCommand: (command: GatewayCommandName, data: unknown) => void,
) {
  const userId = getMyUserId();
  if (!userId || publication.hostUserId === userId || listeningRuntimes.has(publication.musicId)) {
    return;
  }

  useMusicStore.setState((state) => ({
    error: null,
    listeningById: {
      ...state.listeningById,
      [publication.musicId]: {
        channelId: publication.channelId,
        connectionState: null,
        hostSessionId: publication.sessionId,
        hostUserId: publication.hostUserId,
        musicId: publication.musicId,
        remoteStream: null,
        sessionId: '',
        status: 'starting',
      },
    },
  }));

  let ackData: ReturnType<typeof MusicListenAckDataSchema.parse>;
  try {
    const raw = await sendCommandAwaitAck('music.listen', {
      channelId: publication.channelId,
      musicId: publication.musicId,
    });
    ackData = MusicListenAckDataSchema.parse(raw);
  } catch (err) {
    removeListeningState(publication.musicId);
    useMusicStore.setState({ error: err instanceof Error ? err.message : 'Failed to listen to shared music.' });
    return;
  }

  const manager = ackData.mediaMode === 'p2p' ? createListenManager(ackData.musicId) : null;
  const remoteStream = ackData.mediaMode === 'sfu' ? new MediaStream() : null;
  listeningRuntimes.set(ackData.musicId, {
    channelId: ackData.channelId,
    hasRemoteAudio: ackData.mediaMode === 'sfu',
    hostSessionId: ackData.hostSessionId,
    hostUserId: ackData.hostUserId,
    iceServers: ackData.iceServers,
    manager,
    mediaMode: ackData.mediaMode,
    musicId: ackData.musicId,
    remoteStream,
    sendRawCommand,
    sessionId: ackData.sessionId,
    sfuSession: null,
    userId,
  });

  if (ackData.mediaMode === 'sfu' && ackData.sfu) {
    const runtime = listeningRuntimes.get(ackData.musicId);
    if (runtime) {
      try {
        const sfuSession = new SfuClientSession(
          {
            channelId: ackData.channelId,
            mode: 'music_listen',
            sessionId: ackData.sessionId,
            streamId: ackData.musicId,
          },
          sendCommandAwaitAck,
        );
        await sfuSession.load(ackData.sfu);
        runtime.sfuSession = sfuSession;
        await consumeSfuMusicProducers(ackData.musicId, ackData.sfu.producers);
      } catch (err) {
        teardownListeningRuntime(ackData.musicId);
        removeListeningState(ackData.musicId);
        useMusicStore.setState({ error: err instanceof Error ? err.message : 'Failed to listen to SFU music.' });
        return;
      }
    }
  }

  useMusicStore.setState((state) => ({
    listeningById: {
      ...state.listeningById,
      [ackData.musicId]: {
        channelId: ackData.channelId,
        connectionState: null,
        hostSessionId: ackData.hostSessionId,
        hostUserId: ackData.hostUserId,
        musicId: ackData.musicId,
        remoteStream,
        sessionId: ackData.sessionId,
        status: 'listening',
      },
    },
  }));

  void flushPendingListenSignals(ackData.musicId);
}

function reconcilePublishedMusic(channelId: string, publicationsById: Record<string, MusicPublication>) {
  if (!publishedRuntime || publishedRuntime.channelId !== channelId) {
    return;
  }

  const publication = publicationsById[publishedRuntime.musicId];
  const myUserId = getMyUserId();
  if (!publication || !myUserId || publication.hostUserId !== myUserId || publication.sessionId !== publishedRuntime.sessionId) {
    teardownPublishedRuntime();
    useMusicStore.setState({ publishedMusic: null });
    return;
  }

  const previousListenerIds = new Set(useMusicStore.getState().publishedMusic?.listeners.map((listener) => listener.userId) ?? []);
  const nextListenerIds = new Set(publication.listeners.map((listener) => listener.userId));

  for (const listenerId of previousListenerIds) {
    if (!nextListenerIds.has(listenerId)) {
      publishedRuntime.manager?.closePeer(listenerId);
      pendingPublishedIceCandidates.delete(listenerId);
    }
  }

  for (const listener of publication.listeners) {
    if (publishedRuntime.mediaMode === 'p2p' && !previousListenerIds.has(listener.userId) && publishedRuntime.manager) {
      void publishedRuntime.manager
        .createOffer(listener.userId, publishedRuntime.localStream, publishedRuntime.iceServers)
        .then((offer) => {
          sendPublishedSignal(listener.userId, { sdp: offer.sdp ?? '', type: 'offer' });
        })
        .catch((err) => {
          console.warn('[music] offer failed for listener', listener.userId, err);
        });
    }
  }

  useMusicStore.setState((state) => ({
    publishedMusic: state.publishedMusic
      ? {
          ...state.publishedMusic,
          listeners: publication.listeners,
          status: 'live',
        }
      : state.publishedMusic,
  }));
}

function reconcileListeningMusic(channelId: string, publicationsById: Record<string, MusicPublication>) {
  const myUserId = getMyUserId();
  const runtimes = [...listeningRuntimes.values()].filter((runtime) => runtime.channelId === channelId);

  for (const runtime of runtimes) {
    const state = useMusicStore.getState().listeningById[runtime.musicId];
    const isStarting = state?.status === 'starting';
    const publication = publicationsById[runtime.musicId];
    if (!publication) {
      if (isStarting) continue;
      teardownListeningRuntime(runtime.musicId);
      removeListeningState(runtime.musicId);
      continue;
    }

    const stillListening =
      !!myUserId &&
      publication.hostUserId === runtime.hostUserId &&
      publication.sessionId === runtime.hostSessionId &&
      publication.listeners.some((listener) => listener.userId === myUserId);

    if (!stillListening) {
      if (isStarting) continue;
      teardownListeningRuntime(runtime.musicId);
      removeListeningState(runtime.musicId);
      continue;
    }

    updateListeningState(runtime.musicId, (listening) => ({
      ...listening,
      remoteStream: runtime.remoteStream ?? listening.remoteStream,
      status: 'listening',
    }));
  }
}

export const useMusicStore = create<MusicState>((set, get) => ({
  ...emptyState(),

  refreshDesktopCaptureAvailability() {
    const hasDesktopBridge = canCaptureDesktopMusic();
    set({ isDesktopCaptureAvailable: hasDesktopBridge });
    if (!hasDesktopBridge) {
      return;
    }

    void resolveDesktopMusicCaptureAvailability().then((available) => {
      set({ isDesktopCaptureAvailable: available });
    });
  },

  setPlaybackVolume(volume) {
    const clampedVolume = clampMusicPlaybackVolume(volume);
    set({ playbackVolume: clampedVolume });
    saveNumberPreference('musicPlaybackVolume', clampedVolume);
    syncRemoteAudioVolumes();
  },

  async startMusicShare(channelId, sendCommandAwaitAck, sendRawCommand) {
    if (publishedRuntime || get().publishedMusic) {
      return;
    }

    set({
      error: null,
      publishedMusic: {
        channelId,
        listeners: [],
        localStream: null,
        musicId: null,
        sessionId: null,
        status: 'capturing',
      },
    });

    let localStream: MediaStream | null = null;
    try {
      localStream = await captureDesktopMusicStream();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Music capture failed.',
        publishedMusic: null,
      });
      return;
    }

    set((state) => ({
      publishedMusic: state.publishedMusic
        ? { ...state.publishedMusic, localStream, status: 'starting' }
        : state.publishedMusic,
    }));

    let ackData: ReturnType<typeof MusicStartAckDataSchema.parse>;
    try {
      const raw = await sendCommandAwaitAck('music.start', { channelId });
      ackData = MusicStartAckDataSchema.parse(raw);
    } catch (err) {
      stopTracks(localStream);
      set({
        error: err instanceof Error ? err.message : 'Failed to start music share.',
        publishedMusic: null,
      });
      return;
    }

    const userId = getMyUserId();
    if (!userId) {
      stopTracks(localStream);
      set({ error: 'Authenticated user required to share music.', publishedMusic: null });
      return;
    }

    publishedRuntime = {
      channelId,
      iceServers: ackData.iceServers,
      localStream,
      manager: ackData.mediaMode === 'p2p' ? createPublishedManager() : null,
      mediaMode: ackData.mediaMode,
      musicId: ackData.musicId,
      sendRawCommand,
      sessionId: ackData.sessionId,
      sfuSession: null,
      userId,
    };

    if (ackData.mediaMode === 'sfu') {
      try {
        if (!ackData.sfu) throw new Error('SFU music session is missing setup data.');
        const sfuSession = new SfuClientSession(
          {
            channelId,
            mode: 'music_publish',
            sessionId: ackData.sessionId,
            streamId: ackData.musicId,
          },
          sendCommandAwaitAck,
        );
        await sfuSession.load(ackData.sfu);
        await sfuSession.produceTracks(localStream.getAudioTracks());
        if (publishedRuntime) {
          publishedRuntime.sfuSession = sfuSession;
        }
      } catch (err) {
        teardownPublishedRuntime();
        set({
          error: err instanceof Error ? err.message : 'Failed to start SFU music.',
          publishedMusic: null,
        });
        return;
      }
    }

    set({
      error: null,
      publishedMusic: {
        channelId,
        listeners: [],
        localStream,
        musicId: ackData.musicId,
        sessionId: ackData.sessionId,
        status: 'live',
      },
    });
    const knownRoomState = get().roomStateByChannel[channelId];
    if (knownRoomState) {
      reconcilePublishedMusic(channelId, knownRoomState);
    }
  },

  async stopMusicShare(sendCommandAwaitAck) {
    if (!publishedRuntime) {
      return;
    }

    const runtime = publishedRuntime;
    set((state) => ({
      publishedMusic: state.publishedMusic ? { ...state.publishedMusic, status: 'stopping' } : null,
    }));

    for (const listenerId of runtime.manager?.getPeerIds() ?? []) {
      sendPublishedSignal(listenerId, { type: 'end' });
    }

    teardownPublishedRuntime();

    try {
      await sendCommandAwaitAck('music.stop', { channelId: runtime.channelId, musicId: runtime.musicId });
    } catch {
      // Best effort: local publish teardown already completed.
    }

    set({ publishedMusic: null });
  },

  handleMusicStateUpdated(data, sendCommandAwaitAck, sendRawCommand) {
    const publicationsById = mapPublicationsById(data.publications);
    set((state) => {
      const nextRoomStateByChannel = { ...state.roomStateByChannel };
      if (data.publications.length > 0) {
        nextRoomStateByChannel[data.channelId] = publicationsById;
      } else {
        delete nextRoomStateByChannel[data.channelId];
      }
      return { roomStateByChannel: nextRoomStateByChannel };
    });

    reconcilePublishedMusic(data.channelId, publicationsById);
    reconcileListeningMusic(data.channelId, publicationsById);

    const myUserId = getMyUserId();
    if (!myUserId) {
      return;
    }

    for (const publication of data.publications) {
      if (publication.hostUserId === myUserId) {
        continue;
      }
      if (listeningRuntimes.has(publication.musicId) || get().listeningById[publication.musicId]) {
        continue;
      }
      void listenToMusic(publication, sendCommandAwaitAck, sendRawCommand);
    }
  },

  handleMediaSignal(data) {
    const { fromUserId, signal } = data;
    const musicId = signal.session.streamId;
    if (!musicId) {
      return;
    }

    if (signal.session.mode === 'music_publish') {
      void processListenSignal(data);
      return;
    }

    if (signal.session.mode !== 'music_listen' || !publishedRuntime || publishedRuntime.musicId !== musicId) {
      return;
    }

    void (async () => {
      switch (signal.type) {
        case 'answer': {
          if (!signal.sdp) return;
          await publishedRuntime?.manager?.handleAnswer(fromUserId, { type: 'answer', sdp: signal.sdp });

          const pending = takePendingPublishedIceCandidates(fromUserId);
          for (const candidate of pending) {
            try {
              await publishedRuntime?.manager?.addIceCandidate(fromUserId, candidate);
            } catch (err) {
              queuePendingPublishedIceCandidate(fromUserId, candidate);
              console.warn('[music] queued ICE flush failed for', fromUserId, err);
              break;
            }
          }
          return;
        }
        case 'ice_candidate': {
          if (!signal.candidate) return;
          if (!publishedRuntime?.manager?.getPeerIds().includes(fromUserId)) {
            queuePendingPublishedIceCandidate(fromUserId, signal.candidate);
            return;
          }
          try {
            await publishedRuntime.manager.addIceCandidate(fromUserId, signal.candidate);
          } catch (err) {
            queuePendingPublishedIceCandidate(fromUserId, signal.candidate);
            console.warn('[music] ICE add failed from', fromUserId, err);
          }
          return;
        }
        case 'restart_ice': {
          const offer = await publishedRuntime?.manager?.restartIce(fromUserId);
          if (offer) {
            sendPublishedSignal(fromUserId, { sdp: offer.sdp ?? '', type: 'offer' });
          }
          return;
        }
        case 'end':
          publishedRuntime?.manager?.closePeer(fromUserId);
          return;
        case 'offer':
          return;
      }
    })();
  },

  handleSfuProducerAdded(data) {
    const { producer } = data;
    if (producer.source !== 'music' || !producer.streamId) {
      return;
    }
    void consumeSfuMusicProducers(producer.streamId, [producer]);
  },

  handleSfuProducerRemoved(data) {
    const { producer } = data;
    const record = sfuMusicTracks.get(producer.id);
    if (!record) {
      return;
    }
    const runtime = listeningRuntimes.get(record.musicId);
    runtime?.remoteStream?.removeTrack(record.track);
    record.track.stop();
    sfuMusicTracks.delete(producer.id);
  },

  handleGatewayWillReconnect() {
    teardownAllRuntimes();
    set({
      error: null,
      listeningById: {},
      publishedMusic: null,
      roomStateByChannel: {},
    });
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
