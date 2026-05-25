import http from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const socketPath = process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock';
const jobId = requiredEnv('BAKER_UPDATE_JOB_ID');
const currentContainer = requiredEnv('BAKER_UPDATE_CURRENT_CONTAINER');
const targetImage = requiredEnv('BAKER_UPDATE_TARGET_IMAGE');
const targetTag = requiredEnv('BAKER_UPDATE_TARGET_TAG');
const statusFile = process.env.BAKER_UPDATE_STATUS_FILE ?? '/var/lib/baker/runtime/update-status.json';
const pullPolicy = process.env.BAKER_UPDATE_PULL_POLICY ?? 'always';
const desiredSettings = readSettings('BAKER_UPDATE_DESIRED_SETTINGS');
const previousSettings = readSettings('BAKER_UPDATE_PREVIOUS_SETTINGS');

const managedEnvKeys = new Set([
  'ADMIN_HTTP_PORT',
  'ALLOWED_HOSTS',
  'BAKER_UPDATE_CURRENT_CONTAINER',
  'BAKER_UPDATE_DESIRED_SETTINGS',
  'BAKER_UPDATE_JOB_ID',
  'BAKER_UPDATE_PREVIOUS_SETTINGS',
  'BAKER_UPDATE_PULL_POLICY',
  'BAKER_UPDATE_STATUS_FILE',
  'BAKER_UPDATE_TARGET_IMAGE',
  'BAKER_UPDATE_TARGET_TAG',
  'SFU_ANNOUNCED_IP',
  'SFU_ENABLE_TCP',
  'SFU_RTC_MAX_PORT',
  'SFU_RTC_MIN_PORT',
  'STUN_URLS',
  'TURN_ENABLED',
  'TURN_EXTERNAL_IP',
  'TURN_MAX_PORT',
  'TURN_MIN_PORT',
  'TURN_PASSWORD',
  'TURN_PORT',
  'TURN_REALM',
  'TURN_URLS',
  'TURN_USERNAME',
  'VITE_ALLOWED_HOSTS',
  'WEB_PORT',
]);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readSettings(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return JSON.parse(value);
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
        socketPath,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(readDockerError(text, response.statusCode ?? 500)));
            return;
          }
          resolve(text ? JSON.parse(text) : {});
        });
      },
    );
    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

async function dockerText(method, path, body) {
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
        socketPath,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(readDockerError(text, response.statusCode ?? 500)));
            return;
          }
          resolve(text);
        });
      },
    );
    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

function readDockerError(text, statusCode) {
  try {
    const json = JSON.parse(text);
    return json.message ? `Docker API ${statusCode}: ${json.message}` : `Docker API ${statusCode}`;
  } catch {
    return text ? `Docker API ${statusCode}: ${text}` : `Docker API ${statusCode}`;
  }
}

