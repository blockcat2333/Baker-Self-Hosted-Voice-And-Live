import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';

import type {
  AdminRuntimeManagedServiceName,
  AdminRuntimePublicIpCheckResult,
} from '@baker/protocol';

import {
  readRuntimeEnvFromDisk,
  readRuntimePublicIpSettings,
  toDeploymentRuntimeSettings,
  writeRuntimeEnvToDisk,
  writeRuntimePublicIpSettings,
  type RuntimePublicIpSettings,
} from './runtime-config';

const execFileAsync = promisify(execFile);
const supervisorConfigPath =
  process.env.BAKER_SUPERVISOR_CONFIG ?? '/etc/baker/supervisord.conf';
const supervisorctlCommand =
  process.env.BAKER_SUPERVISORCTL_COMMAND ?? 'supervisorctl';
const defaultPublicIpEndpoints = [
  'https://api.ipify.org?format=json',
  'https://ifconfig.me/ip',
  'https://checkip.amazonaws.com',
];

function nowIso() {
  return new Date().toISOString();
}

function publicIpEndpoints() {
  return (process.env.BAKER_PUBLIC_IP_ENDPOINTS ?? '')
    .split(',')
    .map((endpoint) => endpoint.trim())
    .filter(Boolean)
    .concat(defaultPublicIpEndpoints);
}

function parseIpFromBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const json = JSON.parse(trimmed) as { ip?: unknown };
    if (typeof json.ip === 'string') {
      return json.ip.trim();
    }
  } catch {
    // Plain-text endpoints are expected.
  }

  const firstToken = trimmed.split(/\s+/)[0];
  return firstToken?.trim() || null;
}

export function isValidDetectedPublicIp(value: string) {
  return net.isIP(value.trim()) !== 0;
}

export function buildAutoTurnUrls(ip: string, port: number) {
  const host = net.isIP(ip) === 6 ? `[${ip}]` : ip;
  return `turn:${host}:${port}?transport=udp,turn:${host}:${port}?transport=tcp`;
}

export async function detectPublicIp(timeoutMs = 4000) {
  const errors: string[] = [];

  for (const endpoint of publicIpEndpoints()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      if (!response.ok) {
        errors.push(`${endpoint} returned HTTP ${response.status}.`);
        continue;
      }

      const ip = parseIpFromBody(await response.text());
      if (ip && isValidDetectedPublicIp(ip)) {
        return ip;
      }
      errors.push(`${endpoint} returned an invalid IP address.`);
    } catch (err) {
      errors.push(
        `${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    errors.length > 0
      ? errors.join(' ')
      : 'No public IP detection endpoints are configured.',
  );
}

async function restartSupervisorService(service: AdminRuntimeManagedServiceName) {
  await execFileAsync(
    supervisorctlCommand,
    ['-c', supervisorConfigPath, 'restart', service],
    {
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

function shouldUpdateAutoTurnUrls(input: {
  currentTurnExternalIp: string;
  currentTurnUrls: string;
  lastAppliedIp: string | null;
  turnPort: number;
}) {
  if (!input.currentTurnUrls) {
    return true;
  }
  if (
    input.currentTurnUrls ===
    buildAutoTurnUrls(input.currentTurnExternalIp, input.turnPort)
  ) {
    return true;
  }
  if (!input.lastAppliedIp) {
    return false;
  }
  return (
    input.currentTurnUrls ===
    buildAutoTurnUrls(input.lastAppliedIp, input.turnPort)
  );
}

async function writeDetectionFailure(
  current: RuntimePublicIpSettings,
  error: string,
) {
  return writeRuntimePublicIpSettings({
    ...current,
    lastCheckedAt: nowIso(),
    lastError: error,
    updatedAt: nowIso(),
  });
}

export async function checkAndApplyRuntimePublicIp(): Promise<AdminRuntimePublicIpCheckResult> {
  const current = await readRuntimePublicIpSettings();
  let detectedIp: string;

  try {
    detectedIp = await detectPublicIp();
  } catch (err) {
    const settings = await writeDetectionFailure(
      current,
      err instanceof Error ? err.message : String(err),
    );
    return {
      applied: false,
      changed: false,
      restartedServices: [],
      settings,
    };
  }

  const env = await readRuntimeEnvFromDisk();
  const deployment = toDeploymentRuntimeSettings(env);
  const nextEnv = { ...env };
  const servicesToRestart = new Set<AdminRuntimeManagedServiceName>();
  const checkedAt = nowIso();

  if (deployment.turnEnabled) {
    if (deployment.turnExternalIp !== detectedIp) {
      nextEnv['TURN_EXTERNAL_IP'] = detectedIp;
      servicesToRestart.add('turn');
      servicesToRestart.add('media');
    }

    const nextTurnUrls = buildAutoTurnUrls(detectedIp, deployment.turnPort);
    if (
      shouldUpdateAutoTurnUrls({
        currentTurnExternalIp: deployment.turnExternalIp,
        currentTurnUrls: deployment.turnUrls,
        lastAppliedIp: current.lastAppliedIp,
        turnPort: deployment.turnPort,
      }) &&
      deployment.turnUrls !== nextTurnUrls
    ) {
      nextEnv['TURN_URLS'] = nextTurnUrls;
      servicesToRestart.add('media');
    }
  }

  if (
    deployment.sfuAnnouncedIp &&
    deployment.sfuAnnouncedIp !== detectedIp
  ) {
    nextEnv['SFU_ANNOUNCED_IP'] = detectedIp;
    servicesToRestart.add('media');
  }

  const changed = servicesToRestart.size > 0;
  const restartedServices: AdminRuntimeManagedServiceName[] = [];
  const restartErrors: string[] = [];

  if (changed) {
    await writeRuntimeEnvToDisk(nextEnv);
    for (const service of servicesToRestart) {
      try {
        await restartSupervisorService(service);
        restartedServices.push(service);
      } catch (err) {
        restartErrors.push(
          `${service}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const settings = await writeRuntimePublicIpSettings({
    ...current,
    lastAppliedAt: changed ? nowIso() : current.lastAppliedAt,
    lastAppliedIp: changed ? detectedIp : current.lastAppliedIp,
    lastCheckedAt: checkedAt,
    lastDetectedIp: detectedIp,
    lastError:
      restartErrors.length > 0
        ? `Runtime config was updated, but service restart failed: ${restartErrors.join(' ')}`
        : null,
    updatedAt: nowIso(),
  });

  return {
    applied: changed,
    changed,
    restartedServices,
    settings,
  };
}
