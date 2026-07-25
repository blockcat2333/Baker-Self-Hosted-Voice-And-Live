/**
 * GatewayRuntime is the application-layer object for the gateway.
 *
 * It holds:
 *   - ConnectionManager (in-memory connection registry)
 *   - PresenceManager (Redis-backed presence tracking)
 *   - VoiceRoomManager (in-memory voice room state)
 *   - Redis pub client (reserved for future outbound publish)
 *   - Redis sub client (psubscribes to bakr:channel:*:messages)
 *   - TokenVerifier (JWT verification)
 *   - DatabaseAccess (for channel membership checks)
 *   - StreamRoomManager (in-memory livestream room state)
 *   - mediaBaseUrl (for creating media sessions in apps/media)
 *
 * FANOUT_DISABLED: if Redis is unavailable at startup, fanoutEnabled is false.
 * All fanout operations check this flag and log a WARN rather than silently
 * skipping. The gateway still accepts connections and authenticates clients.
 */

import { createEventEnvelope } from '@baker/protocol';
import {
  MediaSfuConsumeAckDataSchema,
  MediaSfuCreateTransportAckDataSchema,
  MediaSfuProduceAckDataSchema,
} from '@baker/protocol';
import type {
  MediaSfuCloseCommandData,
  MediaSfuConnectTransportCommandData,
  MediaSfuConsumeAckData,
  MediaSfuConsumeCommandData,
  MediaSfuCreateTransportAckData,
  MediaSfuCreateTransportCommandData,
  MediaSfuProduceAckData,
  MediaSfuProduceCommandData,
  MediaSfuResumeConsumerCommandData,
  MediaSessionResponse,
  MediaTransportMode,
  SessionMode,
  SfuProducer,
} from '@baker/protocol';

import {
  createLogger,
  normalizeMediaRegionHost,
  resolveMediaRegionProfileForHosts,
  type MediaRegionProfile,
} from '@baker/shared';

import type { DatabaseAccess } from '@baker/db';

import type { RedisClient } from './lib/redis';
import type { TokenVerifier } from './lib/token-verifier';
import { ConnectionManager } from './ws/connection-manager';
import { MusicRoomManager } from './ws/music-room-manager';
import { PresenceManager } from './ws/presence-manager';
import { StreamRoomManager } from './ws/stream-room-manager';
import { VoiceRoomManager } from './ws/voice-room-manager';
import type { GatewayConnection } from './ws/connection-manager';

const log = createLogger('gateway:runtime');

// Redis channel pattern for message fanout.
const MESSAGE_CHANNEL_PATTERN = 'bakr:channel:*:messages';
const MESSAGE_CHANNEL_REGEX = /^bakr:channel:([0-9a-f-]+):messages$/;
const MEDIA_MODE_CHANNEL = 'bakr:server:media-mode';

const MEDIA_SESSION_TIMEOUT_MS = 5_000;

export interface GatewayRuntimeOptions {
  db: DatabaseAccess;
  fanoutEnabled: boolean;
  mediaBaseUrl: string;
  mediaInternalSecret: string;
  mediaRegionProfiles?: MediaRegionProfile[];
  pubClient: RedisClient | null;
  subClient: RedisClient | null;
  tokenVerifier: TokenVerifier;
}

export class GatewayRuntime {
  readonly connections: ConnectionManager;
  readonly presence: PresenceManager;
  readonly musicRoom: MusicRoomManager;
  readonly streamRoom: StreamRoomManager;
  readonly voiceRoom: VoiceRoomManager;
  readonly tokenVerifier: TokenVerifier;
  readonly db: DatabaseAccess;
  readonly fanoutEnabled: boolean;
  mediaMode: MediaTransportMode = 'p2p';

  private readonly mediaBaseUrl: string;
  private readonly mediaInternalSecret: string;
  private readonly mediaRegionProfiles: MediaRegionProfile[];
  private readonly pubClient: RedisClient | null;
  private readonly subClient: RedisClient | null;

  constructor(options: GatewayRuntimeOptions) {
    this.connections = new ConnectionManager();
    this.db = options.db;
    this.fanoutEnabled = options.fanoutEnabled;
    this.mediaBaseUrl = options.mediaBaseUrl;
    this.mediaInternalSecret = options.mediaInternalSecret;
    this.mediaRegionProfiles = options.mediaRegionProfiles ?? [];
    this.pubClient = options.pubClient;
    this.subClient = options.subClient;
    this.tokenVerifier = options.tokenVerifier;
    this.presence = new PresenceManager(this.connections, options.pubClient);
    this.musicRoom = new MusicRoomManager(this.connections);
    this.streamRoom = new StreamRoomManager(this.connections);
    this.voiceRoom = new VoiceRoomManager(this.connections);
  }