async function writeStatus(status, phase, message, extra = {}) {
  const now = new Date().toISOString();
  const payload = {
    completedAt: status === 'running' ? null : now,
    error: null,
    jobId,
    message,
    phase,
    startedAt: startTime,
    status,
    targetImage,
    targetTag,
    updatedAt: now,
    ...extra,
  };
  await mkdir(dirname(statusFile), { recursive: true });
  const tmp = `${statusFile}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await rename(tmp, statusFile);
}

function portKey(port, protocol) {
  return `${port}/${protocol}`;
}

function deleteRange(bindings, min, max) {
  for (let port = min; port <= max; port += 1) {
    delete bindings[portKey(port, 'tcp')];
    delete bindings[portKey(port, 'udp')];
  }
}

function addPort(bindings, exposed, containerPort, protocol, hostPort) {
  const key = portKey(containerPort, protocol);
  exposed[key] = {};
  bindings[key] = [{ HostIp: '', HostPort: String(hostPort) }];
}

function addRange(bindings, exposed, min, max, protocol) {
  for (let port = min; port <= max; port += 1) {
    addPort(bindings, exposed, port, protocol, port);
  }
}

function removeManagedPorts(bindings, settings) {
  delete bindings[portKey(80, 'tcp')];
  delete bindings[portKey(8080, 'tcp')];
  delete bindings[portKey(settings.turnPort, 'tcp')];
  delete bindings[portKey(settings.turnPort, 'udp')];
  deleteRange(bindings, settings.turnMinPort, settings.turnMaxPort);
  deleteRange(bindings, settings.sfuRtcMinPort, settings.sfuRtcMaxPort);
}

function createPortBindings(currentBindings) {
  const bindings = { ...(currentBindings ?? {}) };
  removeManagedPorts(bindings, previousSettings);
  removeManagedPorts(bindings, desiredSettings);

  const exposed = {};
  addPort(bindings, exposed, 80, 'tcp', desiredSettings.webHostPort);
  addPort(bindings, exposed, 8080, 'tcp', desiredSettings.adminHostPort);

  if (desiredSettings.turnEnabled) {
    addPort(bindings, exposed, desiredSettings.turnPort, 'tcp', desiredSettings.turnPort);
    addPort(bindings, exposed, desiredSettings.turnPort, 'udp', desiredSettings.turnPort);
    addRange(bindings, exposed, desiredSettings.turnMinPort, desiredSettings.turnMaxPort, 'tcp');
    addRange(bindings, exposed, desiredSettings.turnMinPort, desiredSettings.turnMaxPort, 'udp');
  }

  if (desiredSettings.sfuAnnouncedIp) {
    addRange(bindings, exposed, desiredSettings.sfuRtcMinPort, desiredSettings.sfuRtcMaxPort, 'tcp');
    addRange(bindings, exposed, desiredSettings.sfuRtcMinPort, desiredSettings.sfuRtcMaxPort, 'udp');
  }

  return { bindings, exposed };
}

function filterEnv(env) {
  return (env ?? []).filter((entry) => {
    const key = String(entry).split('=', 1)[0];
    return key && !managedEnvKeys.has(key);
  });
}

function createMounts(current) {
  if (current.HostConfig?.Binds?.length > 0) {
    return undefined;
  }
  return (current.Mounts ?? []).flatMap((mount) => {
    if (!mount.Type || !mount.Destination) {
      return [];
    }
    const source = mount.Type === 'volume' ? mount.Name : mount.Source;
    if (!source) {
      return [];
    }
    return [
      {
        ReadOnly: mount.RW === false,
        Source: source,
        Target: mount.Destination,
        Type: mount.Type,
      },
    ];
  });
}

function createContainerConfig(current) {
  const ports = createPortBindings(current.HostConfig?.PortBindings);
  return {
    AttachStderr: false,
    AttachStdin: false,
    AttachStdout: false,
    Cmd: current.Config?.Cmd ?? null,
    Entrypoint: current.Config?.Entrypoint ?? null,
    Env: filterEnv(current.Config?.Env),
    ExposedPorts: {
      ...(current.Config?.ExposedPorts ?? {}),
      ...ports.exposed,
    },
    HostConfig: {
      Binds: current.HostConfig?.Binds ?? undefined,
      CapAdd: current.HostConfig?.CapAdd ?? undefined,
      CapDrop: current.HostConfig?.CapDrop ?? undefined,
      Devices: current.HostConfig?.Devices ?? undefined,
      Dns: current.HostConfig?.Dns ?? undefined,
      ExtraHosts: current.HostConfig?.ExtraHosts ?? undefined,
      LogConfig: current.HostConfig?.LogConfig ?? undefined,
      Mounts: createMounts(current),
      NetworkMode: current.HostConfig?.NetworkMode ?? undefined,
      PortBindings: ports.bindings,
      Privileged: current.HostConfig?.Privileged ?? false,
      RestartPolicy: current.HostConfig?.RestartPolicy ?? { Name: 'unless-stopped' },
      SecurityOpt: current.HostConfig?.SecurityOpt ?? undefined,
      ShmSize: current.HostConfig?.ShmSize ?? undefined,
    },
    Image: targetImage,
    Labels: {
      ...(current.Config?.Labels ?? {}),
      'org.baker.updated-at': new Date().toISOString(),
      'org.baker.updated-by': 'baker-control-panel',
    },
    Tty: false,
    User: current.Config?.User ?? '',
    Volumes: current.Config?.Volumes ?? undefined,
    WorkingDir: current.Config?.WorkingDir ?? undefined,
  };
}

async function waitForHealthy(containerName) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const inspect = await docker('GET', `/containers/${encodeURIComponent(containerName)}/json`);
    const state = inspect.State ?? {};
    if (state.Health?.Status === 'healthy') {
      return;
    }
    if (!state.Health && state.Running) {
      return;
    }
    if (state.Health?.Status === 'unhealthy' || state.Running === false) {
      throw new Error(`New container is ${state.Health?.Status ?? state.Status ?? 'not running'}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Timed out waiting for the updated container to become healthy.');
}

