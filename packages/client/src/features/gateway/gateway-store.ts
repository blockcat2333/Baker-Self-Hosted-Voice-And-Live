import { create } from 'zustand';

import type { ApiClient } from '@baker/sdk';
import { GatewayClient } from '@baker/sdk';
import type { GatewayCommandName, VoiceParticipant } from '@baker/protocol';
import {
  MediaSignalRelayEventDataSchema,
  MessageCreatedEventDataSchema,
  PresenceUpdatedEventDataSchema,
  StreamStateUpdatedEventDataSchema,
  VoiceMemberUpdatedEventDataSchema,
  VoiceNetworkUpdatedEventDataSchema,
  VoiceRosterUpdatedEventDataSchema,
  VoiceSpeakingUpdatedEventDataSchema,
  VoiceStateUpdatedEventDataSchema,
} from '@baker/protocol';

import { useAuthStore } from '../auth/auth-store';
import { useChatStore } from '../chat/chat-store';
import { closeAllStreamPopups } from '../stream/stream-popup-controller';
import { useStreamStore } from '../stream/stream-store';
import { useVoiceStore } from '../voice/voice-store';

export type GatewayStatus =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'reconnecting'
  | 'ready'
  | 'error';

export interface PresenceEntry {
  connectionCount: number;
  status: 'idle' | 'offline' | 'online';
  username: string | null;
}

export interface VoiceNetworkEntry {
  gatewayLossPct: number | null;
  gatewayRttMs: number | null;
  mediaSelfLossPct: number | null;
  stale: boolean;
  updatedAt: string;
}

interface GatewayState {
  status: GatewayStatus;
  reconnectAttempt: number;
  presenceMap: Record<string, PresenceEntry>;
  voiceNetworkByChannel: Record<string, Record<string, VoiceNetworkEntry>>;
  voiceRosterByChannel: Record<string, VoiceParticipant[]>;
  gatewayRttMs: number | null;
  error: string | null;

  connect(api: ApiClient, gatewayUrl: string): void;
  disconnect(): void;
  subscribeChannel(channelId: string): void;
  unsubscribeChannel(channelId: string): void;
  updatePresenceUsername(userId: string, username: string): void;
  /** Called when the active channel changes — unsubscribes old, subscribes new. */
  switchChannel(prevChannelId: string | null, nextChannelId: string | null): void;
}

// ── Module-level singletons ───────────────────────────────────────────────────

let client: GatewayClient | null = null;
let reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
let savedApi: ApiClient | null = null;
let savedUrl: string | null = null;
let pingTimerId: ReturnType<typeof setInterval> | null = null;
let lastPingSentAtMs: number | null = null;
let handshakeTimerId: ReturnType<typeof setTimeout> | null = null;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_FACTOR = 2;
const LATENCY_PING_INTERVAL_MS = 5_000;
const HANDSHAKE_TIMEOUT_MS = 8_000;

// ── Pending ack registry ──────────────────────────────────────────────────────

type PendingAck = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const pendingAcks = new Map<string, PendingAck>();

// ── Module-level send helpers (exported for use by voice-store via components) ─

/**
 * Send a command and return a promise that resolves with the ack data,
 * or rejects on gateway error or timeout.
 */
