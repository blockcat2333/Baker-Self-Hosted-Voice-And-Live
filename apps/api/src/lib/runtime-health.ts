import { execFile } from 'node:child_process';
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
import net from 'node:net';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

import type {
  AdminRuntimeHealth,
  AdminRuntimeManagedServiceName,
  AdminRuntimeProbe,
  AdminRuntimeRepairAction,
  AdminRuntimeRepairResult,
  AdminRuntimeSelfRepairSettings,
  AdminRuntimeServiceHealth,
  AdminRuntimeServiceStatus,
} from '@baker/protocol';
import { BAKER_VERSION, parseAppEnv } from '@baker/shared';

import {
  BAKER_IMAGE_REPOSITORY,
  createDockerEngineClient,
  readContainerHostPort,
  type DockerInspectResponse,
} from './docker-control';
import {
  getRuntimeRepairLockPath,
  getRuntimeRepairStatusPath,
  readDeploymentPendingMarker,
  readDeploymentRuntimeSettings,
  readRuntimeSelfRepairSettings,
  updateRuntimeSelfRepairSettings,
  type DeploymentRuntimeSettings,
  type RuntimeSelfRepairSettingsUpdate,
} from './runtime-config';

const execFileAsync = promisify(execFile);
const supervisorConfigPath =
  process.env.BAKER_SUPERVISOR_CONFIG ?? '/etc/baker/supervisord.conf';
const supervisorctlCommand =
  process.env.BAKER_SUPERVISORCTL_COMMAND ?? 'supervisorctl';
const repairLockStaleMs = 15 * 60 * 1000;

interface SupervisorProcessStatus {
  detail: string;
  name: string;
  state: string;
}

interface SupervisorSnapshot {
  available: boolean;
  error: string | null;
  services: Map<string, SupervisorProcessStatus>;
}

interface ServiceDefinition {
  label: string;
  name: AdminRuntimeManagedServiceName;
  probe(settings: DeploymentRuntimeSettings): Promise<AdminRuntimeProbe>;
  required: boolean;
  shouldDisable?(settings: DeploymentRuntimeSettings): boolean;
}

export class RuntimeRepairLockError extends Error {
  constructor() {
    super('Another runtime repair is already in progress.');
    this.name = 'RuntimeRepairLockError';
  }
}

export const runtimeServiceOrder: AdminRuntimeManagedServiceName[] = [
  'postgres',
  'redis',
  'media',
  'api',
  'gateway',
  'caddy',
  'turn',
];

const serviceDefinitions: ServiceDefinition[] = [
  {
    label: 'PostgreSQL',
    name: 'postgres',
    probe: () => probeTcp('127.0.0.1', 5432),
    required: true,
  },
  {
    label: 'Redis',
    name: 'redis',
    probe: () => probeTcp('127.0.0.1', 6379),
    required: true,
  },
  {
    label: 'Media',
    name: 'media',
    probe: () =>
      probeHttp([`http://127.0.0.1:${parseAppEnv().MEDIA_PORT}/health`]),
    required: true,
  },
  {
    label: 'API',
    name: 'api',
    probe: () =>
      probeHttp([`http://127.0.0.1:${parseAppEnv().API_PORT}/health`]),
    required: true,
  },
  {
    label: 'Gateway',
    name: 'gateway',
    probe: () =>
      probeHttp([`http://127.0.0.1:${parseAppEnv().GATEWAY_PORT}/health`]),
    required: true,
  },
  {
    label: 'Caddy Web/Admin',
    name: 'caddy',
    probe: () =>
      probeHttp(['http://127.0.0.1/health', 'http://127.0.0.1:8080/health']),
    required: true,
  },
  {
    label: 'TURN',
    name: 'turn',
    probe: (settings) => probeTcp('127.0.0.1', settings.turnPort),
    required: false,
    shouldDisable: (settings) => !settings.turnEnabled,
  },
];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function okProbe(responseTimeMs: number): AdminRuntimeProbe {
  return {
    checked: true,
    error: null,
    ok: true,
    responseTimeMs,
  };
}

function failedProbe(
  error: string,
  responseTimeMs: number | null = null,
): AdminRuntimeProbe {
  return {
    checked: true,
    error,
    ok: false,
    responseTimeMs,
  };
}

