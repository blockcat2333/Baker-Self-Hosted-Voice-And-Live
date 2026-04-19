import { describe, expect, it, vi } from 'vitest';

import type { DatabaseAccess } from '@baker/db';

import type { GatewayRuntime } from '../app-runtime';
import type { TokenVerifier } from '../lib/token-verifier';
import { ConnectionManager } from './connection-manager';
import { routeGatewayMessage } from './event-router';
import { PresenceManager } from './presence-manager';
import { StreamRoomManager } from './stream-room-manager';
import { VoiceRoomManager } from './voice-room-manager';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<{ userId: string | null }> = {}) {
  const conn = new ConnectionManager().attach({
    close() {},
    send() {},
  });
  if (overrides.userId !== undefined) {
    conn.userId = overrides.userId;
  }
  return conn;
}

function parseSentEnvelopes(sendMock: ReturnType<typeof vi.fn>) {
  return sendMock.mock.calls.map(([payload]) => JSON.parse(payload as string));
}

function makeRuntime(overrides: Partial<GatewayRuntime> = {}): GatewayRuntime {
  const connections = new ConnectionManager();
  const tokenVerifier: TokenVerifier = async (_token) => ({ code: 'TOKEN_INVALID', ok: false });

  // Minimal db stub — only the methods the router actually calls.
  const db = {
    authSessions: {
      findById: async () => null,
    },
    channels: {
      findById: async () => null,
      findAccessibleById: async () => null,
      create: async () => { throw new Error('not used'); },
      listByGuildForUser: async () => [],
    },
    guildMembers: {
      findMembership: async () => null,
      add: async () => { throw new Error('not used'); },
    },
    guilds: {
      listForUser: async () => [],
    },
    streamSessions: {
      create: async () => { throw new Error('not used'); },
      findActiveByChannel: async () => null,
      findById: async () => null,
      updateStatus: async () => {},
    },
    users: {
      findById: async () => null,
    },
  } as unknown as DatabaseAccess;

  const presence = new PresenceManager(connections, null);

  const voiceRoom = new VoiceRoomManager(connections);
  const streamRoom = new StreamRoomManager(connections);

  return {
    connections,
    db,
    fanoutEnabled: false,
    presence,
    streamRoom,
    tokenVerifier,
    voiceRoom,
    broadcastVoiceNetworkUpdated: vi.fn().mockResolvedValue(undefined),
    broadcastVoiceRosterUpdated: vi.fn().mockResolvedValue(undefined),
    createMediaSession: vi.fn().mockResolvedValue({
      iceServers: [{ urls: 'stun:stun.example.com' }],
      sessionId: '00000000-0000-0000-0000-000000000099',
    }),
    updateVoiceMediaSelfLoss: vi.fn().mockResolvedValue(undefined),
    sendVoiceRosterSnapshotToConnection: vi.fn().mockResolvedValue(undefined),
    startFanout() {},
    ...overrides,
  } as unknown as GatewayRuntime;
}

const runtime = makeRuntime();

