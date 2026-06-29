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
  'https://ip.3322.net',
  'https://myip.ipip.net',
  'https://ifconfig.co/ip',
  'https://api.ipify.org?format=json',
  'https://ifconfig.me/ip',
  'https://checkip.amazonaws.com',
];
const restartFailurePrefix =
  'Runtime config requires a service restart, but service restart failed:';
const legacyRestartFailurePrefix =
  'Runtime config was updated, but service restart failed:';

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

export function parseIpFromBody(body: string) {
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

  const tokens = trimmed.split(/\s+/);
  const embeddedIpv4 = trimmed.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  for (const candidate of [...tokens, ...embeddedIpv4]) {
    const normalized = candidate
      .trim()
      .replace(/^[^\dA-Fa-f:.]+|[^\dA-Fa-f:.]+$/g, '');
    if (normalized && isValidDetectedPublicIp(normalized)) {
      return normalized;
    }
  }

  return null;
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

function previousRestartFailed(error: string | null) {
  return (
    error?.startsWith(restartFailurePrefix) === true ||
    error?.startsWith(legacyRestartFailurePrefix) === true
  );
}

function addPendingRestartServices(input: {
  detectedIp: string;
  deployment: ReturnType<typeof toDeploymentRuntimeSettings>;
  lastAppliedIp: string | null;
  lastError: string | null;
  servicesToRestart: Set<AdminRuntimeManagedServiceName>;
}) {
  if (
    input.lastAppliedIp === input.detectedIp ||
    !previousRestartFailed(input.lastError)
  ) {
    return;
  }

  if (input.deployment.turnEnabled) {
    const currentAutoTurnUrls = buildAutoTurnUrls(
      input.detectedIp,
      input.deployment.turnPort,
    );
    if (input.deployment.turnExternalIp === input.detectedIp) {
      input.servicesToRestart.add('turn');
      input.servicesToRestart.add('media');
    } else if (input.deployment.turnUrls === currentAutoTurnUrls) {
      input.servicesToRestart.add('media');
    }
  }

  if (input.deployment.sfuAnnouncedIp === input.detectedIp) {
    input.servicesToRestart.add('media');
  }
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
  let runtimeConfigChanged = false;

  if (deployment.turnEnabled) {
    if (deployment.turnExternalIp !== detectedIp) {
      nextEnv['TURN_EXTERNAL_IP'] = detectedIp;
      servicesToRestart.add('turn');
      servicesToRestart.add('media');
      runtimeConfigChanged = true;
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
      runtimeConfigChanged = true;
    }
  }

  if (
    deployment.sfuAnnouncedIp &&
    deployment.sfuAnnouncedIp !== detectedIp
  ) {
    nextEnv['SFU_ANNOUNCED_IP'] = detectedIp;
    servicesToRestart.add('media');
    runtimeConfigChanged = true;
  }

  addPendingRestartServices({
    deployment,
    detectedIp,
    lastAppliedIp: current.lastAppliedIp,
    lastError: current.lastError,
    servicesToRestart,
  });

  const shouldRestartServices = servicesToRestart.size > 0;
  const restartedServices: AdminRuntimeManagedServiceName[] = [];
  const restartErrors: string[] = [];

  if (runtimeConfigChanged) {
    await writeRuntimeEnvToDisk(nextEnv);
  }

  if (shouldRestartServices) {
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

  const applied = shouldRestartServices && restartErrors.length === 0;
  const settings = await writeRuntimePublicIpSettings({
    ...current,
    lastAppliedAt: applied ? nowIso() : current.lastAppliedAt,
    lastAppliedIp: applied ? detectedIp : current.lastAppliedIp,
    lastCheckedAt: checkedAt,
    lastDetectedIp: detectedIp,
    lastError:
      restartErrors.length > 0
        ? `${restartFailurePrefix} ${restartErrors.join(' ')}`
        : null,
    updatedAt: nowIso(),
  });

  return {
    applied,
    changed: runtimeConfigChanged,
    restartedServices,
    settings,
  };
}
