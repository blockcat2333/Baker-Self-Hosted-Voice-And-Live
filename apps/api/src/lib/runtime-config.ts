import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface DeploymentRuntimeSettings {
  adminHostPort: number;
  allowedHosts: string;
  sfuAnnouncedIp: string;
  sfuEnableTcp: boolean;
  sfuRtcMaxPort: number;
  sfuRtcMinPort: number;
  stunUrls: string;
  turnEnabled: boolean;
  turnExternalIp: string;
  turnMaxPort: number;
  turnMinPort: number;
  turnPasswordConfigured: boolean;
  turnPort: number;
  turnRealm: string;
  turnUrls: string;
  turnUsername: string;
  webHostPort: number;
}

export interface DeploymentRuntimeUpdate {
  adminHostPort?: number;
  allowedHosts?: string;
  sfuAnnouncedIp?: string;
  sfuEnableTcp?: boolean;
  sfuRtcMaxPort?: number;
  sfuRtcMinPort?: number;
  stunUrls?: string;
  turnEnabled?: boolean;
  turnExternalIp?: string;
  turnMaxPort?: number;
  turnMinPort?: number;
  turnPassword?: string;
  turnPort?: number;
  turnRealm?: string;
  turnUrls?: string;
  turnUsername?: string;
  webHostPort?: number;
}

export interface DeploymentPendingMarker {
  changedKeys: string[];
  pendingApply: boolean;
  updatedAt: string;
}

export interface RuntimeSelfRepairSettings {
  allowContainerRepair: boolean;
  enabled: boolean;
  intervalSeconds: number;
  updatedAt: string;
}

export interface RuntimeSelfRepairSettingsUpdate {
  allowContainerRepair?: boolean;
  enabled?: boolean;
  intervalSeconds?: number;
}

type RuntimeEnv = Record<string, string>;

const defaultRuntimeDir = '/var/lib/baker/runtime';
const defaultStunUrls =
  'stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302';

export function getRuntimeDir() {
  return process.env.BAKER_RUNTIME_DIR || defaultRuntimeDir;
}

export function getRuntimeEnvPath() {
  return join(getRuntimeDir(), 'runtime.env');
}

export function getDeploymentPendingPath() {
  return join(getRuntimeDir(), 'deployment-pending.json');
}

export function getUpdateStatusPath() {
  return join(getRuntimeDir(), 'update-status.json');
}

export function getRuntimeRepairStatusPath() {
  return join(getRuntimeDir(), 'runtime-repair-status.json');
}

export function getRuntimeRepairLockPath() {
  return join(getRuntimeDir(), 'runtime-repair.lock');
}

export function getRuntimeSelfRepairSettingsPath() {
  return join(getRuntimeDir(), 'self-repair.json');
}

function decodeShellValue(input: string) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("'")) {
    return trimmed.replace(/^"|"$/g, '');
  }

  let output = '';
  let index = 0;
  while (index < trimmed.length) {
    const char = trimmed[index];
    if (char === "'") {
      index += 1;
      while (index < trimmed.length && trimmed[index] !== "'") {
        output += trimmed[index];
        index += 1;
      }
      index += 1;
      continue;
    }
    if (char === '\\' && index + 1 < trimmed.length) {
      output += trimmed[index + 1];
      index += 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

export function parseRuntimeEnv(source: string): RuntimeEnv {
  const env: RuntimeEnv = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (!key || value === undefined) {
      continue;
    }
    env[key] = decodeShellValue(value);
  }
  return env;
}

function encodeShellValue(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function serializeRuntimeEnv(env: RuntimeEnv) {
  return `${Object.keys(env)
    .sort()
    .map((key) => `${key}=${encodeShellValue(env[key] ?? '')}`)
    .join('\n')}\n`;
}

async function readRuntimeEnvFromDisk(
  path = getRuntimeEnvPath(),
): Promise<RuntimeEnv> {
  try {
    return parseRuntimeEnv(await readFile(path, 'utf8'));
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return {};
    }
    throw err;
  }
}

function sourceValue(env: RuntimeEnv, key: string, fallback: string) {
  return env[key] ?? process.env[key] ?? fallback;
}

function readInt(env: RuntimeEnv, key: string, fallback: number) {
  const raw = sourceValue(env, key, String(fallback));
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readBoolean(env: RuntimeEnv, key: string, fallback: boolean) {
  const raw = sourceValue(env, key, fallback ? 'true' : 'false')
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }
  return fallback;
}

export function toDeploymentRuntimeSettings(
  env: RuntimeEnv,
): DeploymentRuntimeSettings {
  return {
    adminHostPort: readInt(env, 'ADMIN_HTTP_PORT', 3001),
    allowedHosts: sourceValue(
      env,
      'ALLOWED_HOSTS',
      sourceValue(env, 'VITE_ALLOWED_HOSTS', ''),
    ),
    sfuAnnouncedIp: sourceValue(env, 'SFU_ANNOUNCED_IP', ''),
    sfuEnableTcp: readBoolean(env, 'SFU_ENABLE_TCP', true),
    sfuRtcMaxPort: readInt(env, 'SFU_RTC_MAX_PORT', 50100),
    sfuRtcMinPort: readInt(env, 'SFU_RTC_MIN_PORT', 50000),
    stunUrls: sourceValue(env, 'STUN_URLS', defaultStunUrls),
    turnEnabled: readBoolean(env, 'TURN_ENABLED', false),
    turnExternalIp: sourceValue(env, 'TURN_EXTERNAL_IP', ''),
    turnMaxPort: readInt(env, 'TURN_MAX_PORT', 49200),
    turnMinPort: readInt(env, 'TURN_MIN_PORT', 49160),
    turnPasswordConfigured: sourceValue(env, 'TURN_PASSWORD', '').length > 0,
    turnPort: readInt(env, 'TURN_PORT', 3478),
    turnRealm: sourceValue(env, 'TURN_REALM', 'baker'),
    turnUrls: sourceValue(env, 'TURN_URLS', ''),
    turnUsername: sourceValue(env, 'TURN_USERNAME', ''),
    webHostPort: readInt(env, 'WEB_PORT', 3000),
  };
}

export async function readDeploymentRuntimeSettings() {
  return toDeploymentRuntimeSettings(await readRuntimeEnvFromDisk());
}

function setRuntimeValue(
  env: RuntimeEnv,
  key: string,
  value: string | number | boolean | undefined,
) {
  if (value === undefined) {
    return;
  }
  env[key] = String(value);
}

export async function updateDeploymentRuntimeSettings(
  input: DeploymentRuntimeUpdate,
) {
  const path = getRuntimeEnvPath();
  const env = await readRuntimeEnvFromDisk(path);

  setRuntimeValue(env, 'ADMIN_HTTP_PORT', input.adminHostPort);
  setRuntimeValue(env, 'ALLOWED_HOSTS', input.allowedHosts);
  setRuntimeValue(env, 'VITE_ALLOWED_HOSTS', input.allowedHosts);
  setRuntimeValue(env, 'SFU_ANNOUNCED_IP', input.sfuAnnouncedIp);
  setRuntimeValue(env, 'SFU_ENABLE_TCP', input.sfuEnableTcp);
  setRuntimeValue(env, 'SFU_RTC_MAX_PORT', input.sfuRtcMaxPort);
  setRuntimeValue(env, 'SFU_RTC_MIN_PORT', input.sfuRtcMinPort);
  setRuntimeValue(env, 'STUN_URLS', input.stunUrls);
  setRuntimeValue(env, 'TURN_ENABLED', input.turnEnabled);
  setRuntimeValue(env, 'TURN_EXTERNAL_IP', input.turnExternalIp);
  setRuntimeValue(env, 'TURN_MAX_PORT', input.turnMaxPort);
  setRuntimeValue(env, 'TURN_MIN_PORT', input.turnMinPort);
  setRuntimeValue(env, 'TURN_PASSWORD', input.turnPassword);
  setRuntimeValue(env, 'TURN_PORT', input.turnPort);
  setRuntimeValue(env, 'TURN_REALM', input.turnRealm);
  setRuntimeValue(env, 'TURN_URLS', input.turnUrls);
  setRuntimeValue(env, 'TURN_USERNAME', input.turnUsername);
  setRuntimeValue(env, 'WEB_PORT', input.webHostPort);

  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, serializeRuntimeEnv(env), { mode: 0o600 });
  await rename(tmpPath, path);
  await writeDeploymentPendingMarker(Object.keys(input));

  return toDeploymentRuntimeSettings(env);
}