async function probeTcp(
  host: string,
  port: number,
  timeoutMs = 800,
): Promise<AdminRuntimeProbe> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (probe: AdminRuntimeProbe) => {
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

async function probeHttp(
  urls: string[],
  timeoutMs = 900,
): Promise<AdminRuntimeProbe> {
  const started = Date.now();
  const errors: string[] = [];

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        errors.push(`${url} returned HTTP ${response.status}.`);
      }
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

export function parseSupervisorStatusOutput(output: string) {
  const services = new Map<string, SupervisorProcessStatus>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = /^(\S+)\s+([A-Z]+)\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, name, state, detail = ''] = match;
    if (!name || !state) {
      continue;
    }
    services.set(name, {
      detail: detail.trim(),
      name,
      state,
    });
  }
  return services;
}

async function runSupervisorctl(args: string[]) {
  return execFileAsync(
    supervisorctlCommand,
    ['-c', supervisorConfigPath, ...args],
    {
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

async function readSupervisorSnapshot(): Promise<SupervisorSnapshot> {
  try {
    const { stdout } = await runSupervisorctl(['status']);
    return {
      available: true,
      error: null,
      services: parseSupervisorStatusOutput(String(stdout)),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      error,
      services: new Map(),
    };
  }
}

function deriveServiceStatus(input: {
  disabled: boolean;
  probe: AdminRuntimeProbe;
  supervisor: SupervisorProcessStatus | null;
  supervisorAvailable: boolean;
}): AdminRuntimeServiceStatus {
  if (input.disabled) {
    return 'disabled';
  }

  const supervisorState = input.supervisor?.state ?? null;
  if (
    input.supervisorAvailable &&
    supervisorState &&
    supervisorState !== 'RUNNING'
  ) {
    return ['STOPPED', 'EXITED', 'FATAL', 'UNKNOWN'].includes(supervisorState)
      ? 'stopped'
      : 'degraded';
  }

  if (input.probe.checked && input.probe.ok === true) {
    return 'healthy';
  }
  if (input.probe.checked && input.probe.ok === false) {
    return input.supervisorAvailable &&
      supervisorState &&
      supervisorState !== 'RUNNING'
      ? 'stopped'
      : 'degraded';
  }
  return 'unknown';
}

function serviceMessage(service: AdminRuntimeServiceHealth) {
  if (service.status === 'disabled') {
    return `${service.label} is disabled by runtime settings.`;
  }
  if (
    service.supervisor.available &&
    service.supervisor.state &&
    service.supervisor.state !== 'RUNNING'
  ) {
    return `${service.label} supervisor state is ${service.supervisor.state}.`;
  }
  if (service.probe.ok === false && service.probe.error) {
    return service.probe.error;
  }
  if (service.status === 'healthy') {
    return `${service.label} is healthy.`;
  }
  return `${service.label} status is unknown.`;
}

async function serviceHealth(
  definition: ServiceDefinition,
  settings: DeploymentRuntimeSettings,
  supervisor: SupervisorSnapshot,
): Promise<AdminRuntimeServiceHealth> {
  const disabled = definition.shouldDisable?.(settings) === true;
  const processStatus = supervisor.services.get(definition.name) ?? null;
  const probe = disabled
    ? { checked: false, error: null, ok: null, responseTimeMs: null }
    : await definition.probe(settings);
  const status = deriveServiceStatus({
    disabled,
    probe,
    supervisor: processStatus,
    supervisorAvailable: supervisor.available,
  });

  const service: AdminRuntimeServiceHealth = {
    label: definition.label,
    message: '',
    name: definition.name,
    probe,
    required: definition.required,
    status,
    supervisor: {
      available: supervisor.available,
      detail: processStatus?.detail ?? supervisor.error,
      state: processStatus?.state ?? null,
    },
  };
  return {
    ...service,
    message: serviceMessage(service),
  };
}

export async function isRuntimeRepairRunning(
  path = getRuntimeRepairLockPath(),
) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function removeStaleRepairLock(path: string) {
  try {
    const lockStat = await stat(path);
    if (Date.now() - lockStat.mtimeMs > repairLockStaleMs) {
      await rm(path, { force: true });
    }
  } catch {
    // No lock, or not readable.
  }
}

async function withRuntimeRepairLock<T>(
  operation: () => Promise<T>,
  path = getRuntimeRepairLockPath(),
) {
  await mkdir(dirname(path), { recursive: true });
  await removeStaleRepairLock(path);

  let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fileHandle = await open(path, 'wx');
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'EEXIST'
    ) {
      throw new RuntimeRepairLockError();
    }
    throw err;
  }

  try {
    await fileHandle.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: nowIso() }, null, 2),
    );
    return await operation();
  } finally {
    await fileHandle.close();
    await rm(path, { force: true });
  }
}

