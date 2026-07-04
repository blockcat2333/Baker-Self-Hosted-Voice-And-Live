import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

describe('docker all-in-one lib', () => {
  maybeIt('does not restore stale Docker env for runtime-managed media addresses', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'baker-allinone-lib-'));

    try {
      const runtimeLibSource = readFileSync(resolve('docker/runtime/lib.sh'), 'utf8');
      const allInOneLibSource = readFileSync(resolve('docker/allinone/lib.sh'), 'utf8');

      const tempRuntimeLibPath = join(tempDir, 'runtime-lib.sh');
      const tempAllInOneLibPath = join(tempDir, 'allinone-lib.sh');

      writeFileSync(tempRuntimeLibPath, runtimeLibSource);
      writeFileSync(tempAllInOneLibPath, allInOneLibSource);

      const result = spawnSync(
        shellPath as string,
        [
          '-c',
          [
            'set -eu',
            `. "${toPosixPath(tempRuntimeLibPath)}"`,
            `. "${toPosixPath(tempAllInOneLibPath)}"`,
            "export TURN_ENABLED='true'",
            "export TURN_URLS='turn:old.example.com:3478?transport=udp'",
            "export TURN_EXTERNAL_IP='192.0.2.10'",
            "export SFU_ANNOUNCED_IP='192.0.2.10'",
            "export STUN_URLS='stun:override.example.com:3478'",
            "export TURN_USERNAME='override-user'",
            "export TURN_PASSWORD='override-pass'",
            "export TURN_PORT='5349'",
            'capture_turn_runtime_overrides',
            'clear_runtime_managed_media_env',
            "export TURN_URLS=''",
            "export TURN_EXTERNAL_IP='198.51.100.88'",
            "export SFU_ANNOUNCED_IP='198.51.100.88'",
            "export STUN_URLS='stun:runtime.example.com:3478'",
            "export TURN_USERNAME='runtime-user'",
            "export TURN_PASSWORD='runtime-pass'",
            "export TURN_PORT='3478'",
            'apply_turn_runtime_overrides',
            'default_turn_urls_if_needed',
            [
              'node -e "process.stdout.write(JSON.stringify({',
              'SFU_ANNOUNCED_IP: process.env.SFU_ANNOUNCED_IP,',
              'STUN_URLS: process.env.STUN_URLS,',
              'TURN_EXTERNAL_IP: process.env.TURN_EXTERNAL_IP,',
              'TURN_PASSWORD: process.env.TURN_PASSWORD,',
              'TURN_PORT: process.env.TURN_PORT,',
              'TURN_URLS: process.env.TURN_URLS,',
              'TURN_USERNAME: process.env.TURN_USERNAME',
              '}))"',
            ].join(''),
          ].join('\n'),
        ],
        { encoding: 'utf8' },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        SFU_ANNOUNCED_IP: '198.51.100.88',
        STUN_URLS: 'stun:override.example.com:3478',
        TURN_EXTERNAL_IP: '198.51.100.88',
        TURN_PASSWORD: 'override-pass',
        TURN_PORT: '5349',
        TURN_URLS:
          'turn:198.51.100.88:5349?transport=udp,turn:198.51.100.88:5349?transport=tcp',
        TURN_USERNAME: 'override-user',
      });
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