export async function readDeploymentPendingMarker(
  path = getDeploymentPendingPath(),
): Promise<DeploymentPendingMarker | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path, 'utf8'),
    ) as Partial<DeploymentPendingMarker>;
    return {
      changedKeys: Array.isArray(parsed.changedKeys)
        ? parsed.changedKeys.filter(
            (key): key is string => typeof key === 'string',
          )
        : [],
      pendingApply: parsed.pendingApply === true,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date(0).toISOString(),
    };
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return null;
    }
    throw err;
  }
}

export async function writeDeploymentPendingMarker(
  changedKeys: string[] = [],
  path = getDeploymentPendingPath(),
) {
  const existing = await readDeploymentPendingMarker(path);
  const mergedKeys = Array.from(
    new Set([...(existing?.changedKeys ?? []), ...changedKeys]),
  ).sort();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        changedKeys: mergedKeys,
        pendingApply: true,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

export async function clearDeploymentPendingMarker(
  path = getDeploymentPendingPath(),
) {
  await rm(path, { force: true });
}

export async function hasDeploymentPendingMarker(
  path = getDeploymentPendingPath(),
) {
  return (await readDeploymentPendingMarker(path))?.pendingApply === true;
}

function defaultRuntimeSelfRepairSettings(): RuntimeSelfRepairSettings {
  return {
    allowContainerRepair: true,
    enabled: false,
    intervalSeconds: 60,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function readRuntimeSelfRepairSettings(
  path = getRuntimeSelfRepairSettingsPath(),
): Promise<RuntimeSelfRepairSettings> {
  try {
    const parsed = JSON.parse(
      await readFile(path, 'utf8'),
    ) as Partial<RuntimeSelfRepairSettings>;
    const defaults = defaultRuntimeSelfRepairSettings();
    const intervalSeconds =
      Number.isInteger(parsed.intervalSeconds) &&
      typeof parsed.intervalSeconds === 'number' &&
      parsed.intervalSeconds >= 30 &&
      parsed.intervalSeconds <= 86_400
        ? parsed.intervalSeconds
        : defaults.intervalSeconds;

    return {
      allowContainerRepair:
        typeof parsed.allowContainerRepair === 'boolean'
          ? parsed.allowContainerRepair
          : defaults.allowContainerRepair,
      enabled:
        typeof parsed.enabled === 'boolean' ? parsed.enabled : defaults.enabled,
      intervalSeconds,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : defaults.updatedAt,
    };
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      return defaultRuntimeSelfRepairSettings();
    }
    throw err;
  }
}

export async function updateRuntimeSelfRepairSettings(
  input: RuntimeSelfRepairSettingsUpdate,
  path = getRuntimeSelfRepairSettingsPath(),
) {
  const current = await readRuntimeSelfRepairSettings(path);
  const next: RuntimeSelfRepairSettings = {
    ...current,
    ...input,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(tmpPath, path);
  return next;
}
