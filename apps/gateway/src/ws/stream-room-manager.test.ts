import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from './connection-manager';
import { StreamRoomManager } from './stream-room-manager';

function attachConnection(connections: ConnectionManager) {
  return connections.attach({
    close() {},
    send: vi.fn(),
  });
}

describe('StreamRoomManager', () => {
  it('does not remove a replacement connection when a stale socket closes', () => {
    const connections = new ConnectionManager();
    const manager = new StreamRoomManager(connections);
    const stale = attachConnection(connections);
    const replacement = attachConnection(connections);

    manager.start(
      'channel-a',
      'stream-a',
      'user-host',
      replacement.id,
      'new-session',
      'screen',
    );

    expect(manager.leaveAllForUser('user-host', stale.id)).toEqual([]);
    expect(
      manager.getPublication('channel-a', 'stream-a')?.host.connectionId,
    ).toBe(replacement.id);
  });
});
