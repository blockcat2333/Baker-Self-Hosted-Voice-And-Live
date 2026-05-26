import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isClientReleaseVersion,
  isServerVersionGreaterThanClient,
  isVersionGreater,
} from './versioning';
import { normalizeServerInput, probeGateway, readServerHealth } from './server-config';

const originalFetch = globalThis.fetch;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly handlers = new Map<string, Array<() => void>>();
  readyState = FakeWebSocket.CONNECTING;
  wasClosed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(event: string, handler: () => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  close() {
    this.wasClosed = true;
    this.readyState = 3;
  }

  emit(event: string) {
    if (event === 'open') {
      this.readyState = FakeWebSocket.OPEN;
    }
    for (const handler of this.handlers.get(event) ?? []) {
      handler();
    }
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWebSocket.instances = [];
});

describe('desktop server config', () => {
  it('normalizes a bare domain or IP into API and gateway URLs', () => {
    expect(normalizeServerInput('example.com')).toEqual({
      apiBaseUrl: 'http://example.com',
      gatewayUrl: 'ws://example.com/ws',
      input: 'example.com',
    });

    expect(normalizeServerInput('https://192.168.1.10:8443/admin')).toEqual({
      apiBaseUrl: 'https://192.168.1.10:8443',
      gatewayUrl: 'wss://192.168.1.10:8443/ws',
      input: 'https://192.168.1.10:8443/admin',
    });
  });

  it('compares release versions numerically', () => {
    expect(isVersionGreater('1.0.4', '1.0.3')).toBe(true);
    expect(isVersionGreater('1.10.0', '1.9.9')).toBe(true);
    expect(isVersionGreater('1.0.3', '1.0.3')).toBe(false);
    expect(isVersionGreater('1.0.2', '1.0.3')).toBe(false);
    expect(isVersionGreater('1.0.5b', '1.0.5a')).toBe(true);
    expect(isVersionGreater('1.0.6a', '1.0.5z')).toBe(true);
    expect(isVersionGreater('1.0.5', '1.0.5a')).toBe(false);
  });

  it('classifies client release labels separately from server image tags', () => {
    expect(isClientReleaseVersion('1.0.5a')).toBe(true);
    expect(isClientReleaseVersion('v1.0.5b')).toBe(true);
    expect(isClientReleaseVersion('1.0.5')).toBe(false);
  });

  it('compares server numeric releases against a lettered client release line', () => {
    expect(isServerVersionGreaterThanClient('1.0.6', '1.0.5z')).toBe(true);
    expect(isServerVersionGreaterThanClient('1.0.5', '1.0.5a')).toBe(false);
    expect(isServerVersionGreaterThanClient('1.0.4', '1.0.5a')).toBe(false);
  });

  it('reads and validates server health', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ service: 'api', status: 'ok', version: '1.0.3' }),
      ok: true,
    } as Response);

    await expect(readServerHealth('http://example.com')).resolves.toEqual({
      service: 'api',
      status: 'ok',
      version: '1.0.3',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith('http://example.com/health', {
      signal: expect.any(AbortSignal),
    });
  });

  it('rewrites aborted health checks to a useful timeout message', async () => {
    const abortError = Object.assign(new Error('signal is aborted without reason'), {
      name: 'AbortError',
    });
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    await expect(readServerHealth('https://example.com:3323', 1000)).rejects.toThrow(
      'Connection to https://example.com:3323/health timed out after 1 seconds.',
    );
  });

  it('probes the gateway websocket before saving a server', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const probe = probeGateway('wss://example.com:3323/ws');
    const socket = FakeWebSocket.instances[0]!;
    socket.emit('open');

    await expect(probe).resolves.toBeUndefined();
    expect(socket.url).toBe('wss://example.com:3323/ws');
    expect(socket.wasClosed).toBe(true);
  });

  it('reports websocket probe failures with gateway-specific guidance', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const probe = probeGateway('wss://example.com:3323/ws');
    FakeWebSocket.instances[0]!.emit('error');

    await expect(probe).rejects.toThrow('Cannot open gateway WebSocket at wss://example.com:3323/ws');
  });
});
