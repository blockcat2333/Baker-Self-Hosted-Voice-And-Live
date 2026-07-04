import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compareVersionTagsDesc,
  listBakerUpdateVersions,
} from './update-versions';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('update version discovery', () => {
  it('sorts semver tags descending and prefers stable tags over prereleases', () => {
    expect(
      [
        '1.0.3',
        '1.1.0-beta.1',
        '1.1.0',
        '1.0.10beta.3',
        '1.0.10-beta.2',
        '1.0.10beta2',
        '1.0.10beta',
        '1.0.10',
      ].sort(compareVersionTagsDesc),
    ).toEqual([
      '1.1.0',
      '1.1.0-beta.1',
      '1.0.10',
      '1.0.10beta.3',
      '1.0.10beta2',
      '1.0.10-beta.2',
      '1.0.10beta',
      '1.0.3',
    ]);
  });

  it('filters Docker Hub tags and merges GitHub release metadata best-effort', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-update-versions-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          results: [
            {
              images: [{ digest: 'sha256:old' }],
              last_updated: '2026-01-01T00:00:00.000Z',
              name: '1.0.3',
            },
            {
              images: [{ digest: 'sha256:new' }],
              last_updated: '2026-02-01T00:00:00.000Z',
              name: '1.0.4',
            },
            {
              images: [{ digest: 'sha256:beta' }],
              last_updated: '2026-03-01T00:00:00.000Z',
              name: '1.0.10beta',
            },
            {
              images: [{ digest: 'sha256:beta3' }],
              last_updated: '2026-05-01T00:00:00.000Z',
              name: '1.0.10beta.3',
            },
            {
              images: [{ digest: 'sha256:beta2' }],
              last_updated: '2026-04-01T00:00:00.000Z',
              name: '1.0.10beta2',
            },
            {
              images: [{ digest: 'sha256:beta2-alias' }],
              last_updated: '2026-04-01T00:00:00.000Z',
              name: '1.0.10-beta.2',
            },
            {
              images: [{ digest: 'sha256:latest' }],
              last_updated: '2026-02-01T00:00:00.000Z',
              name: 'latest',
            },
            {
              images: [],
              last_updated: '2026-02-01T00:00:00.000Z',
              name: 'dev-main',
            },
          ],
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => [
          {
            body: 'Beta 3 release notes',
            html_url:
              'https://github.com/blockcat2333/Baker-Self-Hosted-Voice-And-Live/releases/tag/v1.0.10beta.3',
            tag_name: 'v1.0.10beta.3',
          },
        ],
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const versions = await listBakerUpdateVersions();

      expect(versions.map((version) => version.tag)).toEqual([
        '1.0.10beta.3',
        '1.0.10beta2',
        '1.0.10-beta.2',
        '1.0.10beta',
        '1.0.4',
        '1.0.3',
      ]);
      expect(versions[0]).toMatchObject({
        digest: 'sha256:beta3',
        isLatest: true,
        releaseNotes: 'Beta 3 release notes',
        tag: '1.0.10beta.3',
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('uses the saved update proxy only for update metadata fetches', async () => {
    const tempDir = await mkdtemp(
      join(tmpdir(), 'baker-update-versions-proxy-'),
    );
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);
    await writeFile(
      join(tempDir, 'update-proxy.json'),
      JSON.stringify({
        enabled: true,
        proxyUrl: 'http://127.0.0.1:7890',
        updatedAt: new Date(0).toISOString(),
      }),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          results: [
            {
              images: [{ digest: 'sha256:new' }],
              last_updated: '2026-02-01T00:00:00.000Z',
              name: '1.0.4',
            },
          ],
        }),
        ok: true,
      })
      .mockRejectedValueOnce(new Error('GitHub unavailable'));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const versions = await listBakerUpdateVersions();

      expect(versions.map((version) => version.tag)).toEqual(['1.0.4']);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        dispatcher: expect.any(Object),
      });
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        dispatcher: expect.any(Object),
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
