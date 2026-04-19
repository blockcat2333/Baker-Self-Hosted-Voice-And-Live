import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from './api-client';

describe('api-client JSON parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces empty non-ok responses as ApiError with HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );

    const api = createApiClient('http://example.test');

    await expect(api.login({ email: 'a@example.com', password: 'password123' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
    await expect(api.login({ email: 'a@example.com', password: 'password123' })).rejects.toThrow('HTTP 404');
  });

  it('throws a clear error for empty ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );

    const api = createApiClient('http://example.test');

    await expect(api.getPublicServerConfig()).rejects.toThrow('Empty response from server (HTTP 200).');
  });

  it('throws a clear error for non-JSON ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } })),
    );

    const api = createApiClient('http://example.test');

    await expect(api.getHealth()).rejects.toThrow(/Invalid JSON response from server \(HTTP 200/);
  });

  it('sends authenticated logout requests with the bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const api = createApiClient('http://example.test', {
      getAccessToken: () => 'access-token',
    });

    await expect(api.logout()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.test/v1/auth/logout',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
        method: 'POST',
      }),
    );
  });
});
