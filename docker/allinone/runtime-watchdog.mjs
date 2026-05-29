import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const runtimeDir = process.env.BAKER_RUNTIME_DIR || '/var/lib/baker/runtime';
const runtimeEnvPath = `${runtimeDir}/runtime.env`;
const selfRepairPath = `${runtimeDir}/self-repair.json`;
const repairStatusPath = `${runtimeDir}/runtime-repair-status.json`;
const repairLockPath = `${runtimeDir}/runtime-repair.lock`;
const updateStatusPath = `${runtimeDir}/update-status.json`;
const supervisorConfigPath =
  process.env.BAKER_SUPERVISOR_CONFIG || '/etc/baker/supervisord.conf';
const dockerSocketPath =
  process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const bakerImageRepository =
  process.env.BAKER_IMAGE_REPOSITORY || 'blockcat233/baker';
const bakerVersion = process.env.BAKER_VERSION || 'latest';
const repairLockStaleMs = 15 * 60 * 1000;

const serviceOrder = [
  'postgres',
  'redis',
  'media',
  'api',
  'gateway',
  'caddy',
  'turn',
];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseRuntimeEnv(source) {
  const env = {};
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = decodeShellValue(rawValue);
  }
  return env;
}

function decodeShellValue(input) {
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

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function readSettings() {
  const raw = await readJson(selfRepairPath, null);
  return {
    allowContainerRepair:
      typeof raw?.allowContainerRepair === 'boolean'
        ? raw.allowContainerRepair
        : true,
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : false,
    intervalSeconds:
      Number.isInteger(raw?.intervalSeconds) &&
      raw.intervalSeconds >= 30 &&
      raw.intervalSeconds <= 86_400
        ? raw.intervalSeconds
        : 60,
    updatedAt:
      typeof raw?.updatedAt === 'string'
        ? raw.updatedAt
        : new Date(0).toISOString(),
  };
}

async function readRuntimeSettings() {
  let env = {};
  try {
    env = parseRuntimeEnv(await readFile(runtimeEnvPath, 'utf8'));
  } catch {
    env = {};
  }

  const value = (key, fallback) => env[key] ?? process.env[key] ?? fallback;
  const numberValue = (key, fallback) => {
    const parsed = Number(value(key, String(fallback)));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    adminHostPort: numberValue('ADMIN_HTTP_PORT', 3001),
    allowedHosts: value('ALLOWED_HOSTS', value('VITE_ALLOWED_HOSTS', '')),
    sfuAnnouncedIp: value('SFU_ANNOUNCED_IP', ''),
    sfuEnableTcp: parseBoolean(value('SFU_ENABLE_TCP', 'true'), true),
    sfuRtcMaxPort: numberValue('SFU_RTC_MAX_PORT', 50100),
    sfuRtcMinPort: numberValue('SFU_RTC_MIN_PORT', 50000),
    stunUrls: value(
      'STUN_URLS',
      'stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302',
    ),
    turnEnabled: parseBoolean(value('TURN_ENABLED', 'false')),
    turnExternalIp: value('TURN_EXTERNAL_IP', ''),
    turnMaxPort: numberValue('TURN_MAX_PORT', 49200),
    turnMinPort: numberValue('TURN_MIN_PORT', 49160),
    turnPasswordConfigured: value('TURN_PASSWORD', '').length > 0,
    turnPort: numberValue('TURN_PORT', 3478),
    turnRealm: value('TURN_REALM', 'baker'),
    turnUrls: value('TURN_URLS', ''),
    turnUsername: value('TURN_USERNAME', ''),
    webHostPort: numberValue('WEB_PORT', 3000),
  };
}

async function runSupervisorctl(args) {
  return execFileAsync('supervisorctl', ['-c', supervisorConfigPath, ...args], {
    timeout: 10_000,
    windowsHide: true,
  });
}

function parseSupervisorStatusOutput(output) {
  const services = new Map();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^(\S+)\s+([A-Z]+)\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, name, state, detail = ''] = match;
    services.set(name, { detail: detail.trim(), name, state });
  }
  return services;
}

async function supervisorSnapshot() {
  try {
    const { stdout } = await runSupervisorctl(['status']);
    return {
      available: true,
      error: null,
      services: parseSupervisorStatusOutput(stdout),
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
      services: new Map(),
    };
  }
}

function okProbe(responseTimeMs) {
  return { checked: true, error: null, ok: true, responseTimeMs };
}

function failedProbe(error, responseTimeMs = null) {
  return { checked: true, error, ok: false, responseTimeMs };
}

async function probeTcp(host, port, timeoutMs = 800) {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (probe) => {
      socket.destroy();
      resolve(probe);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(okProbe(Date.now() - started)));
    socket.once('timeout', () =>
      done(failedProbe(`Timed out connecting to ${host}:${port}.`)),
    );
    socket.once('error', (err) =>
      done(failedProbe(err.message, Date.now() - started)),
    );
  });
}

