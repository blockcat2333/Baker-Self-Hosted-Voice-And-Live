import { describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from './connection-manager';

describe('media network snapshot precision and freshness', () => {
  it('preserves fractional loss instead of rounding it to zero', () => {
    const manager = new ConnectionManager();
    const connection = manager.attach({ send: vi.fn(), close: vi.fn() });
    manager.updateMediaSelfLoss(connection.id, 0.24, 1000);
    expect(
      manager.getVoiceConnectionNetworkSnapshot(connection.id, 2000)
        ?.mediaSelfLossPct,
    ).toBe(0.24);
  });

  it('expires media stats independently of a healthy gateway heartbeat', () => {
    const manager = new ConnectionManager();
    const connection = manager.attach({ send: vi.fn(), close: vi.fn() });
    manager.updateMediaSelfLoss(connection.id, 0, 1000);
    manager.noteGatewayPingSent(connection.id, 20_000);
    manager.noteGatewayPong(connection.id, 20_010);
    const snapshot = manager.getVoiceConnectionNetworkSnapshot(
      connection.id,
      20_010,
    );
    expect(snapshot?.mediaSelfLossPct).toBeNull();
    expect(snapshot?.gatewayRttMs).toBe(10);
    expect(snapshot?.stale).toBe(false);
  });
});
