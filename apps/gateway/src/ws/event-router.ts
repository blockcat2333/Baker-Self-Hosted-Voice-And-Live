/**
 * Event router for the gateway WebSocket handler.
 *
 * Routing layer only — no business logic lives here. All authentication and
 * authorization decisions are delegated to GatewayRuntime and the DB.
 *
 * Auth flow:
 *   1. Any connection may send ping/pong (heartbeat) without auth.
 *   2. An unauthenticated connection must send system.authenticate first.
 *   3. All other commands require the connection to be authenticated.
 *      Sending them before auth results in UNAUTHORIZED + socket close.
 *
 * channel.subscribe authorization:
 *   - Resolves the channel by channelId.
 *   - Rejects voice channels with CHANNEL_NOT_TEXT (text-only subscription).
 *   - Verifies the authenticated user is a guild member.
 *   - Only then adds the subscription.
 *
 * voice.join:
 *   - Resolves the channel and validates it is type='voice'.
 *   - Validates guild membership.
 *   - Enforces one session per userId (VOICE_ALREADY_JOINED).
 *   - Calls apps/media to create a media session and obtain ICE server config.
 *   - Adds to VoiceRoomManager; broadcasts voice.state.updated to room.
 *
 * media.signal.* relay:
 *   - Validates targetUserId is in the same voice room.
 *   - Relays the signal as a media.signal event to the target connection.
 */

import { randomUUID } from 'node:crypto';

import {
  AuthenticateCommandDataSchema,
  ChannelSubscribeCommandDataSchema,
  ChannelUnsubscribeCommandDataSchema,
  GatewayCommandEnvelopeSchema,
  GatewayHeartbeatEnvelopeSchema,
  MediaSignalCommandDataSchema,
  StreamStartAckDataSchema,
  StreamStartCommandDataSchema,
  StreamStopAckDataSchema,
  StreamStopCommandDataSchema,
  StreamUnwatchAckDataSchema,
  StreamUnwatchCommandDataSchema,
  StreamWatchAckDataSchema,
  StreamWatchCommandDataSchema,
  VoiceJoinAckDataSchema,
  VoiceJoinCommandDataSchema,
  VoiceLeaveAckDataSchema,
  VoiceLeaveCommandDataSchema,
  VoiceNetworkSelfReportCommandDataSchema,
  VoiceSpeakingCommandDataSchema,
  createAckEnvelope,
  createErrorEnvelope,
  createEventEnvelope,
  createHeartbeatEnvelope,
} from '@baker/protocol';

import { createLogger } from '@baker/shared';

import type { GatewayRuntime } from '../app-runtime';
import type { GatewayConnection } from './connection-manager';

const log = createLogger('gateway:router');

function getVoiceConnectionIds(runtime: GatewayRuntime, channelId: string): string[] {
  return runtime.voiceRoom
    .getParticipants(channelId)
    .map((participant) => participant.connectionId);
}

function resolveTargetPublication(
  runtime: GatewayRuntime,
  channelId: string,
  streamId?: string,
) {
  if (streamId) {
    return runtime.streamRoom.getPublication(channelId, streamId);
  }

  const publications = runtime.streamRoom.getPublications(channelId);
  if (publications.length === 1) {
    return publications[0] ?? null;
  }

  return null;
}

type RouterReply =
  | ReturnType<typeof createAckEnvelope>
  | ReturnType<typeof createErrorEnvelope>
  | ReturnType<typeof createHeartbeatEnvelope>;

