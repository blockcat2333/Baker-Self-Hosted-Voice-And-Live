import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readDeploymentPendingMarker,
  parseRuntimeEnv,
  readDeploymentRuntimeSettings,
  serializeRuntimeEnv,
  updateDeploymentRuntimeSettings,
} from './runtime-config';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runtime deployment config', () => {
  it('parses and serializes shell-style runtime.env values', () => {
    const parsed = parseRuntimeEnv("TURN_USERNAME='baker'\nTURN_PASSWORD='a'\\''b'\nWEB_PORT='3000'\n");

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
        expect.arrayContaining(['adminHostPort', 'turnEnabled', 'turnPassword', 'turnUsername', 'webHostPort']),
      );

      const reread = await readDeploymentRuntimeSettings();
      expect(reread.turnUsername).toBe('relay');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
