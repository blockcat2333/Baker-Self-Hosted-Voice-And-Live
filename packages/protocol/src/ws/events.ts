import { z } from 'zod';

import { IceServerSchema } from '../media/signaling';

export const ConnectionStateSchema = z.enum(['closed', 'connected', 'connecting', 'failed', 'reconnecting']);
export const RoomRuntimeStateSchema = z.enum(['closing', 'idle', 'recovering', 'stream_live', 'stream_preparing', 'voice_active']);

export const GatewayEventNameSchema = z.enum([
  'chat.message.created',
  'guild.member.updated',
  /** Single relay event for all media.signal.* types; signal.type discriminates. */
  'media.signal',
  'presence.updated',
  'stream.session.updated',
  'stream.state.updated',
  'stream.viewer.joined',
  'stream.viewer.left',
  'system.notification',
  'system.ready',
  'system.resync_required',
  'voice.member.updated',
  'voice.network.updated',
  'voice.roster.updated',
  'voice.speaking.updated',
  'voice.state.updated',
]);

export const GatewayCommandNameSchema = z.enum([
  'channel.subscribe',
  'channel.unsubscribe',
  'media.signal.answer',
  'media.signal.end',
  'media.signal.ice_candidate',
  'media.signal.offer',
  'media.signal.restart_ice',
  'presence.subscribe',
  'stream.start',
  'stream.stop',
  'stream.unwatch',
  'stream.watch',
  'system.authenticate',
  'typing.set',
  'voice.join',
  'voice.leave',
  'voice.network.self_report',
  'voice.speaking.updated',
]);

export const SystemReadyEventDataSchema = z.object({
  capabilities: z.object({
    chat: z.boolean(),
    presence: z.boolean(),
    stream: z.boolean(),
    voice: z.boolean(),
  }),
  connectionId: z.string().min(1),
  serverTime: z.string().datetime(),
});

export const PresenceUpdatedEventDataSchema = z.object({
  connectionCount: z.number().int().nonnegative(),
  status: z.enum(['idle', 'offline', 'online']),
  userId: z.string().uuid(),
  /** Display name — null when the gateway cannot resolve it (e.g. Redis-only snapshot). */
  username: z.string().nullable(),
});

export const StreamSourceTypeSchema = z.enum(['screen', 'camera']);
export const StreamStatusSchema = z.enum(['failed', 'idle', 'live', 'starting', 'stopping']);
export const StreamResolutionSchema = z.enum(['1080p', '1440p', '480p', '720p']);
export const StreamFrameRateSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);
export const StreamBitrateKbpsSchema = z.union([
  z.literal(2000),
  z.literal(4000),
  z.literal(6000),
  z.literal(10000),
  z.literal(16000),
]);
export const StreamQualitySettingsSchema = z.object({
  bitrateKbps: StreamBitrateKbpsSchema,
  frameRate: StreamFrameRateSchema,
  resolution: StreamResolutionSchema,
});

export const StreamSessionSchema = z.object({
  hostUserId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sourceType: StreamSourceTypeSchema,
  status: StreamStatusSchema,
  streamId: z.string().uuid().optional(),
});

export const StreamSessionUpdatedEventDataSchema = z.object({
  channelId: z.string().uuid(),
  session: StreamSessionSchema.nullable().default(null),
});

export const StreamViewerSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const StreamPublicationSchema = z.object({
  channelId: z.string().uuid(),
  hostUserId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sourceType: StreamSourceTypeSchema,
  status: StreamStatusSchema,
  streamId: z.string().uuid(),
  viewers: z.array(StreamViewerSchema),
});

// ── Stream command data ───────────────────────────────────────────────────────

export const StreamStartCommandDataSchema = z.object({
  channelId: z.string().uuid(),
  quality: StreamQualitySettingsSchema.optional(),
  sourceType: StreamSourceTypeSchema,
});

export const StreamStopCommandDataSchema = z.object({
  channelId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
});

export const StreamWatchCommandDataSchema = z.object({
  channelId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
});

export const StreamUnwatchCommandDataSchema = z.object({
  channelId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
});

// ── Stream ack data ───────────────────────────────────────────────────────────

export const StreamStartAckDataSchema = z.object({
  channelId: z.string().uuid(),
  iceServers: z.array(IceServerSchema),
  sessionId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
});

export const StreamWatchAckDataSchema = z.object({
  channelId: z.string().uuid(),
  hostSessionId: z.string().uuid(),
  hostUserId: z.string().uuid(),
  iceServers: z.array(IceServerSchema),
  sessionId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
});

export const StreamStopAckDataSchema = z.object({
  channelId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
});

export const StreamUnwatchAckDataSchema = z.object({
  channelId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
});