export function sendCommandAwaitAck(
  command: GatewayCommandName,
  data: unknown,
  timeoutMs = 8_000,
): Promise<unknown> {
  if (!client) return Promise.reject(new Error('Gateway not connected'));

  return new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingAcks.delete(reqId);
      reject(new Error(`Command ${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingAcks.set(reqId, { resolve, reject, timer });
    client!.sendCommand({ command, data, reqId });
  });
}

/** Fire-and-forget command (no ack tracking). */
export function sendRawCommand(command: GatewayCommandName, data: unknown): void {
  client?.sendCommand({ command, data });
}

// ── Reconnect helpers ─────────────────────────────────────────────────────────

function reconnectDelay(attempt: number): number {
  const exp = Math.min(RECONNECT_BASE_MS * RECONNECT_FACTOR ** attempt, RECONNECT_MAX_MS);
  // ±25% jitter
  const jitter = exp * 0.25 * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}

function cancelReconnect() {
  if (reconnectTimerId !== null) {
    clearTimeout(reconnectTimerId);
    reconnectTimerId = null;
  }
}

function clearHandshakeTimeout() {
  if (handshakeTimerId !== null) {
    clearTimeout(handshakeTimerId);
    handshakeTimerId = null;
  }
}

function clearLatencyProbe() {
  if (pingTimerId !== null) {
    clearInterval(pingTimerId);
    pingTimerId = null;
  }
  lastPingSentAtMs = null;
}

function sendLatencyPing() {
  if (!client) return;
  lastPingSentAtMs = Date.now();
  client.ping();
}

function ensureLatencyProbe() {
  if (pingTimerId !== null) return;
  sendLatencyPing();
  pingTimerId = setInterval(() => {
    sendLatencyPing();
  }, LATENCY_PING_INTERVAL_MS);
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useGatewayStore = create<GatewayState>((set, get) => {
  function scheduleReconnect() {
    const { reconnectAttempt } = get();
    const delay = reconnectDelay(reconnectAttempt);
    set({ status: 'reconnecting', reconnectAttempt: reconnectAttempt + 1 });
    reconnectTimerId = setTimeout(() => {
      reconnectTimerId = null;
      if (savedApi && savedUrl) {
        client = null;
        get().connect(savedApi, savedUrl);
      }
    }, delay);
  }

  function openConnection(api: ApiClient, gatewayUrl: string) {
    savedApi = api;
    savedUrl = gatewayUrl;

    clearLatencyProbe();
    clearHandshakeTimeout();
    set({
      status: 'connecting',
      error: null,
      gatewayRttMs: null,
      presenceMap: {},
      voiceNetworkByChannel: {},
      voiceRosterByChannel: {},
    });

    const newClient = new GatewayClient(gatewayUrl);
    client = newClient;
    let transportDownHandled = false;

    const handleTransportDown = () => {
      if (transportDownHandled) return;
      transportDownHandled = true;
      removeEnvelopeListener();
      if (client === newClient) {
        client = null;
      }
      clearLatencyProbe();
      clearHandshakeTimeout();
      useVoiceStore.getState().handleGatewayWillReconnect();
      useStreamStore.getState().handleGatewayWillReconnect();
      set({ gatewayRttMs: null, presenceMap: {}, voiceRosterByChannel: {}, voiceNetworkByChannel: {} });
      const { status } = get();
      if (status !== 'disconnected' && savedApi && savedUrl) {
        scheduleReconnect();
      }
    };

    const armHandshakeTimeout = () => {
      clearHandshakeTimeout();
      handshakeTimerId = setTimeout(() => {
        const { status } = get();
        if (status === 'connecting' || status === 'authenticating') {
          set({ error: 'Gateway handshake timed out.' });
          handleTransportDown();
          newClient.close();
        }
      }, HANDSHAKE_TIMEOUT_MS);
    };
    armHandshakeTimeout();

    const removeEnvelopeListener = newClient.onEnvelope((envelope) => {
      if (envelope.op === 'pong') {
        if (lastPingSentAtMs !== null) {
          const rtt = Math.max(0, Math.round(Date.now() - lastPingSentAtMs));
          set({ gatewayRttMs: rtt });
          lastPingSentAtMs = null;
        }
        return;
      }

      // ── Resolve pending acks by reqId first ────────────────────────────────
      if (envelope.op === 'ack') {
        const pending = pendingAcks.get(envelope.reqId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingAcks.delete(envelope.reqId);
          pending.resolve(envelope.data);
          // Don't fall through — this ack belongs to a tracked command.
          return;
        }
      }

      if (envelope.op === 'error' && envelope.reqId) {
        const pending = pendingAcks.get(envelope.reqId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingAcks.delete(envelope.reqId);
          pending.reject(new Error(envelope.message));
          // Allow auth-level errors to fall through to the auth error handler.
          const AUTH_CODES = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID', 'UNAUTHORIZED']);
          if (!AUTH_CODES.has(envelope.code)) return;
        }
      }

      // ── Event dispatch ─────────────────────────────────────────────────────
      if (envelope.op === 'event') {
        if (envelope.event === 'system.ready') {
          // Clear stale roster so reconnect starts with an authoritative snapshot.
          set({ status: 'authenticating', presenceMap: {} });
          const accessToken = useAuthStore.getState().accessToken;
          if (!accessToken) {
            set({ status: 'error', error: 'No access token for gateway auth.' });
            savedApi = null;
            savedUrl = null;
            newClient.close();
            return;
          }
          newClient.sendCommand({ command: 'system.authenticate', data: { accessToken } });
        }

        if (envelope.event === 'chat.message.created') {
          const result = MessageCreatedEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            useChatStore.getState().appendRealtimeMessage(result.data);
          }
        }

        if (envelope.event === 'presence.updated') {
          const result = PresenceUpdatedEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            const { userId, status, connectionCount, username } = result.data;
            if (status === 'offline' || connectionCount <= 0) {
              // Remove entirely so the map only holds live online entries.
              // This keeps the presenceMap clean after disconnect/logout.
              set((state) => {
                const { [userId]: _removed, ...rest } = state.presenceMap;
                return { presenceMap: rest };
              });
            } else {
              set((state) => ({
                presenceMap: {
                  ...state.presenceMap,
                  [userId]: { connectionCount, status, username },
                },
              }));
            }
          }
        }

        if (envelope.event === 'voice.state.updated') {
          const result = VoiceStateUpdatedEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            useVoiceStore.getState().handleVoiceStateUpdated(result.data);
          }
        }

        if (envelope.event === 'voice.member.updated') {
          const result = VoiceMemberUpdatedEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            useVoiceStore.getState().handleVoiceMemberUpdated(result.data);
          }
        }

        if (envelope.event === 'voice.speaking.updated') {
          const result = VoiceSpeakingUpdatedEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            useVoiceStore.getState().handleVoiceSpeakingUpdated(result.data);
          }
        }

        if (envelope.event === 'voice.roster.updated') {
          const result = VoiceRosterUpdatedEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            set((state) => ({
              voiceRosterByChannel: {
                ...state.voiceRosterByChannel,
                [result.data.channelId]: result.data.participants,
              },
            }));
          }
        }

        if (envelope.event === 'voice.network.updated') {
          const result = VoiceNetworkUpdatedEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            const byUser: Record<string, VoiceNetworkEntry> = {};
            for (const participant of result.data.participants) {
              byUser[participant.userId] = {
                gatewayLossPct: participant.gatewayLossPct,
                gatewayRttMs: participant.gatewayRttMs,
                mediaSelfLossPct: participant.mediaSelfLossPct,
                stale: participant.stale,
                updatedAt: participant.updatedAt,
              };
            }
            set((state) => ({
              voiceNetworkByChannel: {
                ...state.voiceNetworkByChannel,
                [result.data.channelId]: byUser,
              },
            }));
          }
        }

        if (envelope.event === 'stream.state.updated') {
          const result = StreamStateUpdatedEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            useStreamStore.getState().handleStreamStateUpdated(result.data);
          }
        }

        if (envelope.event === 'media.signal') {
          const result = MediaSignalRelayEventDataSchema.safeParse(envelope.data);
          if (result.success) {
            if (result.data.signal.session.mode === 'voice') {
              useVoiceStore.getState().handleMediaSignal(result.data);
            } else {
              useStreamStore.getState().handleMediaSignal(result.data);
            }
          }
        }
      }

      // ── Auth ack (no reqId tracking) ───────────────────────────────────────
      if (envelope.op === 'ack') {
        if (get().status === 'authenticating') {
          clearHandshakeTimeout();
          ensureLatencyProbe();
          set({ status: 'ready', reconnectAttempt: 0, error: null });
          const { activeChannelId } = useChatStore.getState();
          if (activeChannelId) {
            get().subscribeChannel(activeChannelId);
          }
          void useVoiceStore.getState().handleGatewayReconnected();
          void useStreamStore.getState().handleGatewayReconnected(sendCommandAwaitAck, sendRawCommand);
        }
      }

      // ── Error handler ──────────────────────────────────────────────────────
      if (envelope.op === 'error') {
        const { code } = envelope;

        if (code === 'TOKEN_EXPIRED') {
          clearLatencyProbe();
          clearHandshakeTimeout();
          set({ gatewayRttMs: null });
          savedApi = null;
          savedUrl = null;
          newClient.close();
          useAuthStore.getState().refreshTokens(api).then((newToken) => {
            if (newToken) {
              client = null;
              get().connect(api, gatewayUrl);
            } else {
              set({ status: 'error', error: 'Session expired. Please log in again.' });
            }
          });
        } else if (code === 'TOKEN_INVALID' || code === 'UNAUTHORIZED') {
          clearLatencyProbe();
          clearHandshakeTimeout();
          set({ gatewayRttMs: null });
          void useAuthStore.getState().logout();
          savedApi = null;
          savedUrl = null;
          newClient.close();
          set({ status: 'error', error: 'Authentication failed. Please log in again.' });
        } else {
          set({ error: envelope.message });
        }
      }
    });

    newClient.onError(() => {
      handleTransportDown();
    });

    newClient.onClose(() => {
      handleTransportDown();
    });

    newClient.connect();
  }

  return {
    status: 'disconnected',
    reconnectAttempt: 0,
    presenceMap: {},
    voiceNetworkByChannel: {},
    voiceRosterByChannel: {},
    gatewayRttMs: null,
    error: null,

    connect(api, gatewayUrl) {
      if (client) return;
      cancelReconnect();
      openConnection(api, gatewayUrl);
    },

    disconnect() {
      cancelReconnect();
      clearLatencyProbe();
      clearHandshakeTimeout();
      savedApi = null;
      savedUrl = null;
      client?.close();
      client = null;
      closeAllStreamPopups();
      useVoiceStore.getState().handleGatewayDisconnected();
      useStreamStore.getState().reset();
      set({
        status: 'disconnected',
        reconnectAttempt: 0,
        error: null,
        gatewayRttMs: null,
        presenceMap: {},
        voiceNetworkByChannel: {},
        voiceRosterByChannel: {},
      });
    },

    subscribeChannel(channelId) {
      client?.sendCommand({ command: 'channel.subscribe', data: { channelId } });
    },

    unsubscribeChannel(channelId) {
      client?.sendCommand({ command: 'channel.unsubscribe', data: { channelId } });
    },

    updatePresenceUsername(userId, username) {
      set((state) => {
        const existing = state.presenceMap[userId];
        if (!existing) {
          return state;
        }

        return {
          presenceMap: {
            ...state.presenceMap,
            [userId]: {
              ...existing,
              username,
            },
          },
        };
      });
    },

    switchChannel(prevChannelId, nextChannelId) {
      if (prevChannelId) get().unsubscribeChannel(prevChannelId);
      if (nextChannelId) get().subscribeChannel(nextChannelId);
    },
  };
});
