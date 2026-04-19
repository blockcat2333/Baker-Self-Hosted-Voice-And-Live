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
  maybeIt('preserves TURN and STUN overrides after loading runtime.env', () => {
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
          "TURN_URLS=''",
          "TURN_USERNAME='runtime-user'",
          "TURN_PASSWORD='runtime-pass'",
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
          "process.stdout.write(JSON.stringify({TURN_URLS: process.env.TURN_URLS, STUN_URLS: process.env.STUN_URLS, TURN_USERNAME: process.env.TURN_USERNAME}))",
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            BAKER_RUNTIME_DIR: runtimeDir,
            POSTGRES_DB: 'baker',
            POSTGRES_PASSWORD: 'postgres-pass',
            POSTGRES_USER: 'postgres-user',
            STUN_URLS: 'stun:override.example.com:3478',
            TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
            TURN_USERNAME: 'override-user',
          },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        STUN_URLS: 'stun:override.example.com:3478',
        TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
        TURN_USERNAME: 'override-user',
      });
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
