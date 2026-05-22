import { afterEach, describe, expect, it, vi } from 'vitest';

import { isVersionGreater, normalizeServerInput, readServerHealth } from './server-config';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
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
});
