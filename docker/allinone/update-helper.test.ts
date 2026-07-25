import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('docker all-in-one update helper', () => {
  it('treats update proxy as helper-only configuration', () => {
    const source = readFileSync(
      resolve('docker/allinone/update-helper.mjs'),
      'utf8',
    );

    expect(source).toContain(
      "const updateProxyUrl = process.env.BAKER_UPDATE_PROXY_URL ?? ''",
    );
    expect(source).toContain("'BAKER_UPDATE_PROXY_URL'");
    expect(source).toContain(
      'Docker image pulls are performed by the host Docker daemon',
    );
  });

  it('keeps media-region profile settings managed by runtime env', () => {
    const source = readFileSync(
      resolve('docker/allinone/update-helper.mjs'),
      'utf8',
    );

    expect(source).toContain("'MEDIA_REGION_PROFILES'");
    expect(source).toContain('function sfuPortRanges(settings)');
    expect(source).toContain('settings.mediaRegionProfiles');
  });
});
