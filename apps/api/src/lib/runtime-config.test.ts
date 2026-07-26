import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readDeploymentPendingMarker,
  parseRuntimeEnv,
  readDeploymentRuntimeSettings,
  readRuntimePublicIpSettings,
  readRuntimeUpdateProxySettings,
  serializeRuntimeEnv,
  updateDeploymentRuntimeSettings,
  updateRuntimePublicIpSettings,
  updateRuntimeUpdateProxySettings,
} from './runtime-config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runtime deployment config', () => {
  it('parses and serializes shell-style runtime.env values', () => {
    const parsed = parseRuntimeEnv(
      "TURN_USERNAME='baker'\nTURN_PASSWORD='a'\\''b'\nWEB_PORT='3000'\n",
    );

    expect(parsed).toEqual({
      TURN_PASSWORD: "a'b",
      TURN_USERNAME: 'baker',
      WEB_PORT: '3000',
    });
    expect(serializeRuntimeEnv(parsed)).toContain("TURN_PASSWORD='a'\\''b'");
  });

  it('writes allowlisted deployment settings and keeps existing secrets', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-runtime-config-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);

    try {
      await writeFile(
        join(tempDir, 'runtime.env'),
        [
          "JWT_ACCESS_SECRET='keep-me'",
          "TURN_PASSWORD='old-secret'",
          "WEB_PORT='3000'",
          '',
        ].join('\n'),
      );

      const settings = await updateDeploymentRuntimeSettings({
        adminHostPort: 13001,
        turnEnabled: true,
        turnPassword: 'new-secret',
        turnUsername: 'relay',
        webHostPort: 13000,
      });

      expect(settings.webHostPort).toBe(13000);
      expect(settings.adminHostPort).toBe(13001);
      expect(settings.turnEnabled).toBe(true);
      expect(settings.turnPasswordConfigured).toBe(true);

      const raw = await readFile(join(tempDir, 'runtime.env'), 'utf8');
      expect(raw).toContain("JWT_ACCESS_SECRET='keep-me'");
      expect(raw).toContain("TURN_PASSWORD='new-secret'");
      expect(raw).toContain("TURN_ENABLED='true'");

      const pending = await readDeploymentPendingMarker();
      expect(pending?.pendingApply).toBe(true);
      expect(pending?.changedKeys).toEqual(
        expect.arrayContaining([
          'adminHostPort',
          'turnEnabled',
          'turnPassword',
          'turnUsername',
          'webHostPort',
        ]),
      );
      expect(pending?.previousSettings?.webHostPort).toBe(3000);
      expect(pending?.previousSettings?.turnPasswordConfigured).toBe(true);

      const reread = await readDeploymentRuntimeSettings();
      expect(reread.turnUsername).toBe('relay');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('keeps the first pending previous deployment settings across edits', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-runtime-pending-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);

    try {
      await writeFile(
        join(tempDir, 'runtime.env'),
        [
          'MEDIA_REGION_PROFILES=\'[{"id":"old","hosts":["old.example"],"sfuRtcMinPort":23305,"sfuRtcMaxPort":23400}]\'',
          "SFU_ANNOUNCED_IP='113.80.68.23'",
          "SFU_RTC_MIN_PORT='50000'",
          "SFU_RTC_MAX_PORT='50100'",
          "WEB_PORT='3000'",
          '',
        ].join('\n'),
      );

      await updateDeploymentRuntimeSettings({
        mediaRegionProfiles:
          '[{"id":"new","hosts":["new.example"],"sfuRtcMinPort":23335,"sfuRtcMaxPort":23340}]',
      });
      await updateDeploymentRuntimeSettings({
        allowedHosts: 'new.example',
      });

      const pending = await readDeploymentPendingMarker();
      expect(pending?.changedKeys).toEqual(
        expect.arrayContaining(['allowedHosts', 'mediaRegionProfiles']),
      );
      expect(pending?.previousSettings?.mediaRegionProfiles).toContain(
        'old.example',
      );
      expect(pending?.previousSettings?.mediaRegionProfiles).toContain('23305');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('persists public IP automation settings', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-runtime-public-ip-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);

    try {
      const defaults = await readRuntimePublicIpSettings();
      expect(defaults).toMatchObject({
        enabled: false,
        intervalSeconds: 300,
        lastAppliedIp: null,
      });

      const updated = await updateRuntimePublicIpSettings({
        enabled: true,
        intervalSeconds: 600,
      });
      expect(updated).toMatchObject({
        enabled: true,
        intervalSeconds: 600,
      });

      const reread = await readRuntimePublicIpSettings();
      expect(reread).toMatchObject({
        enabled: true,
        intervalSeconds: 600,
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('persists update proxy settings outside runtime.env', async () => {
    const tempDir = await mkdtemp(
      join(tmpdir(), 'baker-runtime-update-proxy-'),
    );
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);

    try {
      const defaults = await readRuntimeUpdateProxySettings();
      expect(defaults).toMatchObject({
        enabled: false,
        proxyUrl: '',
      });

      const updated = await updateRuntimeUpdateProxySettings({
        enabled: true,
        proxyUrl: ' 127.0.0.1:7890 ',
      });
      expect(updated).toMatchObject({
        enabled: true,
        proxyUrl: 'http://127.0.0.1:7890',
      });

      const reread = await readRuntimeUpdateProxySettings();
      expect(reread).toMatchObject({
        enabled: true,
        proxyUrl: 'http://127.0.0.1:7890',
      });

      await expect(
        readFile(join(tempDir, 'runtime.env'), 'utf8'),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
