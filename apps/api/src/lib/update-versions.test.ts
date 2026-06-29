import { afterEach, describe, expect, it, vi } from 'vitest';

import { compareVersionTagsDesc, listBakerUpdateVersions } from './update-versions';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('update version discovery', () => {
  it('sorts semver tags descending and prefers stable tags over prereleases', () => {
    expect(['1.0.3', '1.1.0-beta.1', '1.1.0', '1.0.10beta', '1.0.10'].sort(compareVersionTagsDesc)).toEqual([
      '1.1.0',
      '1.1.0-beta.1',
      '1.0.10',
      '1.0.10beta',
      '1.0.3',
    ]);
  });

  it('filters Docker Hub tags and merges GitHub release metadata best-effort', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: async () => ({
          results: [
            { images: [{ digest: 'sha256:old' }], last_updated: '2026-01-01T00:00:00.000Z', name: '1.0.3' },
            { images: [{ digest: 'sha256:new' }], last_updated: '2026-02-01T00:00:00.000Z', name: '1.0.4' },
            { images: [{ digest: 'sha256:beta' }], last_updated: '2026-03-01T00:00:00.000Z', name: '1.0.10beta' },
            { images: [{ digest: 'sha256:latest' }], last_updated: '2026-02-01T00:00:00.000Z', name: 'latest' },
            { images: [], last_updated: '2026-02-01T00:00:00.000Z', name: 'dev-main' },
          ],
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => [
          {
            body: 'Release notes',
            html_url: 'https://github.com/blockcat2333/Baker-Self-Hosted-Voice-And-Live/releases/tag/v1.0.10beta',
            tag_name: 'v1.0.10beta',
          },
        ],
        ok: true,
      });
    vi.stubGlobal('fetch', fetchMock);

    const versions = await listBakerUpdateVersions();

    expect(versions.map((version) => version.tag)).toEqual(['1.0.10beta', '1.0.4', '1.0.3']);
    expect(versions[0]).toMatchObject({
      digest: 'sha256:beta',
      isLatest: true,
      releaseNotes: 'Release notes',
      tag: '1.0.10beta',
    });
  });
});
