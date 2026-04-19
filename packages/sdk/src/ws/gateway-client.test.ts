import { describe, expect, it, vi } from 'vitest';

import { GatewayClient } from './gateway-client';

class FakeWebSocket {
  readyState = 0;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(type: string, handler: (event: unknown) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(handler);
    this.listeners.set(type, arr);
  }

  send(data: unknown) {
    if (this.readyState !== 1) {
      throw new Error("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.");
    }
    this.sent.push(String(data));
  }

  close() {
    this.readyState = 3;
    this.emit('close', {});
  }

  open() {
    this.readyState = 1;
    this.emit('open', {});
  }

  private emit(type: string, event: unknown) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

describe('GatewayClient send behavior', () => {
  it('queues commands while CONNECTING and flushes on open', () => {
    const socket = new FakeWebSocket();
    const client = new GatewayClient('ws://example.test/ws', {
      socketFactory: () => socket as unknown as WebSocket,
    });

    client.connect();

    expect(() => client.sendCommand({ command: 'system.authenticate', data: { accessToken: 'x' } })).not.toThrow();
    expect(() => client.ping()).not.toThrow();
    expect(socket.sent).toHaveLength(0);

    socket.open();
    expect(socket.sent).toHaveLength(2);
  });

  it('invokes close listeners when socket closes', () => {
    const socket = new FakeWebSocket();
    const client = new GatewayClient('ws://example.test/ws', {
      socketFactory: () => socket as unknown as WebSocket,
    });

    const onClose = vi.fn();
    client.onClose(onClose);
    client.connect();

    socket.close();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