export async function routeGatewayMessage(
  connection: GatewayConnection,
  rawMessage: string,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  let payload: unknown;

  try {
    payload = JSON.parse(rawMessage);
  } catch {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'Incoming WebSocket payload is not valid JSON.',
      retryable: false,
    });
  }

  // Heartbeat: always allowed regardless of auth state.
  const heartbeat = GatewayHeartbeatEnvelopeSchema.safeParse(payload);
  if (heartbeat.success && heartbeat.data.op === 'ping') {
    return createHeartbeatEnvelope('pong');
  }

  // Parse as command envelope.
  const command = GatewayCommandEnvelopeSchema.safeParse(payload);
  if (!command.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'Message is not a valid command envelope.',
      retryable: false,
    });
  }

  const { command: cmd, reqId, data } = command.data;

  // system.authenticate is allowed before auth; all others require auth.
  if (cmd !== 'system.authenticate' && !connection.userId) {
    connection.socket.close();
    return createErrorEnvelope({
      code: 'UNAUTHORIZED',
      message: 'You must authenticate before sending commands.',
      reqId,
      retryable: false,
    });
  }

  switch (cmd) {
    case 'system.authenticate':
      return handleAuthenticate(connection, reqId, data, runtime);

    case 'channel.subscribe':
      return handleChannelSubscribe(connection, reqId, data, runtime);

    case 'channel.unsubscribe':
      return handleChannelUnsubscribe(connection, reqId, data);

    case 'voice.join':
      return handleVoiceJoin(connection, reqId, data, runtime);

    case 'voice.leave':
      return handleVoiceLeave(connection, reqId, data, runtime);

    case 'voice.network.self_report':
      return handleVoiceNetworkSelfReport(connection, reqId, data, runtime);

    case 'voice.speaking.updated':
      return handleVoiceSpeaking(connection, reqId, data, runtime);

    case 'stream.start':
      return handleStreamStart(connection, reqId, data, runtime);

    case 'stream.stop':
      return handleStreamStop(connection, reqId, data, runtime);

    case 'stream.watch':
      return handleStreamWatch(connection, reqId, data, runtime);

    case 'stream.unwatch':
      return handleStreamUnwatch(connection, reqId, data, runtime);

    case 'media.signal.offer':
    case 'media.signal.answer':
    case 'media.signal.ice_candidate':
    case 'media.signal.restart_ice':
    case 'media.signal.end':
      return handleMediaSignalRelay(connection, reqId, data, runtime);

    default:
      // All other recognised command names are acked without action for now.
      return createAckEnvelope(reqId, { command: cmd, connectionId: connection.id });
  }
}

// ── system.authenticate ───────────────────────────────────────────────────────

async function handleAuthenticate(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = AuthenticateCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'system.authenticate requires { accessToken: string }.',
      reqId,
      retryable: false,
    });
  }

  const result = await runtime.tokenVerifier(parsed.data.accessToken);

  if (!result.ok) {
    connection.socket.close();
    return createErrorEnvelope({
      code: result.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      message: result.code === 'TOKEN_EXPIRED' ? 'Access token has expired.' : 'Access token is invalid.',
      reqId,
      retryable: result.code === 'TOKEN_EXPIRED',
    });
  }

  const { userId, sessionId } = result.value;
  const session = await runtime.db.authSessions.findById(sessionId);
  if (!session || session.revokedAt || session.userId !== userId) {
    connection.socket.close();
    return createErrorEnvelope({
      code: 'TOKEN_INVALID',
      message: 'Access token session is no longer active.',
      reqId,
      retryable: false,
    });
  }

  // Resolve display name for presence events. Failure is non-fatal.
  let username: string | null = null;
  try {
    const user = await runtime.db.users.findById(userId);
    username = user?.username ?? null;
  } catch (err) {
    log.warn({ err, userId }, 'Failed to resolve username at auth time – presence will show null');
  }

  let guildIds: string[] = [];
  try {
    guildIds = (await runtime.db.guilds.listForUser(userId)).map((guild) => guild.id);
  } catch (err) {
    log.warn({ err, userId }, 'Failed to resolve guild visibility at auth time – voice roster fanout will be partial');
  }

  runtime.connections.markAuthenticated(connection.id, userId, sessionId, username, guildIds);

  // Push full presence roster to this connection before broadcasting our own join.
  await runtime.presence.sendSnapshotTo(connection);
  await runtime.sendVoiceRosterSnapshotToConnection(connection);

  void runtime.presence.onConnect(userId, username);

  log.info({ connectionId: connection.id, userId }, 'Connection authenticated');

  return createAckEnvelope(reqId, { connectionId: connection.id, userId });
}

// ── channel.subscribe ─────────────────────────────────────────────────────────