async function containerExists(name) {
  try {
    await docker('GET', `/containers/${encodeURIComponent(name)}/json`);
    return true;
  } catch {
    return false;
  }
}

async function rollback(oldName, previousName, failedName) {
  await writeStatus('running', 'rollback', 'Rolling back to the previous container.');

  if (!(await containerExists(previousName))) {
    if (await containerExists(oldName)) {
      await dockerText('POST', `/containers/${encodeURIComponent(oldName)}/start`).catch(() => undefined);
    }
    return;
  }

  if (await containerExists(oldName)) {
    await dockerText('POST', `/containers/${encodeURIComponent(oldName)}/stop?t=10`).catch(() => undefined);
    await dockerText('POST', `/containers/${encodeURIComponent(oldName)}/rename?name=${encodeURIComponent(failedName)}`).catch(() => undefined);
  }
  await dockerText('POST', `/containers/${encodeURIComponent(previousName)}/rename?name=${encodeURIComponent(oldName)}`);
  await dockerText('POST', `/containers/${encodeURIComponent(oldName)}/start`);
  await dockerText('DELETE', `/containers/${encodeURIComponent(failedName)}?force=true&v=true`).catch(() => undefined);
}

async function pullTargetImage() {
  if (pullPolicy === 'never') {
    await writeStatus('running', 'pull-skipped', `Using existing image ${targetImage}.`);
    return;
  }
  const [fromImage, tag] = splitImageTag(targetImage);
  await writeStatus('running', 'pull', `Pulling ${targetImage}.`);
  await dockerText(
    'POST',
    `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`,
  );
}

function splitImageTag(image) {
  const slashIndex = image.lastIndexOf('/');
  const colonIndex = image.lastIndexOf(':');
  if (colonIndex > slashIndex) {
    return [image.slice(0, colonIndex), image.slice(colonIndex + 1)];
  }
  return [image, 'latest'];
}

const startTime = new Date().toISOString();

async function main() {
  const current = await docker('GET', `/containers/${encodeURIComponent(currentContainer)}/json`);
  const oldName = String(current.Name ?? '').replace(/^\//, '');
  if (!oldName) {
    throw new Error('Current container name is unavailable.');
  }

  const suffix = jobId.slice(0, 12);
  const nextName = `${oldName}-next-${suffix}`;
  const previousName = `${oldName}-previous-${suffix}`;
  const failedName = `${oldName}-failed-${suffix}`;

  await writeStatus('running', 'inspect', `Preparing to update ${oldName}.`);
  await pullTargetImage();

  await writeStatus('running', 'create', `Creating replacement container ${nextName}.`);
  const created = await docker(
    'POST',
    `/containers/create?name=${encodeURIComponent(nextName)}`,
    createContainerConfig(current),
  );
  if (!created.Id) {
    throw new Error('Docker did not return a replacement container id.');
  }

  try {
    await writeStatus('running', 'stop-current', `Stopping ${oldName}.`);
    await dockerText('POST', `/containers/${encodeURIComponent(oldName)}/stop?t=30`).catch(() => undefined);

    await writeStatus('running', 'swap', 'Swapping container names.');
    await dockerText('POST', `/containers/${encodeURIComponent(oldName)}/rename?name=${encodeURIComponent(previousName)}`);
    await dockerText('POST', `/containers/${encodeURIComponent(nextName)}/rename?name=${encodeURIComponent(oldName)}`);

    await writeStatus('running', 'start', `Starting ${oldName}.`);
    await dockerText('POST', `/containers/${encodeURIComponent(oldName)}/start`);
    await waitForHealthy(oldName);

    await writeStatus('succeeded', 'complete', `Updated to ${targetImage}.`);
    await rm('/var/lib/baker/runtime/deployment-pending.json', { force: true }).catch(() => undefined);
    await dockerText('DELETE', `/containers/${encodeURIComponent(previousName)}?force=true&v=true`).catch(() => undefined);
  } catch (err) {
    await rollback(oldName, previousName, failedName).catch(() => undefined);
    throw err;
  }
}

main().catch(async (err) => {
  await writeStatus('failed', 'failed', 'Update failed.', {
    error: err instanceof Error ? err.message : String(err),
  }).catch(() => undefined);
  process.exitCode = 1;
});
