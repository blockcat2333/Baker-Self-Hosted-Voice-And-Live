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

  it('stops the current container before creating the replacement', () => {
    const source = readFileSync(
      resolve('docker/allinone/update-helper.mjs'),
      'utf8',
    );

    const stopIndex = source.indexOf(
      "await writeStatus('running', 'stop-current'",
    );
    const waitIndex = source.indexOf('await waitForStopped(oldName);');
    const createIndex = source.indexOf(
      "`Creating replacement container ${oldName}.`",
    );

    expect(source).toContain('async function waitForStopped(containerName)');
    expect(stopIndex).toBeGreaterThan(-1);
    expect(waitIndex).toBeGreaterThan(stopIndex);
    expect(createIndex).toBeGreaterThan(waitIndex);
  });

  it('preserves the current host IP when regenerating managed ports', () => {
    const source = readFileSync(
      resolve('docker/allinone/update-helper.mjs'),
      'utf8',
    );

    expect(source).toContain('function resolvePortHostIp(');
    expect(source).toContain('function resolveFallbackHostIp(');
    expect(source).toContain('function addManagedPort(');
    expect(source).toContain('HostIp: hostIp');
    expect(source).toContain(
      'resolvePortHostIp(currentBindings, containerPort, protocol, fallbackHostIp)',
    );
  });
});