async function handleChannelSubscribe(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = ChannelSubscribeCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'channel.subscribe requires { channelId: string (uuid) }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId } = parsed.data;
  const userId = connection.userId as string;

  const channel = await runtime.db.channels.findById(channelId);
  if (!channel) {
    return createErrorEnvelope({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found.', reqId, retryable: false });
  }

  // Voice channels must be joined via voice.join, not channel.subscribe.
  if (channel.type === 'voice') {
    return createErrorEnvelope({
      code: 'CHANNEL_NOT_TEXT',
      message: 'Use voice.join to enter a voice channel.',
      reqId,
      retryable: false,
    });
  }

  const membership = await runtime.db.guildMembers.findMembership(channel.guildId, userId);
  if (!membership) {
    return createErrorEnvelope({
      code: 'FORBIDDEN',
      message: 'You are not a member of the guild that owns this channel.',
      reqId,
      retryable: false,
    });
  }

  connection.subscriptions.add(channelId);
  log.info({ connectionId: connection.id, userId, channelId }, 'Subscribed to channel');

  return createAckEnvelope(reqId, { channelId, subscribed: true });
}

// ── channel.unsubscribe ───────────────────────────────────────────────────────

function handleChannelUnsubscribe(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
): RouterReply {
  const parsed = ChannelUnsubscribeCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'channel.unsubscribe requires { channelId: string (uuid) }.',
      reqId,
      retryable: false,
    });
  }

  connection.subscriptions.delete(parsed.data.channelId);
  return createAckEnvelope(reqId, { channelId: parsed.data.channelId, subscribed: false });
}

// ── voice.join ────────────────────────────────────────────────────────────────

