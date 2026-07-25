import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
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

const shellPath = resolveShellPath();
const maybeIt = shellPath ? it : it.skip;

describe('docker all-in-one healthcheck', () => {
  maybeIt('fails when a required Supervisor service is not running', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'baker-healthcheck-'));

    try {
      const healthcheckPath = join(tempDir, 'healthcheck.sh');
      const supervisorPath = join(tempDir, 'supervisorctl');
      const curlPath = join(tempDir, 'curl');
      writeFileSync(
        healthcheckPath,
        readFileSync(resolve('docker/allinone/healthcheck.sh'), 'utf8'),
      );
      writeFileSync(
        supervisorPath,
        [
          '#!/bin/sh',
          'service="$4"',
          'if [ "$service" = "media" ]; then',
          '  echo "media FATAL Exited too quickly"',
          'else',
          '  echo "$service RUNNING pid 1, uptime 0:01:00"',
          'fi',
        ].join('\n'),
      );
      writeFileSync(curlPath, '#!/bin/sh\nexit 0\n');
      chmodSync(healthcheckPath, 0o755);
      chmodSync(supervisorPath, 0o755);
      chmodSync(curlPath, 0o755);

      const result = spawnSync(shellPath as string, [healthcheckPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${tempDir}${delimiter}${process.env.PATH ?? ''}`,
        },
      });

      expect(result.status).toBe(1);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