  /**
   * Call apps/media to create a media session and obtain ICE server config.
   * Throws on timeout or non-2xx response.
   */
  async createMediaSession(descriptor: {
    channelId: string;
    mediaRegionId?: string | null;
    mode: SessionMode;
    sessionId: string;
    streamId?: string;
    userId: string;
  }): Promise<MediaSessionResponse> {
    const url = `${this.mediaBaseUrl}/v1/internal/media/sessions`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_SESSION_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        body: JSON.stringify({
          ...descriptor,
          ...(descriptor.mediaRegionId ? { mediaRegionId: descriptor.mediaRegionId } : {}),
          transportMode: this.mediaMode,
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-baker-internal-secret': this.mediaInternalSecret,
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Media session create failed: HTTP ${response.status}`);
      }

      const json: unknown = await response.json();
      // Validate with schema
      const { MediaSessionResponseSchema } = await import('@baker/protocol');
      return MediaSessionResponseSchema.parse(json);
    } finally {
      clearTimeout(timer);
    }
  }

  async refreshMediaMode(): Promise<void> {
    const settings = await this.db.serverSettings.findById('default');
    this.mediaMode = settings?.mediaMode ?? 'p2p';
  }

  resolveMediaRegionIdForRequestHosts(hosts: string[]): string | null {
    const profile = resolveMediaRegionProfileForHosts(
      this.mediaRegionProfiles,
      hosts.map(normalizeMediaRegionHost),
    );
    return profile?.id ?? null;
  }

  async createSfuTransport(data: MediaSfuCreateTransportCommandData): Promise<MediaSfuCreateTransportAckData> {
    const json = await this.callMedia('/v1/internal/media/sfu/transports', data);
    return MediaSfuCreateTransportAckDataSchema.parse(json);
  }

  async connectSfuTransport(data: MediaSfuConnectTransportCommandData): Promise<void> {
    await this.callMedia('/v1/internal/media/sfu/transports/connect', data);
  }

  async produceSfu(data: MediaSfuProduceCommandData & { userId: string }): Promise<MediaSfuProduceAckData> {
    const json = await this.callMedia('/v1/internal/media/sfu/producers', data);
    const parsed = MediaSfuProduceAckDataSchema.parse(json);
    this.broadcastSfuProducerAdded(parsed.producer);
    return parsed;
  }

  async consumeSfu(data: MediaSfuConsumeCommandData): Promise<MediaSfuConsumeAckData> {
    const json = await this.callMedia('/v1/internal/media/sfu/consumers', data);
    return MediaSfuConsumeAckDataSchema.parse(json);
  }

  async resumeSfuConsumer(data: MediaSfuResumeConsumerCommandData): Promise<void> {
    await this.callMedia('/v1/internal/media/sfu/consumers/resume', data);
  }

  async closeSfu(data: MediaSfuCloseCommandData): Promise<void> {
    const json = await this.callMedia('/v1/internal/media/sfu/close', data);
    const closedProducer = typeof json === 'object' && json !== null && 'closedProducer' in json
      ? (json as { closedProducer?: unknown }).closedProducer
      : undefined;
    if (closedProducer) {
      this.broadcastSfuProducerRemoved(closedProducer as SfuProducer);
    }
  }

  async closeSfuSession(input: { channelId: string; mode: SessionMode; sessionId: string; streamId?: string }): Promise<void> {
    await this.closeSfu(input).catch((err) => {
      log.warn({ err, sessionId: input.sessionId }, 'Failed to close SFU session');
    });
  }

  private async callMedia(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_SESSION_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.mediaBaseUrl}${path}`, {
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json',
          'x-baker-internal-secret': this.mediaInternalSecret,
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Media request failed: HTTP ${response.status}${text ? ` ${text}` : ''}`);
      }

      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Start the Redis psubscribe fanout loop.
   * Must be called once after the runtime is constructed.
   * No-op if fanout is disabled.
   */
  startFanout(): void {
    if (!this.subClient || !this.fanoutEnabled) {
      log.warn('[FANOUT_DISABLED] Skipping Redis psubscribe — fanout is disabled for this instance');
      return;
    }

    this.subClient.psubscribe(MESSAGE_CHANNEL_PATTERN, (err) => {
      if (err) {
        log.warn({ err }, '[FANOUT_DISABLED] psubscribe failed — message push will not work');
        return;
      }
      log.info({ pattern: MESSAGE_CHANNEL_PATTERN }, 'Subscribed to Redis message pattern');
    });

    this.subClient.subscribe(MEDIA_MODE_CHANNEL, (err) => {
      if (err) {
        log.warn({ err }, '[FANOUT_DISABLED] media mode subscription failed');
      }
    });

    this.subClient.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const match = MESSAGE_CHANNEL_REGEX.exec(channel);
      if (!match) return;

      const channelId = match[1];
      if (!channelId) return;

      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        log.warn({ channel }, 'Received non-JSON message from Redis — skipping');
        return;
      }

      const subscribers = this.connections.getByChannel(channelId);
      if (subscribers.length === 0) return;

      for (const conn of subscribers) {
        try {
          const envelope = createEventEnvelope(conn.nextSequence(), 'chat.message.created', payload);
          conn.socket.send(JSON.stringify(envelope));
        } catch (err) {
          log.warn({ err, connectionId: conn.id, channelId }, 'Failed to push message.created to connection');
        }
      }
    });

    this.subClient.on('message', (channel: string, message: string) => {
      if (channel !== MEDIA_MODE_CHANNEL) {
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        return;
      }

      const mediaMode = typeof payload === 'object' && payload !== null && 'mediaMode' in payload
        ? (payload as { mediaMode?: unknown }).mediaMode
        : null;
      if (mediaMode !== 'p2p' && mediaMode !== 'sfu') {
        return;
      }

      void this.applyMediaMode(mediaMode, 'admin_changed');
    });
  }

  async applyMediaMode(mediaMode: MediaTransportMode, reason: 'admin_changed'): Promise<void> {
    if (this.mediaMode === mediaMode) {
      return;
    }

    this.mediaMode = mediaMode;
    const voiceChannelIds = this.voiceRoom.getActiveChannelIds();
    const streamChanges = this.streamRoom.clearAll();
    const musicChanges = this.musicRoom.clearAll();
    const affectedChannelIds = [...new Set([
      ...voiceChannelIds,
      ...streamChanges.map((change) => change.channelId),
      ...musicChanges.map((change) => change.channelId),
    ])];
    const targetConnectionIds = new Set<string>();

    for (const channelId of voiceChannelIds) {
      for (const participant of this.voiceRoom.getParticipants(channelId)) {
        targetConnectionIds.add(participant.connectionId);
      }
      this.voiceRoom.clearChannel(channelId);
      await this.broadcastVoiceRosterUpdated(channelId);
    }

    for (const change of streamChanges) {
      if (change.type === 'host_stopped') {
        for (const connectionId of change.connectionIds) {
          targetConnectionIds.add(connectionId);
        }
        void this.db.streamSessions.updateStatus(change.sessionId, 'idle', { endedAt: new Date() });
      }
    }

    for (const change of musicChanges) {
      if (change.type === 'host_stopped') {
        for (const connectionId of change.connectionIds) {
          targetConnectionIds.add(connectionId);
        }
      }
    }

    const data = {
      affectedChannelIds,
      mediaMode,
      reason,
    };

    for (const connectionId of targetConnectionIds) {
      const conn = this.connections.getById(connectionId);
      if (!conn) continue;
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'media.mode.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, connectionId, mediaMode }, 'Failed to send media.mode.updated');
      }
    }
  }

  broadcastSfuProducerAdded(producer: SfuProducer): void {
    this.broadcastSfuProducerEvent('media.sfu.producer.added', producer);
  }

  broadcastSfuProducerRemoved(producer: SfuProducer): void {
    this.broadcastSfuProducerEvent('media.sfu.producer.removed', producer);
  }

  private broadcastSfuProducerEvent(event: 'media.sfu.producer.added' | 'media.sfu.producer.removed', producer: SfuProducer): void {
    const connectionIds =
      producer.source === 'voice'
        ? this.voiceRoom.getParticipants(producer.channelId).map((participant) => participant.connectionId)
        : producer.source === 'music'
          ? this.voiceRoom.getParticipants(producer.channelId).map((participant) => participant.connectionId)
          : this.streamRoom.getAudienceConnectionIds(producer.channelId, producer.streamId);

    for (const connectionId of connectionIds) {
      const conn = this.connections.getById(connectionId);
      if (!conn || conn.userId === producer.userId) continue;
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), event, { producer });
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, connectionId, producerId: producer.id }, `Failed to send ${event}`);
      }
    }
  }

  private getGuildMemberConnectionIds(guildId: string): string[] {
    return this.connections
      .getAll()
      .filter((conn) => conn.userId && conn.guildIds.has(guildId))
      .map((conn) => conn.id);
  }

  async broadcastVoiceRosterUpdated(channelId: string): Promise<void> {
    const channel = await this.db.channels.findById(channelId);
    if (!channel || channel.type !== 'voice') {
      return;
    }

    const participants = this.voiceRoom.getParticipants(channelId);
    const connectionIds = this.getGuildMemberConnectionIds(channel.guildId);
    this.voiceRoom.broadcastRosterUpdated(channelId, participants, connectionIds);
  }

  noteGatewayPingSent(connectionId: string, sentAtMs: number): boolean {
    return this.connections.noteGatewayPingSent(connectionId, sentAtMs);
  }

  async noteGatewayPingTimeout(connectionId: string, timeoutAtMs: number): Promise<boolean> {
    const updated = this.connections.noteGatewayPingTimeout(connectionId, timeoutAtMs);
    if (!updated) return false;

    const conn = this.connections.getById(connectionId);
    const channelId = conn?.voiceChannelId;
    if (!channelId) return true;
    await this.broadcastVoiceNetworkUpdated(channelId);
    return true;
  }

  async noteGatewayPong(connectionId: string, pongAtMs: number): Promise<boolean> {
    const updated = this.connections.noteGatewayPong(connectionId, pongAtMs);
    if (!updated) return false;

    const conn = this.connections.getById(connectionId);
    const channelId = conn?.voiceChannelId;
    if (!channelId) return true;
    await this.broadcastVoiceNetworkUpdated(channelId);
    return true;
  }

  async updateVoiceMediaSelfLoss(
    connectionId: string,
    channelId: string,
    mediaSelfLossPct: number,
  ): Promise<void> {
    const conn = this.connections.getById(connectionId);
    if (!conn || conn.voiceChannelId !== channelId) {
      return;
    }
    const updated = this.connections.updateMediaSelfLoss(connectionId, mediaSelfLossPct, Date.now());
    if (!updated) return;
    await this.broadcastVoiceNetworkUpdated(channelId);
  }

  async broadcastVoiceNetworkUpdated(channelId: string): Promise<void> {
    const participants = this.voiceRoom.getParticipants(channelId);
    if (participants.length === 0) {
      return;
    }

    const nowMs = Date.now();
    const data = {
      channelId,
      participants: participants.map((participant) => {
        const snapshot = this.connections.getVoiceConnectionNetworkSnapshot(
          participant.connectionId,
          nowMs,
        );
        return {
          gatewayLossPct: snapshot?.gatewayLossPct ?? null,
          gatewayRttMs: snapshot?.gatewayRttMs ?? null,
          mediaSelfLossPct: snapshot?.mediaSelfLossPct ?? null,
          stale: snapshot?.stale ?? true,
          updatedAt: snapshot?.updatedAt ?? new Date(nowMs).toISOString(),
          userId: participant.userId,
        };
      }),
    };

    for (const participant of participants) {
      const conn = this.connections.getById(participant.connectionId);
      if (!conn) continue;
      try {
        const envelope = createEventEnvelope(conn.nextSequence(), 'voice.network.updated', data);
        conn.socket.send(JSON.stringify(envelope));
      } catch (err) {
        log.warn({ err, channelId, connectionId: participant.connectionId }, 'Failed to send voice.network.updated');
      }
    }
  }

  async sendVoiceRosterSnapshotToConnection(connection: GatewayConnection): Promise<void> {
    if (!connection.userId) {
      return;
    }

    for (const guildId of connection.guildIds) {
      const channels = await this.db.channels.listByGuildForUser(guildId, connection.userId);
      for (const channel of channels) {
        if (channel.type !== 'voice') continue;
        const participants = this.voiceRoom.getParticipants(channel.id);
        this.voiceRoom.broadcastRosterUpdated(channel.id, participants, [connection.id]);
      }
    }
  }
}
