import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

function resolveShellPath() {
  if (process.platform !== 'win32') {
    return 'sh';
  }

  const candidates = [
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files (x86)\\Git\\bin\\sh.exe',
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function toPosixPath(path: string) {
  return path.replace(/\\/g, '/');
}

const shellPath = resolveShellPath();
const maybeIt = shellPath ? it : it.skip;

describe('docker runtime node-service-entrypoint', () => {
  maybeIt('keeps runtime-managed media addresses from runtime.env', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'baker-node-entrypoint-'));

    try {
      const runtimeDir = join(tempDir, 'runtime');
      mkdirSync(runtimeDir, { recursive: true });

      const libSource = readFileSync(resolve('docker/runtime/lib.sh'), 'utf8');
      const entrypointSource = readFileSync(resolve('docker/runtime/node-service-entrypoint.sh'), 'utf8');

      const tempLibPath = join(tempDir, 'lib.sh');
      const tempEntrypointPath = join(tempDir, 'node-service-entrypoint.sh');

      writeFileSync(tempLibPath, libSource);
      writeFileSync(
        join(runtimeDir, 'runtime.env'),
        [
          "TURN_ENABLED='true'",
          "TURN_URLS=''",
          "TURN_EXTERNAL_IP='198.51.100.77'",
          "SFU_ANNOUNCED_IP='198.51.100.77'",
          "TURN_USERNAME='runtime-user'",
          "TURN_PASSWORD='runtime-pass'",
          "TURN_PORT='3478'",
          "STUN_URLS='stun:runtime.example.com:3478'",
          '',
        ].join('\n'),
      );

      writeFileSync(
        tempEntrypointPath,
        entrypointSource.replace('/opt/baker-runtime/lib.sh', toPosixPath(tempLibPath)),
      );

      chmodSync(tempLibPath, 0o755);
      chmodSync(tempEntrypointPath, 0o755);

      const result = spawnSync(
        shellPath as string,
        [
          tempEntrypointPath,
          'node',
          '-e',
          [
            'process.stdout.write(JSON.stringify({',
            'SFU_ANNOUNCED_IP: process.env.SFU_ANNOUNCED_IP,',
            'STUN_URLS: process.env.STUN_URLS,',
            'TURN_EXTERNAL_IP: process.env.TURN_EXTERNAL_IP,',
            'TURN_PASSWORD: process.env.TURN_PASSWORD,',
            'TURN_PORT: process.env.TURN_PORT,',
            'TURN_URLS: process.env.TURN_URLS,',
            'TURN_USERNAME: process.env.TURN_USERNAME',
            '}))',
          ].join(''),
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            BAKER_RUNTIME_DIR: runtimeDir,
            POSTGRES_DB: 'baker',
            POSTGRES_PASSWORD: 'postgres-pass',
            POSTGRES_USER: 'postgres-user',
            SFU_ANNOUNCED_IP: '192.0.2.10',
            STUN_URLS: 'stun:override.example.com:3478',
            TURN_EXTERNAL_IP: '192.0.2.10',
            TURN_PASSWORD: 'override-pass',
            TURN_PORT: '5349',
            TURN_URLS: 'turn:old.example.com:3478?transport=udp',
            TURN_USERNAME: 'override-user',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        SFU_ANNOUNCED_IP: '198.51.100.77',
        STUN_URLS: 'stun:override.example.com:3478',
        TURN_EXTERNAL_IP: '198.51.100.77',
        TURN_PASSWORD: 'override-pass',
        TURN_PORT: '5349',
        TURN_URLS:
          'turn:198.51.100.77:5349?transport=udp,turn:198.51.100.77:5349?transport=tcp',
        TURN_USERNAME: 'override-user',
      });
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