async function probeHttp(urls, timeoutMs = 900) {
  const started = Date.now();
  const errors = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) errors.push(`${url} returned HTTP ${response.status}.`);
    } catch (err) {
      errors.push(
        `${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  const responseTimeMs = Date.now() - started;
  return errors.length === 0
    ? okProbe(responseTimeMs)
    : failedProbe(errors.join(' '), responseTimeMs);
}

async function serviceHealth(settings, supervisor) {
  const definitions = [
    ['postgres', () => probeTcp('127.0.0.1', 5432), false],
    ['redis', () => probeTcp('127.0.0.1', 6379), false],
    ['media', () => probeHttp(['http://127.0.0.1:3003/health']), false],
    ['api', () => probeHttp(['http://127.0.0.1:3001/health']), false],
    ['gateway', () => probeHttp(['http://127.0.0.1:3002/health']), false],
    [
      'caddy',
      () =>
        probeHttp(['http://127.0.0.1/health', 'http://127.0.0.1:8080/health']),
      false,
    ],
    [
      'turn',
      () => probeTcp('127.0.0.1', settings.turnPort),
      !settings.turnEnabled,
    ],
  ];

  const entries = await Promise.all(
    definitions.map(async ([name, probe, disabled]) => {
      if (disabled) return [name, 'disabled'];
      const state = supervisor.services.get(name)?.state ?? null;
      const result = await probe();
      if (supervisor.available && state && state !== 'RUNNING')
        return [name, 'stopped'];
      if (result.ok === true) return [name, 'healthy'];
      return [name, 'degraded'];
    }),
  );
  return new Map(entries);
}

function repairTargets(health) {
  return serviceOrder.filter((service) =>
    ['degraded', 'stopped'].includes(health.get(service)),
  );
}

async function updateRunning() {
  const status = await readJson(updateStatusPath, null);
  return status?.status === 'running';
}

async function repairLockExists() {
  try {
    await access(repairLockPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeStaleRepairLock() {
  try {
    const lockStat = await stat(repairLockPath);
    if (Date.now() - lockStat.mtimeMs > repairLockStaleMs) {
      await rm(repairLockPath, { force: true });
    }
  } catch {
    // Missing lock is fine.
  }
}

async function withRepairLock(operation) {
  await mkdir(dirname(repairLockPath), { recursive: true });
  await removeStaleRepairLock();
  let handle;
  try {
    handle = await open(repairLockPath, 'wx');
  } catch {
    return null;
  }
  try {
    await handle.writeFile(
      JSON.stringify(
        { pid: process.pid, startedAt: nowIso(), trigger: 'self' },
        null,
        2,
      ),
    );
    return await operation();
  } finally {
    await handle.close();
    await rm(repairLockPath, { force: true });
  }
}

async function docker(method, path, body) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        headers: payload
          ? {
              'Content-Length': Buffer.byteLength(payload),
              'Content-Type': 'application/json',
            }
          : undefined,
        method,
        path,
        socketPath: dockerSocketPath,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(text || `Docker API ${response.statusCode}`));
            return;
          }
          resolve(text ? JSON.parse(text) : {});
        });
      },
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function dockerText(method, path, body) {
  return docker(method, path, body).then(() => '');
}

async function dockerAvailable() {
  try {
    await access(dockerSocketPath, constants.F_OK);
    const response = await new Promise((resolve, reject) => {
      const request = http.request(
        { method: 'GET', path: '/_ping', socketPath: dockerSocketPath },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        },
      );
      request.on('error', reject);
      request.end();
    });
    return String(response).trim() === 'OK';
  } catch {
    return false;
  }
}

function readContainerHostPort(inspect, containerPort) {
  const binding = inspect?.HostConfig?.PortBindings?.[
    `${containerPort}/tcp`
  ]?.find((entry) => entry?.HostPort);
  const value = Number(binding?.HostPort);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function imageTagFromImage(image) {
  if (!image) return bakerVersion;
  const marker = `${bakerImageRepository}:`;
  if (image.startsWith(marker))
    return image.slice(marker.length) || bakerVersion;
  const tag = image.split(':').at(-1);
  return tag && !tag.includes('/') ? tag : bakerVersion;
}

function buildHelperBinds(inspect) {
  const binds = new Set([`${dockerSocketPath}:/var/run/docker.sock`]);
  for (const bind of inspect.HostConfig?.Binds ?? []) {
    if (bind.includes(':/var/lib/baker')) binds.add(bind);
  }
  const dataMount = inspect.Mounts?.find(
    (mount) => mount.Destination === '/var/lib/baker',
  );
  if (
    dataMount &&
    !Array.from(binds).some((bind) => bind.includes(':/var/lib/baker'))
  ) {
    if (dataMount.Type === 'volume' && dataMount.Name) {
      binds.add(`${dataMount.Name}:/var/lib/baker`);
    } else if (dataMount.Source) {
      binds.add(
        `${dataMount.Source}:/var/lib/baker${dataMount.RW === false ? ':ro' : ''}`,
      );
    }
  }
  return Array.from(binds);
}

async function startContainerRepair(settings) {
  if (!(await dockerAvailable()))
    throw new Error('Docker socket is unavailable.');
  const currentContainer =
    process.env.HOSTNAME || (await readFile('/etc/hostname', 'utf8')).trim();
  const inspect = await docker(
    'GET',
    `/containers/${encodeURIComponent(currentContainer)}/json`,
  );
  const targetImage =
    inspect?.Config?.Image || `${bakerImageRepository}:${bakerVersion}`;
  const targetTag = imageTagFromImage(targetImage);
  const desiredSettings = {
    ...settings,
    adminHostPort:
      readContainerHostPort(inspect, 8080) ?? settings.adminHostPort,
    webHostPort: readContainerHostPort(inspect, 80) ?? settings.webHostPort,
  };
  const jobId = randomUUID();
  const helperName = `baker-update-${jobId.slice(0, 12)}`;
  const created = await docker(
    'POST',
    `/containers/create?name=${encodeURIComponent(helperName)}`,
    {
      Entrypoint: ['node', '/opt/baker-allinone/update-helper.mjs'],
      Env: [
        `BAKER_UPDATE_CURRENT_CONTAINER=${inspect.Id}`,
        `BAKER_UPDATE_DESIRED_SETTINGS=${JSON.stringify(desiredSettings)}`,
        `BAKER_UPDATE_JOB_ID=${jobId}`,
        `BAKER_UPDATE_PREVIOUS_SETTINGS=${JSON.stringify(desiredSettings)}`,
        'BAKER_UPDATE_PULL_POLICY=never',
        `BAKER_UPDATE_STATUS_FILE=${updateStatusPath}`,
        `BAKER_UPDATE_TARGET_IMAGE=${targetImage}`,
        `BAKER_UPDATE_TARGET_TAG=${targetTag}`,
      ],
      HostConfig: {
        AutoRemove: true,
        Binds: buildHelperBinds(inspect),
        RestartPolicy: { Name: 'no' },
      },
      Image: targetImage,
      Labels: {
        'org.baker.role': 'update-helper',
        'org.baker.update-job': jobId,
      },
    },
  );
  if (!created.Id) throw new Error('Docker did not return a helper id.');
  await dockerText(
    'POST',
    `/containers/${encodeURIComponent(created.Id)}/start`,
  );
}

async function repairOnce(settings) {
  return withRepairLock(async () => {
    const startedAt = nowIso();
    const supervisor = await supervisorSnapshot();
    if (!supervisor.available || (await updateRunning())) return null;
    const runtimeSettings = await readRuntimeSettings();
    const health = await serviceHealth(runtimeSettings, supervisor);
    const targets = repairTargets(health);
    if (targets.length === 0) return null;

    const actions = [];
    for (const service of targets) {
      const actionStartedAt = nowIso();
      try {
        await runSupervisorctl(['restart', service]);
        actions.push({
          action: 'restart',
          finishedAt: nowIso(),
          message: `${service} restarted through supervisor.`,
          service,
          startedAt: actionStartedAt,
          status: 'succeeded',
        });
      } catch (err) {
        actions.push({
          action: 'restart',
          finishedAt: nowIso(),
          message: err instanceof Error ? err.message : String(err),
          service,
          startedAt: actionStartedAt,
          status: 'failed',
        });
      }
      await sleep(1000);
    }

    await sleep(1500);
    const nextHealth = await serviceHealth(
      runtimeSettings,
      await supervisorSnapshot(),
    );
    const remaining = repairTargets(nextHealth);
    let containerRepairStarted = false;
    let status = remaining.length === 0 ? 'succeeded' : 'failed';
    let message =
      remaining.length === 0
        ? 'Runtime services were repaired successfully.'
        : `Services still unhealthy after restart: ${remaining.join(', ')}.`;

    if (remaining.length > 0 && settings.allowContainerRepair) {
      try {
        await startContainerRepair(runtimeSettings);
        containerRepairStarted = true;
        status = 'partial';
        message = `${message} Container repair helper was started.`;
      } catch (err) {
        message = `${message} Container repair could not start: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }

    const result = {
      actions,
      completedAt: nowIso(),
      containerRepairStarted,
      message,
      startedAt,
      status,
      trigger: 'self',
    };
    await writeJson(repairStatusPath, result);
    return result;
  });
}

async function main() {
  for (;;) {
    try {
      const settings = await readSettings();
      if (
        !settings.enabled ||
        (await repairLockExists()) ||
        (await updateRunning())
      ) {
        await sleep(10_000);
        continue;
      }
      await repairOnce(settings);
      await sleep(settings.intervalSeconds * 1000);
    } catch (err) {
      console.error('[watchdog] self-repair loop failed:', err);
      await sleep(30_000);
    }
  }
}

void main();
