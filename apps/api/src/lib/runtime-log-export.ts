import { arch, platform, release, uptime } from 'node:os';

import { BAKER_VERSION } from '@baker/shared';

import {
  createDockerEngineClient,
  type DockerContainerInfo,
} from './docker-control';
import { getRuntimeHealth } from './runtime-health';

const DEFAULT_LOG_TAIL = 10_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /authorization|cookie|credential|database.?url|pass(?:word|phrase)?|private.?key|redis.?url|secret|token|x-admin-password/i;

export interface RuntimeLogExport {
  content: string;
  filename: string;
}

function redactStructuredValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactStructuredValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactStructuredValue(entryValue, entryKey),
      ]),
    );
  }
  return typeof value === 'string' ? redactFreeText(value) : value;
}

function redactFreeText(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /\b((?:https?|postgres(?:ql)?|redis):\/\/[^:\s/@]+:)[^@\s/]+@/gi,
      `$1${REDACTED}@`,
    )
    .replace(
      /([?&](?:access_token|api_key|password|secret|token)=)[^&\s]*/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /("(?:authorization|cookie|credential|database.?url|pass(?:word|phrase)?|private.?key|redis.?url|secret|token|x-admin-password)"\s*:\s*)("(?:\\.|[^"])*"|[^,}\s]+)/gi,
      `$1"${REDACTED}"`,
    )
    .replace(
      /\b((?:authorization|credential|pass(?:word|phrase)?|secret|token|x-admin-password)\s*[=:]\s*)(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      `$1${REDACTED}`,
    );
}

function redactLogLine(line: string) {
  const objectStart = line.indexOf('{');
  if (objectStart >= 0) {
    try {
      const parsed = JSON.parse(line.slice(objectStart)) as unknown;
      return `${line.slice(0, objectStart)}${JSON.stringify(
        redactStructuredValue(parsed),
      )}`;
    } catch {
      // Non-JSON service logs are handled by the text redactor below.
    }
  }
  return redactFreeText(line);
}

export function redactDiagnosticText(value: string) {
  return value.split(/\r?\n/).map(redactLogLine).join('\n');
}

export function limitDiagnosticLogSize(
  value: string,
  maximumBytes = MAX_LOG_BYTES,
) {
  const payload = Buffer.from(value, 'utf8');
  if (payload.length <= maximumBytes) {
    return value;
  }
  const retained = payload
    .subarray(payload.length - maximumBytes)
    .toString('utf8')
    .replace(/^\uFFFD/, '');
  return `[Earlier container logs omitted; retained the last ${maximumBytes} bytes.]\n${retained}`;
}

function exportFilename(generatedAt: Date) {
  const timestamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `baker-server-logs-${timestamp}.log`;
}

export async function createRuntimeLogExport(): Promise<RuntimeLogExport> {
  const generatedAt = new Date();
  const docker = createDockerEngineClient();

  let containerInfo: DockerContainerInfo = {
    currentImage: null,
    id: null,
    name: null,
  };
  let containerLogs = '';
  let dockerLogError: string | null = null;
  let runtimeHealth: unknown = null;
  let runtimeHealthError: string | null = null;

  try {
    runtimeHealth = await getRuntimeHealth();
  } catch (err) {
    runtimeHealthError = err instanceof Error ? err.message : String(err);
  }

  if (await docker.isAvailable()) {
    try {
      [containerInfo, containerLogs] = await Promise.all([
        docker.getCurrentContainerInfo(),
        docker.getCurrentContainerLogs({
          tail: DEFAULT_LOG_TAIL,
          timestamps: true,
        }),
      ]);
    } catch (err) {
      dockerLogError = err instanceof Error ? err.message : String(err);
    }
  } else {
    dockerLogError = await docker.getStatusMessage();
  }

  const summary = redactStructuredValue({
    bakerVersion: BAKER_VERSION,
    container: containerInfo,
    dockerLogAvailable: dockerLogError === null,
    dockerLogError,
    generatedAt: generatedAt.toISOString(),
    host: {
      architecture: arch(),
      nodeVersion: process.version,
      platform: platform(),
      release: release(),
      uptimeSeconds: Math.round(uptime()),
    },
    runtimeHealth,
    runtimeHealthError,
  });
  const safeLogs = limitDiagnosticLogSize(
    redactDiagnosticText(containerLogs.trimEnd()),
  );
  const logSection =
    safeLogs ||
    `[Container logs unavailable: ${redactFreeText(
      dockerLogError ?? 'No container log entries were returned.',
    )}]`;

  return {
    content: [
      'Baker server diagnostic log export',
      `Generated: ${generatedAt.toISOString()}`,
      '',
      '=== Diagnostic summary ===',
      JSON.stringify(summary, null, 2),
      '',
      `=== Container logs (last ${DEFAULT_LOG_TAIL} lines, sensitive values redacted) ===`,
      logSection,
      '',
    ].join('\n'),
    filename: exportFilename(generatedAt),
  };
}
