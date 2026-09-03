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

  it('accepts diagnostics only from the active host connection and session', () => {
    const connections = new ConnectionManager();
    const manager = new StreamRoomManager(connections);
    const host = attachConnection(connections);
    manager.start(
      'channel-a',
      'stream-a',
      'user-host',
      host.id,
      'session-a',
      'screen',
    );
    const publisher = {
      actualCodec: 'av1' as const,
      bitrateKbps: 4000,
      captureFrameRate: 30,
      encodedFrameRate: 30,
      encoderAcceleration: 'hardware' as const,
      packetsLost: 0,
      packetsSent: 100,
      qualityLimitationReason: 'none' as const,
      requestedCodec: 'av1' as const,
      roundTripTimeMs: 20,
      targetBitrateKbps: 4000,
      targetFrameRate: 30,
    };
    expect(
      manager.setPublisherDiagnostics(
        'channel-a',
        'stream-a',
        'session-a',
        host.id,
        publisher,
        1000,
      ),
    ).toBe(true);
    expect(
      manager.setPublisherDiagnostics(
        'channel-a',
        'stream-a',
        'wrong-session',
        host.id,
        publisher,
        1000,
      ),
    ).toBe(false);
    expect(
      manager.getPublication('channel-a', 'stream-a')?.publisherDiagnostics
        ?.publisher.actualCodec,
    ).toBe('av1');
  });
});
