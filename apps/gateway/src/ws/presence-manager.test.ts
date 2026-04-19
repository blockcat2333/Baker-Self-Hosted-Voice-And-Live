import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from './connection-manager';
import { PresenceManager } from './presence-manager';

function parseSentEnvelopes(sendMock: ReturnType<typeof vi.fn>) {
  return sendMock.mock.calls.map(([payload]) => JSON.parse(payload as string));
}

describe('PresenceManager', () => {
  it('sends an authoritative local snapshot and prunes stale redis presence entries', async () => {
    const connections = new ConnectionManager();
    const redis = {
      hdel: vi.fn().mockResolvedValue(1),
      hgetall: vi.fn().mockResolvedValue({
        '00000000-0000-0000-0000-000000000001': '4',
        '00000000-0000-0000-0000-000000000002': '1',
        '00000000-0000-0000-0000-000000000004': '9',
      }),
      hset: vi.fn().mockResolvedValue(1),
    } as const;

    const presence = new PresenceManager(connections, redis as never);
    const existingSend = vi.fn();
    const joiningSend = vi.fn();

    const existing = connections.attach({ close() {}, send: existingSend });
    connections.markAuthenticated(
      existing.id,
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000104',
      'test4',
      [],
    );

    const joining = connections.attach({ close() {}, send: joiningSend });
    connections.markAuthenticated(
      joining.id,
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000105',
      'test5',
      [],
    );

    await presence.sendSnapshotTo(joining);

    const snapshotEvents = parseSentEnvelopes(joiningSend);
    expect(snapshotEvents).toHaveLength(1);
    expect(snapshotEvents[0]?.event).toBe('presence.updated');
    expect(snapshotEvents[0]?.data).toMatchObject({
      connectionCount: 1,
      status: 'online',
      userId: '00000000-0000-0000-0000-000000000004',
      username: 'test4',
    });

    expect(redis.hdel).toHaveBeenCalledWith('bakr:presence:connections', '00000000-0000-0000-0000-000000000001');
    expect(redis.hdel).toHaveBeenCalledWith('bakr:presence:connections', '00000000-0000-0000-0000-000000000002');
    expect(redis.hset).toHaveBeenCalledWith('bakr:presence:connections', '00000000-0000-0000-0000-000000000004', '1');
  });

  it('broadcasts offline using the current local connection count after disconnect', async () => {
    const connections = new ConnectionManager();
    const redis = {
      hdel: vi.fn().mockResolvedValue(1),
      hgetall: vi.fn(),
      hset: vi.fn().mockResolvedValue(1),
    } as const;

    const presence = new PresenceManager(connections, redis as never);
    const observerSend = vi.fn();

    const observer = connections.attach({ close() {}, send: observerSend });
    connections.markAuthenticated(
      observer.id,
      '00000000-0000-0000-0000-000000000006',
      '00000000-0000-0000-0000-000000000106',
      'test5',
      [],
    );

    const disconnecting = connections.attach({ close() {}, send: vi.fn() });
    connections.markAuthenticated(
      disconnecting.id,
      '00000000-0000-0000-0000-000000000007',
      '00000000-0000-0000-0000-000000000107',
      'test4',
      [],
    );

    await presence.onConnect('00000000-0000-0000-0000-000000000007', 'test4');
    observerSend.mockClear();

    connections.detach(disconnecting.id);
    await presence.onDisconnect('00000000-0000-0000-0000-000000000007');

    const broadcastEvents = parseSentEnvelopes(observerSend);
    expect(broadcastEvents).toHaveLength(1);
    expect(broadcastEvents[0]?.event).toBe('presence.updated');
    expect(broadcastEvents[0]?.data).toMatchObject({
      connectionCount: 0,
      status: 'offline',
      userId: '00000000-0000-0000-0000-000000000007',
      username: 'test4',
    });

    expect(redis.hdel).toHaveBeenCalledWith('bakr:presence:connections', '00000000-0000-0000-0000-000000000007');
  });
});