function ts() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('routeGatewayMessage', () => {
  it('responds with pong for ping', async () => {
    const conn = makeConnection();
    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({ op: 'ping', ts: ts(), v: 1 }),
      runtime,
    );
    expect(reply.op).toBe('pong');
  });

  it('returns INVALID_PAYLOAD for non-JSON', async () => {
    const conn = makeConnection();
    const reply = await routeGatewayMessage(conn, 'not json', runtime);
    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('INVALID_PAYLOAD');
  });

  it('returns INVALID_PAYLOAD when envelope is malformed', async () => {
    const conn = makeConnection();
    const reply = await routeGatewayMessage(conn, JSON.stringify({ op: 'unknown', v: 1 }), runtime);
    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('INVALID_PAYLOAD');
  });

  it('returns UNAUTHORIZED and closes socket when unauthenticated client sends a data command', async () => {
    const closed: boolean[] = [];
    const conn = makeConnection({ userId: null });
    conn.socket = { close() { closed.push(true); }, send() {} };

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'channel.subscribe',
        data: { channelId: '00000000-0000-0000-0000-000000000001' },
        op: 'command',
        reqId: 'req-unauth',
        ts: ts(),
        v: 1,
      }),
      runtime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('UNAUTHORIZED');
    expect(closed).toHaveLength(1);
  });

  it('returns TOKEN_INVALID and closes socket for system.authenticate with bad token', async () => {
    const closed: boolean[] = [];
    const conn = makeConnection({ userId: null });
    conn.socket = { close() { closed.push(true); }, send() {} };

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'system.authenticate',
        data: { accessToken: 'bad-token' },
        op: 'command',
        reqId: 'req-auth-bad',
        ts: ts(),
        v: 1,
      }),
      runtime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('TOKEN_INVALID');
    expect(closed).toHaveLength(1);
  });

  it('returns TOKEN_EXPIRED for system.authenticate when token is expired', async () => {
    const expiredTokenRuntime = makeRuntime({
      tokenVerifier: async () => ({ code: 'TOKEN_EXPIRED', ok: false }),
    });
    const conn = makeConnection({ userId: null });
    conn.socket = { close() {}, send() {} };

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'system.authenticate',
        data: { accessToken: 'expired-token' },
        op: 'command',
        reqId: 'req-auth-expired',
        ts: ts(),
        v: 1,
      }),
      expiredTokenRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') {
      expect(reply.code).toBe('TOKEN_EXPIRED');
      expect(reply.retryable).toBe(true);
    }
  });

  it('acks system.authenticate with valid token and marks connection authenticated', async () => {
    const userId = '00000000-0000-0000-0000-000000000099';
    const sessionId = '00000000-0000-0000-0000-000000000098';

    // The runtime must use the same ConnectionManager so markAuthenticated can
    // find the connection by its ID.
    const sharedConnections = new ConnectionManager();
    const validTokenRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        authSessions: {
          findById: async (id: string) =>
            id === sessionId
              ? { createdAt: new Date(), id: sessionId, lastSeenAt: new Date(), revokedAt: null, userId }
              : null,
        },
        guilds: {
          listForUser: async () => [],
        },
        users: {
          findById: async () => null,
        },
      } as unknown as DatabaseAccess,
      tokenVerifier: async () => ({ ok: true, value: { userId, sessionId } }),
      presence: new PresenceManager(sharedConnections, null),
    });

    const conn = sharedConnections.attach({ close() {}, send() {} });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'system.authenticate',
        data: { accessToken: 'valid-token' },
        op: 'command',
        reqId: 'req-auth-ok',
        ts: ts(),
        v: 1,
      }),
      validTokenRuntime,
    );

    expect(reply.op).toBe('ack');
    expect(conn.userId).toBe(userId);
  });

  it('rejects system.authenticate when the referenced auth session is revoked', async () => {
    const userId = '00000000-0000-0000-0000-000000000199';
    const sessionId = '00000000-0000-0000-0000-000000000198';
    const sharedConnections = new ConnectionManager();
    const closed: boolean[] = [];

    const revokedSessionRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        authSessions: {
          findById: async () => ({
            createdAt: new Date(),
            id: sessionId,
            lastSeenAt: new Date(),
            revokedAt: new Date(),
            userId,
          }),
        },
        guilds: {
          listForUser: async () => [],
        },
        users: {
          findById: async () => null,
        },
      } as unknown as DatabaseAccess,
      tokenVerifier: async () => ({ ok: true, value: { userId, sessionId } }),
      presence: new PresenceManager(sharedConnections, null),
    });

    const conn = sharedConnections.attach({
      close() {
        closed.push(true);
      },
      send() {},
    });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'system.authenticate',
        data: { accessToken: 'revoked-token' },
        op: 'command',
        reqId: 'req-auth-revoked',
        ts: ts(),
        v: 1,
      }),
      revokedSessionRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('TOKEN_INVALID');
    expect(closed).toHaveLength(1);
  });

  it('returns CHANNEL_NOT_FOUND for channel.subscribe on unknown channel', async () => {
    const conn = makeConnection({ userId: '00000000-0000-0000-0000-000000000001' });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'channel.subscribe',
        data: { channelId: '00000000-0000-0000-0000-000000000002' },
        op: 'command',
        reqId: 'req-sub-404',
        ts: ts(),
        v: 1,
      }),
      runtime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('CHANNEL_NOT_FOUND');
  });

  it('returns FORBIDDEN for channel.subscribe when user is not a guild member', async () => {
    const channelId = '00000000-0000-0000-0000-000000000010';
    const guildId = '00000000-0000-0000-0000-000000000011';
    const membershipRuntime = makeRuntime({
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'general', type: 'text', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async () => null,
        },
      } as unknown as DatabaseAccess,
    });

    const conn = makeConnection({ userId: '00000000-0000-0000-0000-000000000099' });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'channel.subscribe',
        data: { channelId },
        op: 'command',
        reqId: 'req-sub-forbidden',
        ts: ts(),
        v: 1,
      }),
      membershipRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('FORBIDDEN');
  });

  it('acks channel.subscribe and adds channelId to subscriptions when membership is valid', async () => {
    const channelId = '00000000-0000-0000-0000-000000000020';
    const guildId = '00000000-0000-0000-0000-000000000021';
    const userId = '00000000-0000-0000-0000-000000000022';

    const membershipRuntime = makeRuntime({
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'general', type: 'text', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === userId
              ? { guildId, userId, joinedAt: new Date(), nickname: null }
              : null,
        },
      } as unknown as DatabaseAccess,
    });

    const conn = makeConnection({ userId });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'channel.subscribe',
        data: { channelId },
        op: 'command',
        reqId: 'req-sub-ok',
        ts: ts(),
        v: 1,
      }),
      membershipRuntime,
    );

    expect(reply.op).toBe('ack');
    expect(conn.subscriptions.has(channelId)).toBe(true);
  });

  it('acks channel.unsubscribe and removes channelId from subscriptions', async () => {
    const channelId = '00000000-0000-0000-0000-000000000030';
    const conn = makeConnection({ userId: '00000000-0000-0000-0000-000000000031' });
    conn.subscriptions.add(channelId);

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'channel.unsubscribe',
        data: { channelId },
        op: 'command',
        reqId: 'req-unsub',
        ts: ts(),
        v: 1,
      }),
      runtime,
    );

    expect(reply.op).toBe('ack');
    expect(conn.subscriptions.has(channelId)).toBe(false);
  });

  it('acks unimplemented commands for authenticated connections', async () => {
    const conn = makeConnection({ userId: '00000000-0000-0000-0000-000000000040' });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'presence.subscribe',
        data: {},
        op: 'command',
        reqId: 'req-presence',
        ts: ts(),
        v: 1,
      }),
      runtime,
    );

    expect(reply.op).toBe('ack');
  });

  // ── channel.subscribe voice-channel guard ──────────────────────────────────

  it('returns CHANNEL_NOT_TEXT for channel.subscribe on a voice channel', async () => {
    const channelId = '00000000-0000-0000-0000-000000000050';
    const guildId = '00000000-0000-0000-0000-000000000051';

    const voiceChannelRuntime = makeRuntime({
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: { findMembership: async () => null },
      } as unknown as DatabaseAccess,
    });

    const conn = makeConnection({ userId: '00000000-0000-0000-0000-000000000052' });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'channel.subscribe',
        data: { channelId },
        op: 'command',
        reqId: 'req-sub-voice',
        ts: ts(),
        v: 1,
      }),
      voiceChannelRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('CHANNEL_NOT_TEXT');
  });

  // ── voice.join ─────────────────────────────────────────────────────────────

  it('returns CHANNEL_NOT_FOUND for voice.join on unknown channel', async () => {
    const conn = makeConnection({ userId: '00000000-0000-0000-0000-000000000060' });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId: '00000000-0000-0000-0000-000000000061' },
        op: 'command',
        reqId: 'req-vj-404',
        ts: ts(),
        v: 1,
      }),
      runtime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('CHANNEL_NOT_FOUND');
  });

  it('returns FORBIDDEN for voice.join when user is not a guild member', async () => {
    const channelId = '00000000-0000-0000-0000-000000000070';
    const guildId = '00000000-0000-0000-0000-000000000071';

    const notMemberRuntime = makeRuntime({
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: { findMembership: async () => null },
      } as unknown as DatabaseAccess,
    });

    const conn = makeConnection({ userId: '00000000-0000-0000-0000-000000000072' });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId },
        op: 'command',
        reqId: 'req-vj-forbidden',
        ts: ts(),
        v: 1,
      }),
      notMemberRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('FORBIDDEN');
  });

  it('acks voice.join successfully and tracks voiceChannelId on connection', async () => {
    const channelId = '00000000-0000-0000-0000-000000000080';
    const guildId = '00000000-0000-0000-0000-000000000081';
    const userId = '00000000-0000-0000-0000-000000000082';

    const sharedConnections = new ConnectionManager();
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === userId
              ? { guildId, userId, joinedAt: new Date(), nickname: null }
              : null,
        },
      } as unknown as DatabaseAccess,
      voiceRoom: new VoiceRoomManager(sharedConnections),
      presence: new PresenceManager(sharedConnections, null),
    });

    const conn = sharedConnections.attach({ close() {}, send() {} });
    conn.userId = userId;

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId },
        op: 'command',
        reqId: 'req-vj-ok',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(reply.op).toBe('ack');
    expect(conn.voiceChannelId).toBe(channelId);
  });

  it('returns VOICE_ALREADY_JOINED when user tries to join the same voice channel twice', async () => {
    const channelId = '00000000-0000-0000-0000-000000000090';
    const guildId = '00000000-0000-0000-0000-000000000091';
    const userId = '00000000-0000-0000-0000-000000000092';

    const sharedConnections = new ConnectionManager();
    const voiceRoom = new VoiceRoomManager(sharedConnections);
    const dupRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === userId
              ? { guildId, userId, joinedAt: new Date(), nickname: null }
              : null,
        },
      } as unknown as DatabaseAccess,
      voiceRoom,
      presence: new PresenceManager(sharedConnections, null),
    });

    const conn = sharedConnections.attach({ close() {}, send() {} });
    conn.userId = userId;

    const command = JSON.stringify({
      command: 'voice.join',
      data: { channelId },
      op: 'command',
      reqId: 'req-vj-dup',
      ts: ts(),
      v: 1,
    });

    // First join should succeed.
    const first = await routeGatewayMessage(conn, command, dupRuntime);
    expect(first.op).toBe('ack');

    // Second join should return VOICE_ALREADY_JOINED.
    const second = await routeGatewayMessage(conn, command, dupRuntime);
    expect(second.op).toBe('error');
    if (second.op === 'error') expect(second.code).toBe('VOICE_ALREADY_JOINED');
  });

  it('sends the current stream snapshot to a participant who joins voice after a stream is already live', async () => {
    const channelId = '00000000-0000-0000-0000-000000000094';
    const guildId = '00000000-0000-0000-0000-000000000095';
    const hostUserId = '00000000-0000-0000-0000-000000000096';
    const lateJoinerUserId = '00000000-0000-0000-0000-000000000097';

    const sharedConnections = new ConnectionManager();
    const hostSocket = { close() {}, send: vi.fn() };
    const lateJoinerSocket = { close() {}, send: vi.fn() };
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && [hostUserId, lateJoinerUserId].includes(uId)
              ? { guildId, userId: uId, joinedAt: new Date(), nickname: null }
              : null,
        },
        streamSessions: {
          create: async () => ({ channelId, endedAt: null, hostUserId, id: '00000000-0000-0000-0000-000000000098', metadata: {}, sourceType: 'screen', startedAt: null, status: 'starting' }),
          findActiveByChannel: async () => null,
          findById: async () => null,
          updateStatus: async () => {},
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom: new StreamRoomManager(sharedConnections),
      voiceRoom: new VoiceRoomManager(sharedConnections),
    });

    const hostConn = sharedConnections.attach(hostSocket);
    hostConn.userId = hostUserId;
    const lateJoinerConn = sharedConnections.attach(lateJoinerSocket);
    lateJoinerConn.userId = lateJoinerUserId;

    const hostJoinReply = await routeGatewayMessage(
      hostConn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId },
        op: 'command',
        reqId: 'req-vj-host-live-stream',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    const startReply = await routeGatewayMessage(
      hostConn,
      JSON.stringify({
        command: 'stream.start',
        data: { channelId, sourceType: 'screen' },
        op: 'command',
        reqId: 'req-stream-start-live-before-join',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(hostJoinReply.op).toBe('ack');
    expect(startReply.op).toBe('ack');

    lateJoinerSocket.send.mockClear();

    const lateJoinReply = await routeGatewayMessage(
      lateJoinerConn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId },
        op: 'command',
        reqId: 'req-vj-late-joiner',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(lateJoinReply.op).toBe('ack');

    const streamStateEvent = parseSentEnvelopes(lateJoinerSocket.send).find(
      (envelope) => envelope.op === 'event' && envelope.event === 'stream.state.updated',
    );

    expect(streamStateEvent).toBeDefined();
    expect(streamStateEvent.data.channelId).toBe(channelId);
    expect(streamStateEvent.data.streams).toHaveLength(1);
    expect(streamStateEvent.data.streams[0]?.hostUserId).toBe(hostUserId);
  });

  it('acks stream.start and creates an active stream room', async () => {
    const channelId = '00000000-0000-0000-0000-000000000101';
    const guildId = '00000000-0000-0000-0000-000000000102';
    const userId = '00000000-0000-0000-0000-000000000103';

    const sharedConnections = new ConnectionManager();
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === userId
              ? { guildId, userId, joinedAt: new Date(), nickname: null }
              : null,
        },
        streamSessions: {
          create: async () => ({ channelId, endedAt: null, hostUserId: userId, id: '00000000-0000-0000-0000-000000000199', metadata: {}, sourceType: 'screen', startedAt: null, status: 'starting' }),
          findActiveByChannel: async () => null,
          findById: async () => null,
          updateStatus: async () => {},
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom: new StreamRoomManager(sharedConnections),
    });

    const conn = sharedConnections.attach({ close() {}, send() {} });
    conn.userId = userId;

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'stream.start',
        data: { channelId, sourceType: 'screen' },
        op: 'command',
        reqId: 'req-stream-start',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(reply.op).toBe('ack');
    expect(successRuntime.streamRoom.getPublications(channelId)[0]?.host.userId).toBe(userId);
  });

  it('persists requested livestream quality metadata when starting a stream', async () => {
    const channelId = '00000000-0000-0000-0000-000000000201';
    const guildId = '00000000-0000-0000-0000-000000000202';
    const userId = '00000000-0000-0000-0000-000000000203';
    const createStreamSession = vi.fn().mockResolvedValue({
      channelId,
      endedAt: null,
      hostUserId: userId,
      id: '00000000-0000-0000-0000-000000000204',
      metadata: { quality: { bitrateKbps: 10000, frameRate: 60, resolution: '1080p' } },
      sourceType: 'screen',
      startedAt: null,
      status: 'starting',
    });

    const sharedConnections = new ConnectionManager();
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === userId
              ? { guildId, userId, joinedAt: new Date(), nickname: null }
              : null,
        },
        streamSessions: {
          create: createStreamSession,
          findActiveByChannel: async () => null,
          findById: async () => null,
          updateStatus: async () => {},
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom: new StreamRoomManager(sharedConnections),
    });

    const conn = sharedConnections.attach({ close() {}, send() {} });
    conn.userId = userId;

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'stream.start',
        data: {
          channelId,
          quality: { bitrateKbps: 10000, frameRate: 60, resolution: '1080p' },
          sourceType: 'screen',
        },
        op: 'command',
        reqId: 'req-stream-start-quality',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(reply.op).toBe('ack');
    expect(createStreamSession).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId,
        hostUserId: userId,
        metadata: {
          quality: { bitrateKbps: 10000, frameRate: 60, resolution: '1080p' },
        },
        sourceType: 'screen',
      }),
    );
  });

  it('removes a hosted stream when the host leaves the voice channel', async () => {
    const channelId = '00000000-0000-0000-0000-000000000104';
    const guildId = '00000000-0000-0000-0000-000000000105';
    const hostUserId = '00000000-0000-0000-0000-000000000106';
    const updateStatus = vi.fn().mockResolvedValue(undefined);

    const sharedConnections = new ConnectionManager();
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === hostUserId
              ? { guildId, userId: uId, joinedAt: new Date(), nickname: null }
              : null,
        },
        streamSessions: {
          create: async ({ id, sourceType }: { id: string; sourceType: 'camera' | 'screen' }) => ({ channelId, endedAt: null, hostUserId, id, metadata: {}, sourceType, startedAt: null, status: 'starting' }),
          findActiveByChannel: async () => null,
          findById: async () => null,
          updateStatus,
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom: new StreamRoomManager(sharedConnections),
      voiceRoom: new VoiceRoomManager(sharedConnections),
    });

    const hostConn = sharedConnections.attach({ close() {}, send() {} });
    hostConn.userId = hostUserId;

    const joinReply = await routeGatewayMessage(
      hostConn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId },
        op: 'command',
        reqId: 'req-vj-host-leave-stream',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );
    const startReply = await routeGatewayMessage(
      hostConn,
      JSON.stringify({
        command: 'stream.start',
        data: { channelId, sourceType: 'screen' },
        op: 'command',
        reqId: 'req-stream-start-host-leave',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(joinReply.op).toBe('ack');
    expect(startReply.op).toBe('ack');
    expect(successRuntime.streamRoom.getPublications(channelId)).toHaveLength(1);

    const leaveReply = await routeGatewayMessage(
      hostConn,
      JSON.stringify({
        command: 'voice.leave',
        data: { channelId },
        op: 'command',
        reqId: 'req-voice-leave-host-stream',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(leaveReply.op).toBe('ack');
    expect(successRuntime.streamRoom.getPublications(channelId)).toHaveLength(0);
    expect(updateStatus).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000099',
      'idle',
      expect.objectContaining({ endedAt: expect.any(Date) }),
    );
  });

  it('removes a viewer from stream state when they leave the voice channel', async () => {
    const channelId = '00000000-0000-0000-0000-000000000107';
    const guildId = '00000000-0000-0000-0000-000000000108';
    const hostUserId = '00000000-0000-0000-0000-000000000109';
    const viewerUserId = '00000000-0000-0000-0000-000000000110';

    const sharedConnections = new ConnectionManager();
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && [hostUserId, viewerUserId].includes(uId)
              ? { guildId, userId: uId, joinedAt: new Date(), nickname: null }
              : null,
        },
        streamSessions: {
          create: async ({ id, sourceType }: { id: string; sourceType: 'camera' | 'screen' }) => ({ channelId, endedAt: null, hostUserId, id, metadata: {}, sourceType, startedAt: null, status: 'starting' }),
          findActiveByChannel: async () => null,
          findById: async () => null,
          updateStatus: async () => {},
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom: new StreamRoomManager(sharedConnections),
      voiceRoom: new VoiceRoomManager(sharedConnections),
    });

    const hostConn = sharedConnections.attach({ close() {}, send() {} });
    hostConn.userId = hostUserId;
    const viewerConn = sharedConnections.attach({ close() {}, send() {} });
    viewerConn.userId = viewerUserId;

    await routeGatewayMessage(
      hostConn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId },
        op: 'command',
        reqId: 'req-vj-host-viewer-leave',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );
    await routeGatewayMessage(
      hostConn,
      JSON.stringify({
        command: 'stream.start',
        data: { channelId, sourceType: 'screen' },
        op: 'command',
        reqId: 'req-stream-start-viewer-leave',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );
    await routeGatewayMessage(
      viewerConn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId },
        op: 'command',
        reqId: 'req-vj-viewer-leave',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    const streamId = successRuntime.streamRoom.getPublications(channelId)[0]?.streamId;
    expect(streamId).toBeDefined();

    const watchReply = await routeGatewayMessage(
      viewerConn,
      JSON.stringify({
        command: 'stream.watch',
        data: { channelId, streamId },
        op: 'command',
        reqId: 'req-stream-watch-viewer-leave',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(watchReply.op).toBe('ack');
    expect(successRuntime.streamRoom.getViewer(channelId, streamId!, viewerUserId)).not.toBeNull();

    const leaveReply = await routeGatewayMessage(
      viewerConn,
      JSON.stringify({
        command: 'voice.leave',
        data: { channelId },
        op: 'command',
        reqId: 'req-voice-leave-viewer-stream',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(leaveReply.op).toBe('ack');
    expect(successRuntime.streamRoom.getViewer(channelId, streamId!, viewerUserId)).toBeNull();
    expect(successRuntime.streamRoom.getPublications(channelId)).toHaveLength(1);
  });

  it('allows multiple publishers to stream concurrently in the same voice channel', async () => {
    const channelId = '00000000-0000-0000-0000-000000000141';
    const guildId = '00000000-0000-0000-0000-000000000142';
    const firstUserId = '00000000-0000-0000-0000-000000000143';
    const secondUserId = '00000000-0000-0000-0000-000000000144';

    const sharedConnections = new ConnectionManager();
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && [firstUserId, secondUserId].includes(uId)
              ? { guildId, userId: uId, joinedAt: new Date(), nickname: null }
              : null,
        },
        streamSessions: {
          create: async ({ hostUserId, id, sourceType }: { hostUserId: string; id: string; sourceType: 'camera' | 'screen' }) => ({
            channelId,
            endedAt: null,
            hostUserId,
            id,
            metadata: {},
            sourceType,
            startedAt: null,
            status: 'starting',
          }),
          findActiveByChannel: async () => null,
          findById: async () => null,
          updateStatus: async () => {},
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom: new StreamRoomManager(sharedConnections),
    });

    const firstConn = sharedConnections.attach({ close() {}, send() {} });
    firstConn.userId = firstUserId;
    const secondConn = sharedConnections.attach({ close() {}, send() {} });
    secondConn.userId = secondUserId;

    const firstReply = await routeGatewayMessage(
      firstConn,
      JSON.stringify({
        command: 'stream.start',
        data: { channelId, sourceType: 'screen' },
        op: 'command',
        reqId: 'req-stream-start-a',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    const secondReply = await routeGatewayMessage(
      secondConn,
      JSON.stringify({
        command: 'stream.start',
        data: { channelId, sourceType: 'camera' },
        op: 'command',
        reqId: 'req-stream-start-b',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(firstReply.op).toBe('ack');
    expect(secondReply.op).toBe('ack');
    expect(successRuntime.streamRoom.getPublications(channelId)).toHaveLength(2);
  });

  it('returns STREAM_NOT_LIVE for stream.watch when no active stream exists', async () => {
    const channelId = '00000000-0000-0000-0000-000000000111';
    const guildId = '00000000-0000-0000-0000-000000000112';
    const userId = '00000000-0000-0000-0000-000000000113';

    const notLiveRuntime = makeRuntime({
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === userId
              ? { guildId, userId, joinedAt: new Date(), nickname: null }
              : null,
        },
      } as unknown as DatabaseAccess,
    });

    const conn = makeConnection({ userId });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'stream.watch',
        data: { channelId },
        op: 'command',
        reqId: 'req-stream-watch-miss',
        ts: ts(),
        v: 1,
      }),
      notLiveRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('STREAM_NOT_LIVE');
  });

  it('requires streamId for stream.watch when multiple streams are live in the channel', async () => {
    const channelId = '00000000-0000-0000-0000-000000000151';
    const guildId = '00000000-0000-0000-0000-000000000152';
    const viewerUserId = '00000000-0000-0000-0000-000000000153';
    const hostAUserId = '00000000-0000-0000-0000-000000000154';
    const hostBUserId = '00000000-0000-0000-0000-000000000155';

    const sharedConnections = new ConnectionManager();
    const streamRoom = new StreamRoomManager(sharedConnections);
    streamRoom.start(channelId, '00000000-0000-0000-0000-000000000156', hostAUserId, 'conn-a', '00000000-0000-0000-0000-000000000157', 'screen');
    streamRoom.start(channelId, '00000000-0000-0000-0000-000000000158', hostBUserId, 'conn-b', '00000000-0000-0000-0000-000000000159', 'camera');

    const watchRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === viewerUserId
              ? { guildId, userId: uId, joinedAt: new Date(), nickname: null }
              : null,
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom,
    });

    const conn = sharedConnections.attach({ close() {}, send() {} });
    conn.userId = viewerUserId;

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'stream.watch',
        data: { channelId },
        op: 'command',
        reqId: 'req-stream-watch-multi',
        ts: ts(),
        v: 1,
      }),
      watchRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('STREAM_NOT_FOUND');
  });

  it('allows a host to watch another stream in the same channel when targeted by streamId', async () => {
    const channelId = '00000000-0000-0000-0000-000000000161';
    const guildId = '00000000-0000-0000-0000-000000000162';
    const hostAUserId = '00000000-0000-0000-0000-000000000163';
    const hostBUserId = '00000000-0000-0000-0000-000000000164';

    const sharedConnections = new ConnectionManager();
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && [hostAUserId, hostBUserId].includes(uId)
              ? { guildId, userId: uId, joinedAt: new Date(), nickname: null }
              : null,
        },
        streamSessions: {
          create: async ({ hostUserId, id, sourceType }: { hostUserId: string; id: string; sourceType: 'camera' | 'screen' }) => ({
            channelId,
            endedAt: null,
            hostUserId,
            id,
            metadata: {},
            sourceType,
            startedAt: null,
            status: 'starting',
          }),
          findActiveByChannel: async () => null,
          findById: async () => null,
          updateStatus: async () => {},
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom: new StreamRoomManager(sharedConnections),
    });

    const hostAConn = sharedConnections.attach({ close() {}, send() {} });
    hostAConn.userId = hostAUserId;
    const hostBConn = sharedConnections.attach({ close() {}, send() {} });
    hostBConn.userId = hostBUserId;

    const firstReply = await routeGatewayMessage(
      hostAConn,
      JSON.stringify({
        command: 'stream.start',
        data: { channelId, sourceType: 'screen' },
        op: 'command',
        reqId: 'req-stream-start-host-a',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );
    const secondReply = await routeGatewayMessage(
      hostBConn,
      JSON.stringify({
        command: 'stream.start',
        data: { channelId, sourceType: 'camera' },
        op: 'command',
        reqId: 'req-stream-start-host-b',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(firstReply.op).toBe('ack');
    expect(secondReply.op).toBe('ack');
    const targetStreamId = successRuntime.streamRoom
      .getPublications(channelId)
      .find((publication) => publication.host.userId === hostBUserId)
      ?.streamId;

    expect(targetStreamId).toBeDefined();

    const watchReply = await routeGatewayMessage(
      hostAConn,
      JSON.stringify({
        command: 'stream.watch',
        data: { channelId, streamId: targetStreamId },
        op: 'command',
        reqId: 'req-stream-watch-host-a',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(watchReply.op).toBe('ack');
  });

  it('accepts voice.network.self_report for an active voice participant', async () => {
    const channelId = '00000000-0000-0000-0000-000000000201';
    const guildId = '00000000-0000-0000-0000-000000000202';
    const userId = '00000000-0000-0000-0000-000000000203';

    const sharedConnections = new ConnectionManager();
    const successRuntime = makeRuntime({
      connections: sharedConnections,
      db: {
        channels: {
          findById: async (id: string) =>
            id === channelId
              ? { id: channelId, guildId, name: 'General Voice', type: 'voice', position: 0, topic: null, createdAt: new Date() }
              : null,
        },
        guildMembers: {
          findMembership: async (gId: string, uId: string) =>
            gId === guildId && uId === userId
              ? { guildId, userId: uId, joinedAt: new Date(), nickname: null }
              : null,
        },
      } as unknown as DatabaseAccess,
      presence: new PresenceManager(sharedConnections, null),
      voiceRoom: new VoiceRoomManager(sharedConnections),
    });

    const conn = sharedConnections.attach({ close() {}, send() {} });
    conn.userId = userId;

    const joinReply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'voice.join',
        data: { channelId },
        op: 'command',
        reqId: 'req-vj-self-report',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );
    expect(joinReply.op).toBe('ack');

    const reportReply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'voice.network.self_report',
        data: { channelId, mediaSelfLossPct: 3 },
        op: 'command',
        reqId: 'req-voice-network-report',
        ts: ts(),
        v: 1,
      }),
      successRuntime,
    );

    expect(reportReply.op).toBe('ack');
    expect(successRuntime.updateVoiceMediaSelfLoss).toHaveBeenCalledWith(conn.id, channelId, 3);
  });

  it('returns VOICE_NOT_JOINED for voice.network.self_report when user is not in that channel', async () => {
    const channelId = '00000000-0000-0000-0000-000000000204';
    const conn = makeConnection({ userId: '00000000-0000-0000-0000-000000000205' });

    const reply = await routeGatewayMessage(
      conn,
      JSON.stringify({
        command: 'voice.network.self_report',
        data: { channelId, mediaSelfLossPct: 1 },
        op: 'command',
        reqId: 'req-voice-network-not-joined',
        ts: ts(),
        v: 1,
      }),
      runtime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') {
      expect(reply.code).toBe('VOICE_NOT_JOINED');
    }
  });

  it('rejects media.signal.* when voice peers are not in the same active voice session', async () => {
    const channelId = '00000000-0000-0000-0000-000000000121';
    const senderUserId = '00000000-0000-0000-0000-000000000122';
    const targetUserId = '00000000-0000-0000-0000-000000000123';

    const sharedConnections = new ConnectionManager();
    const voiceRuntime = makeRuntime({
      connections: sharedConnections,
      presence: new PresenceManager(sharedConnections, null),
      voiceRoom: new VoiceRoomManager(sharedConnections),
    });

    const sender = sharedConnections.attach({ close() {}, send() {} });
    sender.userId = senderUserId;
    const target = sharedConnections.attach({ close() {}, send() {} });
    target.userId = targetUserId;
    sharedConnections.markAuthenticated(sender.id, senderUserId, '00000000-0000-0000-0000-000000000124', null, []);
    sharedConnections.markAuthenticated(target.id, targetUserId, '00000000-0000-0000-0000-000000000125', null, []);

    voiceRuntime.voiceRoom.join(channelId, senderUserId, sender.id, '00000000-0000-0000-0000-000000000126');

    const reply = await routeGatewayMessage(
      sender,
      JSON.stringify({
        command: 'media.signal.offer',
        data: {
          signal: {
            sdp: 'offer-sdp',
            session: {
              channelId,
              mode: 'voice',
              sessionId: '00000000-0000-0000-0000-000000000126',
              userId: senderUserId,
            },
            type: 'offer',
          },
          targetUserId,
        },
        op: 'command',
        reqId: 'req-voice-signal-invalid',
        ts: ts(),
        v: 1,
      }),
      voiceRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('VOICE_NOT_JOINED');
  });

  it('rejects media.signal.* when stream peers are not in the same active stream session', async () => {
    const channelId = '00000000-0000-0000-0000-000000000131';
    const hostUserId = '00000000-0000-0000-0000-000000000132';
    const targetUserId = '00000000-0000-0000-0000-000000000133';

    const sharedConnections = new ConnectionManager();
    const streamRoom = new StreamRoomManager(sharedConnections);
    const streamRuntime = makeRuntime({
      connections: sharedConnections,
      presence: new PresenceManager(sharedConnections, null),
      streamRoom,
    });

    const host = sharedConnections.attach({ close() {}, send() {} });
    host.userId = hostUserId;
    const target = sharedConnections.attach({ close() {}, send() {} });
    target.userId = targetUserId;
    sharedConnections.markAuthenticated(host.id, hostUserId, '00000000-0000-0000-0000-000000000134', null, []);
    sharedConnections.markAuthenticated(target.id, targetUserId, '00000000-0000-0000-0000-000000000135', null, []);

    streamRoom.start(
      channelId,
      '00000000-0000-0000-0000-000000000136',
      hostUserId,
      host.id,
      '00000000-0000-0000-0000-000000000137',
      'screen',
    );

    const reply = await routeGatewayMessage(
      host,
      JSON.stringify({
        command: 'media.signal.offer',
        data: {
          signal: {
            sdp: 'offer-sdp',
            session: {
              channelId,
              mode: 'stream_publish',
              sessionId: '00000000-0000-0000-0000-000000000136',
              userId: hostUserId,
            },
            type: 'offer',
          },
          targetUserId,
        },
        op: 'command',
        reqId: 'req-stream-signal-invalid',
        ts: ts(),
        v: 1,
      }),
      streamRuntime,
    );

    expect(reply.op).toBe('error');
    if (reply.op === 'error') expect(reply.code).toBe('STREAM_NOT_LIVE');
  });
});