// ── Stream event data ─────────────────────────────────────────────────────────

export const StreamStateUpdatedEventDataSchema = z.object({
  channelId: z.string().uuid(),
  session: StreamSessionSchema.nullable().default(null),
  streams: z.array(StreamPublicationSchema).default([]),
  viewers: z.array(StreamViewerSchema).default([]),
});

export const StreamViewerJoinedEventDataSchema = z.object({
  channelId: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const StreamViewerLeftEventDataSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const SystemNotificationEventDataSchema = z.object({
  level: z.enum(['error', 'info', 'warning']),
  message: z.string().min(1),
});

// WS-specific message created payload — distinct from the HTTP MessageSchema.
// Does not include editedAt (no edit feature in M2).
export const MessageCreatedEventDataSchema = z.object({
  authorUserId: z.string().uuid(),
  authorUsername: z.string(),
  channelId: z.string().uuid(),
  content: z.string().min(1).max(4000),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
  kind: z.enum(['system', 'text']),
});

// ── Voice participant ─────────────────────────────────────────────────────────

/**
 * A single participant in a voice channel room.
 * Used in both voice.state.updated snapshots and voice.join ack payloads.
 */
export const VoiceParticipantSchema = z.object({
  isMuted: z.boolean(),
  sessionId: z.string().uuid(),
  userId: z.string().uuid(),
});

// ── Voice events ──────────────────────────────────────────────────────────────

/**
 * voice.state.updated — full room snapshot.
 *
 * Sent when the set of participants changes (join, leave, disconnect).
 * Clients must REPLACE their entire participant list on receipt and
 * reconcile WebRTC connections (close peers for absent users, offer to new ones).
 */
export const VoiceStateUpdatedEventDataSchema = z.object({
  channelId: z.string().uuid(),
  participants: z.array(VoiceParticipantSchema),
});

/**
 * voice.member.updated — single stable participant state change.
 *
 * Sent for durable per-participant changes such as mute/unmute.
 * Clients PATCH exactly one participant by userId. WebRTC connections
 * are not affected.
 */
export const VoiceMemberUpdatedEventDataSchema = z.object({
  channelId: z.string().uuid(),
  participant: VoiceParticipantSchema,
});

/**
 * voice.roster.updated - channel roster snapshot for sidebar rendering.
 *
 * Broadcast to authenticated guild members so voice channel rosters remain
 * visible even when the client is not currently joined to that channel.
 */
export const VoiceRosterUpdatedEventDataSchema = z.object({
  channelId: z.string().uuid(),
  participants: z.array(VoiceParticipantSchema),
});

/**
 * voice.speaking.updated — transient audio activity indicator.
 *
 * Emitted when a participant's speaking state transitions (silence ↔ speaking).
 * High-frequency; clients should NOT re-render the full participant list on receipt.
 * Update only a separate speaking-state set keyed by userId.
 */
export const VoiceSpeakingUpdatedEventDataSchema = z.object({
  channelId: z.string().uuid(),
  isSpeaking: z.boolean(),
  userId: z.string().uuid(),
});

/**
 * voice.network.updated — per-user network quality snapshot for a voice channel.
 *
 * Broadcast to voice participants when gateway RTT/loss or user self-reported
 * media loss changes.
 */
export const VoiceNetworkParticipantSchema = z.object({
  gatewayLossPct: z.number().min(0).max(100).nullable(),
  gatewayRttMs: z.number().int().min(0).nullable(),
  mediaSelfLossPct: z.number().min(0).max(100).nullable(),
  stale: z.boolean(),
  updatedAt: z.string().datetime(),
  userId: z.string().uuid(),
});

export const VoiceNetworkUpdatedEventDataSchema = z.object({
  channelId: z.string().uuid(),
  participants: z.array(VoiceNetworkParticipantSchema),
});

// ── Voice commands ────────────────────────────────────────────────────────────

export const VoiceJoinCommandDataSchema = z.object({
  channelId: z.string().uuid(),
});

export const VoiceLeaveCommandDataSchema = z.object({
  channelId: z.string().uuid(),
});

/**
 * Sent by the client when local speaking state transitions.
 * Gateway broadcasts voice.member.updated to all room participants.
 */
export const VoiceSpeakingCommandDataSchema = z.object({
  channelId: z.string().uuid(),
  isMuted: z.boolean(),
  isSpeaking: z.boolean(),
});

/**
 * Client-side self report for local media packet-loss estimate.
 * Gateway validates membership and rebroadcasts as voice.network.updated.
 */
export const VoiceNetworkSelfReportCommandDataSchema = z.object({
  channelId: z.string().uuid(),
  mediaSelfLossPct: z.number().min(0).max(100),
});

// ── Voice ack payloads ────────────────────────────────────────────────────────

/**
 * Ack data returned when voice.join succeeds.
 * Contains the ICE server config, the assigned session ID, and a snapshot
 * of all participants already in the room (for the joining client to initiate
 * WebRTC offers).
 */
export const VoiceJoinAckDataSchema = z.object({
  channelId: z.string().uuid(),
  iceServers: z.array(IceServerSchema),
  participants: z.array(VoiceParticipantSchema),
  sessionId: z.string().uuid(),
});

/**
 * Ack data returned when voice.leave succeeds.
 */
export const VoiceLeaveAckDataSchema = z.object({
  channelId: z.string().uuid(),
});

// ── Command data schemas (M2 text chat) ──────────────────────────────────────

export const AuthenticateCommandDataSchema = z.object({
  accessToken: z.string().min(1),
});

export const ChannelSubscribeCommandDataSchema = z.object({
  channelId: z.string().uuid(),
});

export const ChannelUnsubscribeCommandDataSchema = z.object({
  channelId: z.string().uuid(),
});

// ── Type exports ──────────────────────────────────────────────────────────────

export type ConnectionState = z.infer<typeof ConnectionStateSchema>;
export type GatewayCommandName = z.infer<typeof GatewayCommandNameSchema>;
export type GatewayEventName = z.infer<typeof GatewayEventNameSchema>;
export type MessageCreatedEventData = z.infer<typeof MessageCreatedEventDataSchema>;
export type PresenceUpdatedEventData = z.infer<typeof PresenceUpdatedEventDataSchema>;
export type RoomRuntimeState = z.infer<typeof RoomRuntimeStateSchema>;
export type StreamStartAckData = z.infer<typeof StreamStartAckDataSchema>;
export type StreamStartCommandData = z.infer<typeof StreamStartCommandDataSchema>;
export type StreamPublication = z.infer<typeof StreamPublicationSchema>;
export type StreamQualitySettings = z.infer<typeof StreamQualitySettingsSchema>;
export type StreamBitrateKbps = z.infer<typeof StreamBitrateKbpsSchema>;
export type StreamFrameRate = z.infer<typeof StreamFrameRateSchema>;
export type StreamResolution = z.infer<typeof StreamResolutionSchema>;
export type StreamSession = z.infer<typeof StreamSessionSchema>;
export type StreamSourceType = z.infer<typeof StreamSourceTypeSchema>;
export type StreamStateUpdatedEventData = z.infer<typeof StreamStateUpdatedEventDataSchema>;
export type StreamStatus = z.infer<typeof StreamStatusSchema>;
export type StreamStopAckData = z.infer<typeof StreamStopAckDataSchema>;
export type StreamStopCommandData = z.infer<typeof StreamStopCommandDataSchema>;
export type StreamUnwatchAckData = z.infer<typeof StreamUnwatchAckDataSchema>;
export type StreamUnwatchCommandData = z.infer<typeof StreamUnwatchCommandDataSchema>;
export type StreamViewer = z.infer<typeof StreamViewerSchema>;
export type StreamViewerJoinedEventData = z.infer<typeof StreamViewerJoinedEventDataSchema>;
export type StreamViewerLeftEventData = z.infer<typeof StreamViewerLeftEventDataSchema>;
export type StreamWatchAckData = z.infer<typeof StreamWatchAckDataSchema>;
export type StreamWatchCommandData = z.infer<typeof StreamWatchCommandDataSchema>;
export type StreamSessionUpdatedEventData = z.infer<typeof StreamSessionUpdatedEventDataSchema>;
export type VoiceJoinAckData = z.infer<typeof VoiceJoinAckDataSchema>;
export type VoiceLeaveAckData = z.infer<typeof VoiceLeaveAckDataSchema>;
export type VoiceMemberUpdatedEventData = z.infer<typeof VoiceMemberUpdatedEventDataSchema>;
export type VoiceNetworkParticipant = z.infer<typeof VoiceNetworkParticipantSchema>;
export type VoiceNetworkUpdatedEventData = z.infer<typeof VoiceNetworkUpdatedEventDataSchema>;
export type VoiceParticipant = z.infer<typeof VoiceParticipantSchema>;
export type VoiceRosterUpdatedEventData = z.infer<typeof VoiceRosterUpdatedEventDataSchema>;
export type VoiceNetworkSelfReportCommandData = z.infer<typeof VoiceNetworkSelfReportCommandDataSchema>;
export type VoiceSpeakingUpdatedEventData = z.infer<typeof VoiceSpeakingUpdatedEventDataSchema>;
export type VoiceStateUpdatedEventData = z.infer<typeof VoiceStateUpdatedEventDataSchema>;
