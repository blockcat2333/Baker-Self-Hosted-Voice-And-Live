import { describe, expect, it, vi } from 'vitest';
import { hasNewWebBuild, webRefreshUrl } from './web-update';

describe('web update detection', () => {
  const url = 'https://baker.example/web-build.json?check=1';
  const response = (body: unknown, status = 200) => vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  );
  it('detects a redeployment without depending on server package versions', async () => {
    const fetcher = response({ buildId: 'new' });
    expect(await hasNewWebBuild('old', url, fetcher)).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ cache: 'no-store' }));
    expect(await hasNewWebBuild('new', url, fetcher)).toBe(false);
  });
  it('ignores absent manifests, malformed replies and offline connections', async () => {
    for (const body of [null, {}, { buildId: '' }, { buildId: 123 }]) {
      expect(await hasNewWebBuild('old', url, response(body))).toBe(false);
    }
    expect(await hasNewWebBuild('old', url, response({}, 404))).toBe(false);
    expect(await hasNewWebBuild('old', url, vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>')))).toBe(false);
    expect(await hasNewWebBuild('old', url, vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')))).toBe(false);
  });
  it('bounds a stalled manifest request', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
      }));
      const result = hasNewWebBuild('old', url, fetcher);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await result).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('refreshes with a cache-busting URL while preserving route and query', () => {
    const result = new URL(webRefreshUrl('https://baker.example/room?server=a#voice'));
    expect(result.pathname).toBe('/room');
    expect(result.searchParams.get('server')).toBe('a');
    expect(result.searchParams.has('baker-refresh')).toBe(true);
    expect(result.hash).toBe('#voice');
  });
});
