import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import { readRuntimePublicIpSettings } from './runtime-config';
import {
  buildAutoTurnUrls,
  checkAndApplyRuntimePublicIp,
  detectPublicIp,
  parseIpFromBody,
} from './runtime-public-ip';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('runtime public IP automation', () => {
  beforeEach(() => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '', '');
    });
  });

  it('parses plain, JSON, and localized public IP responses', () => {
    expect(parseIpFromBody('198.51.100.42\n')).toBe('198.51.100.42');
    expect(parseIpFromBody('{"ip":"198.51.100.43"}')).toBe('198.51.100.43');
    expect(
      parseIpFromBody('当前 IP：198.51.100.44 来自于：中国 广东 电信'),
    ).toBe('198.51.100.44');
  });

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

  it('does not mark the public IP applied until managed services restart', async () => {
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
          "TURN_ENABLED='true'",
          "TURN_EXTERNAL_IP='203.0.113.10'",
          `TURN_URLS='${buildAutoTurnUrls('203.0.113.10', 3478)}'`,
          "TURN_PORT='3478'",
          '',
        ].join('\n'),
      );

      execFileMock.mockImplementationOnce(
        (_command, _args, _options, callback) => {
          callback(new Error('supervisorctl failed'), '', '');
        },
      );
      execFileMock.mockImplementationOnce(
        (_command, _args, _options, callback) => {
          callback(new Error('supervisorctl failed'), '', '');
        },
      );

      const failedResult = await checkAndApplyRuntimePublicIp();

      expect(failedResult).toMatchObject({
        applied: false,
        changed: true,
        restartedServices: [],
      });
      expect(failedResult.settings.lastDetectedIp).toBe('198.51.100.42');
      expect(failedResult.settings.lastAppliedIp).toBeNull();
      expect(failedResult.settings.lastError).toContain(
        'service restart failed',
      );

      execFileMock.mockImplementation((_command, _args, _options, callback) => {
        callback(null, '', '');
      });

      const retryResult = await checkAndApplyRuntimePublicIp();

      expect(retryResult).toMatchObject({
        applied: true,
        changed: false,
      });
      expect(retryResult.restartedServices.sort()).toEqual(['media', 'turn']);
      expect(retryResult.settings.lastAppliedIp).toBe('198.51.100.42');
      expect(retryResult.settings.lastError).toBeNull();
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('does not use the saved update proxy when detecting public IP', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-runtime-public-ip-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);
    vi.stubEnv('BAKER_PUBLIC_IP_ENDPOINTS', 'https://example.test/ip');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '198.51.100.42',
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await writeFile(
        join(tempDir, 'update-proxy.json'),
        JSON.stringify({
          enabled: true,
          proxyUrl: 'http://127.0.0.1:7890',
          updatedAt: new Date(0).toISOString(),
        }),
      );

      await expect(detectPublicIp()).resolves.toBe('198.51.100.42');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(init.signal).toBeDefined();
      expect(Object.hasOwn(init, 'dispatcher')).toBe(false);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
