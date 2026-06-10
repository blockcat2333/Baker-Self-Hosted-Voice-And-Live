import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_command, _args, _options, callback) => {
    callback(null, '', '');
  }),
}));

import { readRuntimePublicIpSettings } from './runtime-config';
import {
  buildAutoTurnUrls,
  checkAndApplyRuntimePublicIp,
} from './runtime-public-ip';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('runtime public IP automation', () => {
  it('detects a new public IP and applies managed TURN/SFU runtime settings', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-runtime-public-ip-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ip: '198.51.100.42' }),
      }),
    );

    try {
      await writeFile(
        join(tempDir, 'runtime.env'),
        [
          "JWT_ACCESS_SECRET='keep-me'",
          "SFU_ANNOUNCED_IP='203.0.113.10'",
          "TURN_ENABLED='true'",
          "TURN_EXTERNAL_IP='203.0.113.10'",
          `TURN_URLS='${buildAutoTurnUrls('203.0.113.10', 3478)}'`,
          "TURN_PORT='3478'",
          '',
        ].join('\n'),
      );

      const result = await checkAndApplyRuntimePublicIp();

      expect(result).toMatchObject({
        applied: true,
        changed: true,
      });
      expect(result.restartedServices.sort()).toEqual(['media', 'turn']);

      const raw = await readFile(join(tempDir, 'runtime.env'), 'utf8');
      expect(raw).toContain("JWT_ACCESS_SECRET='keep-me'");
      expect(raw).toContain("SFU_ANNOUNCED_IP='198.51.100.42'");
      expect(raw).toContain("TURN_EXTERNAL_IP='198.51.100.42'");
      expect(raw).toContain(
        `TURN_URLS='${buildAutoTurnUrls('198.51.100.42', 3478)}'`,
      );

      const settings = await readRuntimePublicIpSettings();
      expect(settings.lastDetectedIp).toBe('198.51.100.42');
      expect(settings.lastAppliedIp).toBe('198.51.100.42');
      expect(settings.lastError).toBeNull();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