async function handleVoiceJoin(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = VoiceJoinCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'voice.join requires { channelId: string (uuid) }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId } = parsed.data;
  const userId = connection.userId as string;

  // Resolve channel and verify it is a voice channel.
  const channel = await runtime.db.channels.findById(channelId);
  if (!channel) {
    return createErrorEnvelope({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found.', reqId, retryable: false });
  }
  if (channel.type !== 'voice') {
    return createErrorEnvelope({
      code: 'CHANNEL_NOT_TEXT',
      message: 'This channel is not a voice channel.',
      reqId,
      retryable: false,
    });
  }

  // Verify guild membership.
  const membership = await runtime.db.guildMembers.findMembership(channel.guildId, userId);
  if (!membership) {
    return createErrorEnvelope({
      code: 'FORBIDDEN',
      message: 'You are not a member of the guild that owns this channel.',
      reqId,
      retryable: false,
    });
  }

  // Create media session to get sessionId + ICE servers.
  // Use a temporary sessionId for the media call; the real UUID comes back from media.
  let mediaSession: { iceServers: unknown[]; sessionId: string };
  try {
    mediaSession = await runtime.createMediaSession({
      channelId,
      mode: 'voice',
      sessionId: randomUUID(),
      userId,
    });
  } catch (err) {
    log.warn({ err, channelId, userId }, 'Media session create failed');
    return createErrorEnvelope({
      code: 'MEDIA_NEGOTIATION_TIMEOUT',
      message: 'Failed to create media session. Try again.',
      reqId,
      retryable: true,
    });
  }

  // Add to voice room. Returns null if already joined.
  const snapshot = runtime.voiceRoom.join(channelId, userId, connection.id, mediaSession.sessionId);
  if (snapshot === null) {
    return createErrorEnvelope({
      code: 'VOICE_ALREADY_JOINED',
      message: 'You are already in this voice channel.',
      reqId,
      retryable: false,
    });
  }

  // Track voice channel on the connection for clean disconnect.
  connection.voiceChannelId = channelId;

  // Broadcast full snapshot to all participants (including the new one).
  runtime.voiceRoom.broadcastStateUpdated(channelId, snapshot);
  await runtime.broadcastVoiceRosterUpdated(channelId);
  await runtime.broadcastVoiceNetworkUpdated(channelId);
  if (runtime.streamRoom.getPublications(channelId).length > 0) {
    runtime.streamRoom.broadcastStateUpdated(channelId, [connection.id]);
  }

  log.info({ connectionId: connection.id, userId, channelId, sessionId: mediaSession.sessionId }, 'User joined voice channel');

  // Ack contains participants EXCLUDING self (they are in the snapshot but the
  // client needs them to initiate offers). Include all — client skips self by userId.
  const ackData = VoiceJoinAckDataSchema.parse({
    channelId,
    iceServers: mediaSession.iceServers,
    participants: snapshot.map((p) => ({ isMuted: p.isMuted, sessionId: p.sessionId, userId: p.userId })),
    sessionId: mediaSession.sessionId,
  });

  try {
    const servers = Array.isArray(mediaSession.iceServers) ? mediaSession.iceServers : [];
    const hasTurn = servers.some((server) => {
      if (!server || typeof server !== 'object') return false;
      const urls = 'urls' in server ? (server as { urls?: unknown }).urls : undefined;
      const urlList = Array.isArray(urls) ? urls : typeof urls === 'string' ? [urls] : [];
      return urlList.some((u) => typeof u === 'string' && u.startsWith('turn'));
    });
    log.info(
      { channelId, userId, sessionId: mediaSession.sessionId, iceServerCount: servers.length, hasTurn },
      'Voice ICE servers attached',
    );
  } catch {
    // ignore logging failures
  }

  return createAckEnvelope(reqId, ackData);
}

// ── voice.leave ───────────────────────────────────────────────────────────────

async function handleVoiceLeave(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = VoiceLeaveCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'voice.leave requires { channelId: string (uuid) }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId } = parsed.data;
  const userId = connection.userId as string;

  const remaining = runtime.voiceRoom.leave(channelId, userId);
  if (remaining === null) {
    return createErrorEnvelope({
      code: 'VOICE_NOT_JOINED',
      message: 'You are not in this voice channel.',
      reqId,
      retryable: false,
    });
  }

  connection.voiceChannelId = null;

  // Broadcast updated snapshot to remaining participants.
  if (remaining.length > 0) {
    runtime.voiceRoom.broadcastStateUpdated(channelId, remaining);
  }
  await runtime.broadcastVoiceRosterUpdated(channelId);
  await runtime.broadcastVoiceNetworkUpdated(channelId);

  const streamChanges = runtime.streamRoom.leaveChannelForUser(channelId, userId);
  for (const change of streamChanges) {
    const voiceConnectionIds = getVoiceConnectionIds(runtime, change.channelId);
    if (change.type === 'host_stopped') {
      runtime.streamRoom.broadcastStateCleared(change.channelId, [
        ...change.connectionIds,
        ...voiceConnectionIds,
      ]);
      await runtime.db.streamSessions.updateStatus(change.sessionId, 'idle', { endedAt: new Date() });
      continue;
    }

    runtime.streamRoom.broadcastStateUpdated(change.channelId, voiceConnectionIds);
  }

  log.info({ connectionId: connection.id, userId, channelId }, 'User left voice channel');

  return createAckEnvelope(reqId, VoiceLeaveAckDataSchema.parse({ channelId }));
}

async function handleVoiceNetworkSelfReport(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = VoiceNetworkSelfReportCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'voice.network.self_report requires { channelId, mediaSelfLossPct }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId, mediaSelfLossPct } = parsed.data;
  const userId = connection.userId as string;

  if (connection.voiceChannelId !== channelId) {
    return createErrorEnvelope({
      code: 'VOICE_NOT_JOINED',
      message: 'You are not in this voice channel.',
      reqId,
      retryable: false,
    });
  }

  const participant = runtime.voiceRoom.getParticipant(channelId, userId);
  if (!participant || participant.connectionId !== connection.id) {
    return createErrorEnvelope({
      code: 'VOICE_NOT_JOINED',
      message: 'You are not in this voice channel.',
      reqId,
      retryable: false,
    });
  }

  await runtime.updateVoiceMediaSelfLoss(connection.id, channelId, mediaSelfLossPct);

  return createAckEnvelope(reqId, { accepted: true, channelId });
}

// ── voice.speaking.updated ────────────────────────────────────────────────────

async function handleVoiceSpeaking(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = VoiceSpeakingCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'voice.speaking.updated requires { channelId, isSpeaking, isMuted }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId, isSpeaking, isMuted } = parsed.data;
  const userId = connection.userId as string;

  // Update mute state if it changed; broadcast voice.member.updated.
  const updatedRecord = runtime.voiceRoom.setMuted(channelId, userId, isMuted);
  if (updatedRecord) {
    runtime.voiceRoom.broadcastMemberUpdated(channelId, updatedRecord);
    await runtime.broadcastVoiceRosterUpdated(channelId);
    await runtime.broadcastVoiceNetworkUpdated(channelId);
  }

  // Broadcast speaking activity to all other participants.
  runtime.voiceRoom.broadcastSpeakingUpdated(channelId, userId, isSpeaking, connection.id);

  return createAckEnvelope(reqId, { channelId, isSpeaking });
}

// ── media.signal.* relay ──────────────────────────────────────────────────────

async function handleStreamStart(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = StreamStartCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'stream.start requires { channelId, sourceType, quality? }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId, quality, sourceType } = parsed.data;
  const userId = connection.userId as string;

  const channel = await runtime.db.channels.findById(channelId);
  if (!channel) {
    return createErrorEnvelope({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found.', reqId, retryable: false });
  }
  if (channel.type !== 'voice') {
    return createErrorEnvelope({
      code: 'CHANNEL_NOT_TEXT',
      message: 'Streaming is only supported in voice channels.',
      reqId,
      retryable: false,
    });
  }

  const membership = await runtime.db.guildMembers.findMembership(channel.guildId, userId);
  if (!membership) {
    return createErrorEnvelope({
      code: 'FORBIDDEN',
      message: 'You are not a member of the guild that owns this channel.',
      reqId,
      retryable: false,
    });
  }

  if (runtime.streamRoom.findHostedPublicationByUser(userId, channelId)) {
    return createErrorEnvelope({
      code: 'STREAM_ALREADY_LIVE',
      message: 'You already have an active stream in this voice channel.',
      reqId,
      retryable: false,
    });
  }

  const streamId = randomUUID();

  let mediaSession: { iceServers: unknown[]; sessionId: string };
  try {
    mediaSession = await runtime.createMediaSession({
      channelId,
      mode: 'stream_publish',
      sessionId: randomUUID(),
      streamId,
      userId,
    });
  } catch (err) {
    log.warn({ err, channelId, userId }, 'Stream media session create failed');
    return createErrorEnvelope({
      code: 'MEDIA_NEGOTIATION_TIMEOUT',
      message: 'Failed to create stream session. Try again.',
      reqId,
      retryable: true,
    });
  }

  const started = runtime.streamRoom.start(
    channelId,
    streamId,
    userId,
    connection.id,
    mediaSession.sessionId,
    sourceType,
  );
  if (!started) {
    return createErrorEnvelope({
      code: 'STREAM_ALREADY_LIVE',
      message: 'You already have an active stream in this voice channel.',
      reqId,
      retryable: false,
    });
  }

  try {
    await runtime.db.streamSessions.create({
      channelId,
      hostUserId: userId,
      id: mediaSession.sessionId,
      metadata: quality ? { quality } : {},
      sourceType,
    });
    await runtime.db.streamSessions.updateStatus(mediaSession.sessionId, 'live', { startedAt: new Date() });
  } catch (err) {
    const stopped = runtime.streamRoom.stop(channelId, streamId, userId);
    if (stopped) {
      runtime.streamRoom.broadcastStateCleared(channelId, [
        ...stopped.connectionIds,
        ...getVoiceConnectionIds(runtime, channelId),
      ]);
    }
    log.error({ err, channelId, userId }, 'Failed to persist stream session');
    return createErrorEnvelope({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to start stream session.',
      reqId,
      retryable: true,
    });
  }

  runtime.streamRoom.broadcastStateUpdated(channelId, getVoiceConnectionIds(runtime, channelId));

  return createAckEnvelope(reqId, StreamStartAckDataSchema.parse({
    channelId,
    iceServers: mediaSession.iceServers,
    sessionId: mediaSession.sessionId,
    streamId,
  }));
}

async function handleStreamStop(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = StreamStopCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'stream.stop requires { channelId: string (uuid), streamId?: string (uuid) }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId, streamId } = parsed.data;
  const userId = connection.userId as string;
  const publication = streamId
    ? runtime.streamRoom.getPublication(channelId, streamId)
    : runtime.streamRoom.findHostedPublicationByUser(userId, channelId);

  if (!publication) {
    return createErrorEnvelope({
      code: streamId ? 'STREAM_NOT_FOUND' : 'STREAM_NOT_HOST',
      message: streamId
        ? 'Stream not found in this channel.'
        : 'You do not have an active stream in this channel.',
      reqId,
      retryable: false,
    });
  }

  if (publication.host.userId !== userId) {
    return createErrorEnvelope({
      code: 'STREAM_NOT_HOST',
      message: 'Only the active host can stop this stream.',
      reqId,
      retryable: false,
    });
  }

  const stopped = runtime.streamRoom.stop(channelId, publication.streamId, userId);
  if (!stopped) {
    return createErrorEnvelope({
      code: 'STREAM_NOT_FOUND',
      message: 'Stream not found in this channel.',
      reqId,
      retryable: false,
    });
  }

  await runtime.db.streamSessions.updateStatus(stopped.sessionId, 'idle', { endedAt: new Date() });
  runtime.streamRoom.broadcastStateCleared(channelId, [
    ...stopped.connectionIds,
    ...getVoiceConnectionIds(runtime, channelId),
  ]);

  return createAckEnvelope(reqId, StreamStopAckDataSchema.parse({ channelId, streamId: stopped.streamId }));
}

async function handleStreamWatch(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): Promise<RouterReply> {
  const parsed = StreamWatchCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'stream.watch requires { channelId: string (uuid), streamId?: string (uuid) }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId, streamId } = parsed.data;
  const userId = connection.userId as string;

  const channel = await runtime.db.channels.findById(channelId);
  if (!channel) {
    return createErrorEnvelope({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found.', reqId, retryable: false });
  }
  if (channel.type !== 'voice') {
    return createErrorEnvelope({
      code: 'CHANNEL_NOT_TEXT',
      message: 'Streaming is only supported in voice channels.',
      reqId,
      retryable: false,
    });
  }

  const membership = await runtime.db.guildMembers.findMembership(channel.guildId, userId);
  if (!membership) {
    return createErrorEnvelope({
      code: 'FORBIDDEN',
      message: 'You are not a member of the guild that owns this channel.',
      reqId,
      retryable: false,
    });
  }

  const publications = runtime.streamRoom.getPublications(channelId);
  if (publications.length === 0) {
    return createErrorEnvelope({
      code: 'STREAM_NOT_LIVE',
      message: 'No active stream exists in this channel.',
      reqId,
      retryable: false,
    });
  }

  if (!streamId && publications.length > 1) {
    return createErrorEnvelope({
      code: 'STREAM_NOT_FOUND',
      message: 'stream.watch requires streamId when multiple streams are live in this channel.',
      reqId,
      retryable: false,
    });
  }

  const publication = resolveTargetPublication(runtime, channelId, streamId);
  if (!publication) {
    return createErrorEnvelope({
      code: 'STREAM_NOT_FOUND',
      message: 'Stream not found in this channel.',
      reqId,
      retryable: false,
    });
  }

  if (publication.host.userId === userId) {
    return createErrorEnvelope({
      code: 'STREAM_ALREADY_WATCHING',
      message: 'You cannot watch your own stream.',
      reqId,
      retryable: false,
    });
  }

  const existingViewer = runtime.streamRoom.getViewer(channelId, publication.streamId, userId);
  if (existingViewer) {
    return createAckEnvelope(reqId, StreamWatchAckDataSchema.parse({
      channelId,
      hostSessionId: publication.host.sessionId,
      hostUserId: publication.host.userId,
      iceServers: [],
      sessionId: existingViewer.sessionId,
      streamId: publication.streamId,
    }));
  }

  let mediaSession: { iceServers: unknown[]; sessionId: string };
  try {
    mediaSession = await runtime.createMediaSession({
      channelId,
      mode: 'stream_watch',
      sessionId: randomUUID(),
      streamId: publication.streamId,
      userId,
    });
  } catch (err) {
    log.warn({ err, channelId, userId }, 'Stream watch media session create failed');
    return createErrorEnvelope({
      code: 'MEDIA_NEGOTIATION_TIMEOUT',
      message: 'Failed to join stream watch session. Try again.',
      reqId,
      retryable: true,
    });
  }

  const watch = runtime.streamRoom.addViewer(
    channelId,
    publication.streamId,
    userId,
    connection.id,
    mediaSession.sessionId,
  );
  if (!watch) {
    return createErrorEnvelope({
      code: 'STREAM_NOT_FOUND',
      message: 'Stream not found in this channel.',
      reqId,
      retryable: false,
    });
  }

  runtime.streamRoom.broadcastStateUpdated(channelId, getVoiceConnectionIds(runtime, channelId));

  return createAckEnvelope(reqId, StreamWatchAckDataSchema.parse({
    channelId,
    hostSessionId: watch.publication.host.sessionId,
    hostUserId: watch.publication.host.userId,
    iceServers: mediaSession.iceServers,
    sessionId: watch.viewerSessionId,
    streamId: watch.publication.streamId,
  }));
}

function handleStreamUnwatch(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): RouterReply {
  const parsed = StreamUnwatchCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'stream.unwatch requires { channelId: string (uuid), streamId?: string (uuid) }.',
      reqId,
      retryable: false,
    });
  }

  const { channelId, streamId } = parsed.data;
  const userId = connection.userId as string;
  let targetStreamId = streamId;

  if (!targetStreamId) {
    const watchedPublications = runtime.streamRoom.findWatchedPublicationsByUser(userId, channelId);
    if (watchedPublications.length > 1) {
      return createErrorEnvelope({
        code: 'STREAM_NOT_FOUND',
        message: 'stream.unwatch requires streamId when watching multiple streams in this channel.',
        reqId,
        retryable: false,
      });
    }

    targetStreamId = watchedPublications[0]?.streamId;
  }

  const removed = targetStreamId
    ? runtime.streamRoom.removeViewer(channelId, targetStreamId, userId)
    : false;

  if (removed) {
    runtime.streamRoom.broadcastStateUpdated(channelId, getVoiceConnectionIds(runtime, channelId));
  }

  return createAckEnvelope(reqId, StreamUnwatchAckDataSchema.parse({ channelId, streamId: targetStreamId }));
}

function handleMediaSignalRelay(
  connection: GatewayConnection,
  reqId: string,
  data: unknown,
  runtime: GatewayRuntime,
): RouterReply {
  const parsed = MediaSignalCommandDataSchema.safeParse(data);
  if (!parsed.success) {
    return createErrorEnvelope({
      code: 'INVALID_PAYLOAD',
      message: 'media.signal.* requires { targetUserId, signal }.',
      reqId,
      retryable: false,
    });
  }

  const { targetUserId, signal } = parsed.data;
  const fromUserId = connection.userId as string;
  if (signal.session.userId !== fromUserId) {
    return createErrorEnvelope({
      code: 'FORBIDDEN',
      message: 'Signal session user does not match the authenticated connection.',
      reqId,
      retryable: false,
    });
  }

  // Locate the target connection via the O(1) userId index.
  const targetConn = runtime.connections.findByUserId(targetUserId);
  if (!targetConn) {
    return createErrorEnvelope({
      code: signal.session.mode === 'voice' ? 'VOICE_NOT_JOINED' : 'STREAM_NOT_LIVE',
      message: 'Target user is not connected.',
      reqId,
      retryable: false,
    });
  }

  if (signal.session.mode === 'voice') {
    const sender = runtime.voiceRoom.getParticipant(signal.session.channelId, fromUserId);
    const target = runtime.voiceRoom.getParticipant(signal.session.channelId, targetUserId);

    if (!sender || !target || sender.sessionId !== signal.session.sessionId) {
      return createErrorEnvelope({
        code: 'VOICE_NOT_JOINED',
        message: 'Voice signaling is only allowed for participants in the same active voice session.',
        reqId,
        retryable: false,
      });
    }
  } else if (!runtime.streamRoom.canRelaySignal(
    signal.session.channelId,
    signal.session.streamId,
    signal.session.mode,
    fromUserId,
    signal.session.sessionId,
    targetUserId,
  )) {
    return createErrorEnvelope({
      code: 'STREAM_NOT_LIVE',
      message: 'Stream signaling is only allowed for the active host/viewer session.',
      reqId,
      retryable: false,
    });
  }

  // Relay the signal as a single media.signal event to the target.
  try {
    const relayData = { fromUserId, signal };
    const envelope = createEventEnvelope(targetConn.nextSequence(), 'media.signal', relayData);
    targetConn.socket.send(JSON.stringify(envelope));
  } catch (err) {
    log.warn({ err, fromUserId, targetUserId }, 'Failed to relay media signal');
  }

  return createAckEnvelope(reqId, { relayed: true, targetUserId });
}