export async function readRuntimeRepairStatus(
  path = getRuntimeRepairStatusPath(),
) {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as AdminRuntimeRepairResult;
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

async function writeRuntimeRepairStatus(
  result: AdminRuntimeRepairResult,
  path = getRuntimeRepairStatusPath(),
) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2), { mode: 0o600 });
}

function overallStatus(
  services: AdminRuntimeServiceHealth[],
  repairInProgress: boolean,
): AdminRuntimeHealth['overallStatus'] {
  if (repairInProgress) {
    return 'repairing';
  }
  if (
    services.some((service) => ['degraded', 'stopped'].includes(service.status))
  ) {
    return 'degraded';
  }
  if (
    services.every((service) =>
      ['healthy', 'disabled'].includes(service.status),
    )
  ) {
    return 'healthy';
  }
  return 'unknown';
}

export async function getRuntimeHealth(): Promise<AdminRuntimeHealth> {
  const docker = createDockerEngineClient();
  const [
    dockerEnabled,
    dockerStatus,
    lastRepair,
    repairInProgress,
    settings,
    supervisor,
  ] = await Promise.all([
    docker.isAvailable(),
    docker.getStatusMessage(),
    readRuntimeRepairStatus(),
    isRuntimeRepairRunning(),
    readDeploymentRuntimeSettings(),
    readSupervisorSnapshot(),
  ]);
  const services = await Promise.all(
    serviceDefinitions.map((definition) =>
      serviceHealth(definition, settings, supervisor),
    ),
  );

  return {
    checkedAt: nowIso(),
    dockerEnabled,
    dockerStatus,
    lastRepair,
    overallStatus: overallStatus(services, repairInProgress),
    repairInProgress,
    services,
    supervisorAvailable: supervisor.available,
  };
}

async function restartSupervisorService(
  service: AdminRuntimeManagedServiceName,
): Promise<AdminRuntimeRepairAction> {
  const startedAt = nowIso();
  try {
    await runSupervisorctl(['restart', service]);
    return {
      action: 'restart',
      finishedAt: nowIso(),
      message: `${service} restarted through supervisor.`,
      service,
      startedAt,
      status: 'succeeded',
    };
  } catch (err) {
    return {
      action: 'restart',
      finishedAt: nowIso(),
      message: err instanceof Error ? err.message : String(err),
      service,
      startedAt,
      status: 'failed',
    };
  }
}

function imageTagFromImage(image: string | null) {
  if (!image) {
    return BAKER_VERSION;
  }
  const marker = `${BAKER_IMAGE_REPOSITORY}:`;
  if (image.startsWith(marker)) {
    return image.slice(marker.length) || BAKER_VERSION;
  }
  const tag = image.split(':').at(-1);
  return tag && !tag.includes('/') ? tag : BAKER_VERSION;
}

function resolveContainerHostPorts(
  settings: DeploymentRuntimeSettings,
  inspect: DockerInspectResponse | null,
  pendingChangedKeys: Set<string>,
) {
  const webHostPort = pendingChangedKeys.has('webHostPort')
    ? settings.webHostPort
    : (readContainerHostPort(inspect, 80) ?? settings.webHostPort);
  const adminHostPort = pendingChangedKeys.has('adminHostPort')
    ? settings.adminHostPort
    : (readContainerHostPort(inspect, 8080) ?? settings.adminHostPort);

  return {
    ...settings,
    adminHostPort,
    webHostPort,
  };
}

function currentContainerHostPortSettings(
  settings: DeploymentRuntimeSettings,
  inspect: DockerInspectResponse | null,
) {
  return {
    ...settings,
    adminHostPort:
      readContainerHostPort(inspect, 8080) ?? settings.adminHostPort,
    webHostPort: readContainerHostPort(inspect, 80) ?? settings.webHostPort,
  };
}

