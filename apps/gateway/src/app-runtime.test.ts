import { describe, expect, it, vi } from 'vitest';

import type { DatabaseAccess } from '@baker/db';

import { GatewayRuntime } from './app-runtime';

describe('GatewayRuntime voice roster fanout', () => {
  it('fans out roster updates using cached guild visibility instead of per-connection membership lookups', async () => {
    const sendInGuild = vi.fn();
    const sendOutOfGuild = vi.fn();
    const findMembership = vi.fn();

    const db = {
      channels: {
        findById: async () => ({
          createdAt: new Date(),
          guildId: 'guild-a',
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Voice',
          position: 0,
          topic: null,
          type: 'voice',
          voiceQuality: 'standard',
        }),
        listByGuildForUser: async () => [],
      },
      close: async () => {},
      guildMembers: {
        findMembership,
      },
      guilds: {
        listForUser: async () => [],
      },
      streamSessions: {
        updateStatus: async () => {},
      },
      users: {
        findById: async () => null,
      },
      withTransaction: async <T>(operation: (_repos: never) => Promise<T>) => operation(undefined as never),
    } as unknown as DatabaseAccess;

    const runtime = new GatewayRuntime({
      db,
      fanoutEnabled: false,
      mediaBaseUrl: 'http://media.local',
      mediaInternalSecret: 'replace-me-for-local-media-internal-secret',
      pubClient: null,
      subClient: null,
      tokenVerifier: async () => ({ code: 'TOKEN_INVALID', ok: false }),
    });

    const inGuildConn = runtime.connections.attach({
      close() {},
      send: sendInGuild,
    });
    const outOfGuildConn = runtime.connections.attach({
      close() {},
      send: sendOutOfGuild,
    });

    runtime.connections.markAuthenticated(
      inGuildConn.id,
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'member',
      ['guild-a'],
    );
    runtime.connections.markAuthenticated(
      outOfGuildConn.id,
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      'other',
      ['guild-b'],
    );

    runtime.voiceRoom.join(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      inGuildConn.id,
      '33333333-3333-4333-8333-333333333333',
    );

    await runtime.broadcastVoiceRosterUpdated('11111111-1111-4111-8111-111111111111');

    expect(sendInGuild).toHaveBeenCalledOnce();
    expect(sendOutOfGuild).not.toHaveBeenCalled();
    expect(findMembership).not.toHaveBeenCalled();
  });
});