async function startContainerRepair() {
  const docker = createDockerEngineClient();
  if (!(await docker.isAvailable())) {
    throw new Error(
      'Docker socket is not mounted; container repair is unavailable.',
    );
  }

  const [runtimeSettings, pendingMarker, inspect] = await Promise.all([
    readDeploymentRuntimeSettings(),
    readDeploymentPendingMarker(),
    docker.inspectCurrentContainer(),
  ]);
  const desiredSettings = resolveContainerHostPorts(
    runtimeSettings,
    inspect,
    new Set(pendingMarker?.changedKeys ?? []),
  );
  const previousSettings = currentContainerHostPortSettings(
    runtimeSettings,
    inspect,
  );
  const targetImage =
    inspect?.Config?.Image ?? `${BAKER_IMAGE_REPOSITORY}:${BAKER_VERSION}`;
  const targetTag = imageTagFromImage(targetImage);

  await docker.startUpdateHelper({
    desiredSettings,
    previousSettings,
    pullPolicy: 'never',
    targetImage,
    targetTag,
  });
}

function servicesNeedingRepair(health: AdminRuntimeHealth) {
  const unhealthy = new Set(
    health.services
      .filter(
        (service) =>
          service.status === 'degraded' || service.status === 'stopped',
      )
      .map((service) => service.name),
  );
  return runtimeServiceOrder.filter((service) => unhealthy.has(service));
}

function repairStatusFromActions(actions: AdminRuntimeRepairAction[]) {
  if (actions.length === 0) {
    return 'skipped' as const;
  }
  if (actions.every((action) => action.status === 'succeeded')) {
    return 'succeeded' as const;
  }
  if (actions.every((action) => action.status === 'failed')) {
    return 'failed' as const;
  }
  return 'partial' as const;
}

export async function repairRuntimeServices(input: {
  allowContainerRepair: boolean;
  trigger: AdminRuntimeRepairResult['trigger'];
}): Promise<AdminRuntimeRepairResult> {
  return withRuntimeRepairLock(async () => {
    const startedAt = nowIso();
    const initialHealth = await getRuntimeHealth();

    if (!initialHealth.supervisorAvailable) {
      const result: AdminRuntimeRepairResult = {
        actions: [],
        completedAt: nowIso(),
        containerRepairStarted: false,
        message:
          'Supervisor control is unavailable, so service repair cannot run.',
        startedAt,
        status: 'failed',
        trigger: input.trigger,
      };
      await writeRuntimeRepairStatus(result);
      return result;
    }

    const targets = servicesNeedingRepair(initialHealth);
    const actions: AdminRuntimeRepairAction[] = [];

    for (const service of targets) {
      actions.push(await restartSupervisorService(service));
      await sleep(1000);
    }

    if (actions.length === 0) {
      const result: AdminRuntimeRepairResult = {
        actions,
        completedAt: nowIso(),
        containerRepairStarted: false,
        message: 'All runtime services are already healthy.',
        startedAt,
        status: 'skipped',
        trigger: input.trigger,
      };
      await writeRuntimeRepairStatus(result);
      return result;
    }

    await sleep(1500);
    const nextHealth = await getRuntimeHealth();
    const remainingTargets = servicesNeedingRepair(nextHealth);
    let containerRepairStarted = false;
    let message =
      remainingTargets.length === 0
        ? 'Runtime services were repaired successfully.'
        : `Services still unhealthy after restart: ${remainingTargets.join(', ')}.`;
    let status: AdminRuntimeRepairResult['status'] =
      remainingTargets.length === 0
        ? repairStatusFromActions(actions)
        : 'failed';

    if (remainingTargets.length > 0 && input.allowContainerRepair) {
      try {
        await startContainerRepair();
        containerRepairStarted = true;
        status = 'partial';
        message = `${message} Container repair helper was started.`;
      } catch (err) {
        message = `${message} Container repair could not start: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }

    const result: AdminRuntimeRepairResult = {
      actions,
      completedAt: nowIso(),
      containerRepairStarted,
      message,
      startedAt,
      status,
      trigger: input.trigger,
    };
    await writeRuntimeRepairStatus(result);
    return result;
  });
}

export function readSelfRepairSettings(): Promise<AdminRuntimeSelfRepairSettings> {
  return readRuntimeSelfRepairSettings();
}

export function updateSelfRepairSettings(
  input: RuntimeSelfRepairSettingsUpdate,
): Promise<AdminRuntimeSelfRepairSettings> {
  return updateRuntimeSelfRepairSettings(input);
}
