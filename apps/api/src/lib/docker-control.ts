import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';

import type { DeploymentRuntimeSettings } from './runtime-config';
import { getUpdateStatusPath } from './runtime-config';

export const BAKER_IMAGE_REPOSITORY =
  process.env.BAKER_IMAGE_REPOSITORY ?? 'blockcat233/baker';

export interface DockerContainerInfo {
  currentImage: string | null;
  id: string | null;
  name: string | null;
}

interface DockerMount {
  Destination?: string;
  Name?: string;
  RW?: boolean;
  Source?: string;
  Type?: string;
}

export interface DockerInspectResponse {
  Config?: {
    Image?: string;
  };
  HostConfig?: {
    Binds?: string[] | null;
    PortBindings?: DockerPortBindings | null;
  };
  Id?: string;
  Mounts?: DockerMount[];
  Name?: string;
}

export type DockerPortBindings = Record<
  string,
  Array<{ HostIp?: string; HostPort?: string }> | null
>;

interface DockerCreateResponse {
  Id?: string;
}

interface StartUpdateHelperInput {
  desiredSettings: DeploymentRuntimeSettings;
  previousSettings: DeploymentRuntimeSettings;
  pullPolicy?: 'always' | 'never';
  targetImage: string;
  targetTag: string;
  updateProxyUrl?: string;
}

export class DockerEngineClient {
  constructor(
    private readonly socketPath = process.env.DOCKER_SOCKET_PATH ??
      '/var/run/docker.sock',
  ) {}

  async isAvailable() {
    try {
      await access(this.socketPath);
      const response = await this.requestText('GET', '/_ping');
      return response.trim() === 'OK';
    } catch {
      return false;
    }
  }

  async getStatusMessage() {
    try {
      await access(this.socketPath);
    } catch {
      return 'Docker socket is not mounted.';
    }

    try {
      const response = await this.requestText('GET', '/_ping');
      return response.trim() === 'OK'
        ? 'Docker socket is available.'
        : `Docker ping returned: ${response}`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async inspectCurrentContainer(): Promise<DockerInspectResponse | null> {
    const id = await this.getCurrentContainerId();
    if (!id) {
      return null;
    }

    try {
      return await this.requestJson<DockerInspectResponse>(
        'GET',
        `/containers/${encodeURIComponent(id)}/json`,
      );
    } catch {
      return null;
    }
  }

  async getCurrentContainerInfo(): Promise<DockerContainerInfo> {
    const inspect = await this.inspectCurrentContainer();
    return {
      currentImage: inspect?.Config?.Image ?? null,
      id: inspect?.Id ?? null,
      name: inspect?.Name ? inspect.Name.replace(/^\//, '') : null,
    };
  }

  async startUpdateHelper(input: StartUpdateHelperInput) {
    const inspect = await this.inspectCurrentContainer();
    if (!inspect?.Id) {
      throw new Error('Unable to inspect the current Baker container.');
    }

    const currentImage = inspect.Config?.Image ?? input.targetImage;
    const targetImage = input.targetImage;
    const jobId = randomUUID();
    const helperName = `baker-update-${jobId.slice(0, 12)}`;
    const binds = this.buildHelperBinds(inspect);
    const helperEnv = [
      `BAKER_UPDATE_CURRENT_CONTAINER=${inspect.Id}`,
      `BAKER_UPDATE_DESIRED_SETTINGS=${JSON.stringify(input.desiredSettings)}`,
      `BAKER_UPDATE_JOB_ID=${jobId}`,
      `BAKER_UPDATE_PREVIOUS_SETTINGS=${JSON.stringify(input.previousSettings)}`,
      `BAKER_UPDATE_PULL_POLICY=${input.pullPolicy ?? 'always'}`,
      `BAKER_UPDATE_STATUS_FILE=${getUpdateStatusPath()}`,
      `BAKER_UPDATE_TARGET_IMAGE=${targetImage}`,
      `BAKER_UPDATE_TARGET_TAG=${input.targetTag}`,
    ];
    if (input.updateProxyUrl) {
      helperEnv.push(`BAKER_UPDATE_PROXY_URL=${input.updateProxyUrl}`);
    }

    const createResponse = await this.requestJson<DockerCreateResponse>(
      'POST',
      `/containers/create?name=${encodeURIComponent(helperName)}`,
      {
        Entrypoint: ['node', '/opt/baker-allinone/update-helper.mjs'],
        Env: helperEnv,
        Image: currentImage,
        Labels: {
          'org.baker.role': 'update-helper',
          'org.baker.update-job': jobId,
        },
        HostConfig: {
          AutoRemove: true,
          Binds: binds,
          RestartPolicy: { Name: 'no' },
        },
      },
    );

    if (!createResponse.Id) {
      throw new Error('Docker did not return an update helper container id.');
    }

    await this.requestText(
      'POST',
      `/containers/${encodeURIComponent(createResponse.Id)}/start`,
    );
    return {
      jobId,
      targetImage,
      targetTag: input.targetTag,
    };
  }

  private async getCurrentContainerId() {
    if (process.env.HOSTNAME) {
      return process.env.HOSTNAME.trim();
    }

    try {
      return (await readFile('/etc/hostname', 'utf8')).trim();
    } catch {
      return null;
    }
  }

  private buildHelperBinds(inspect: DockerInspectResponse) {
    const binds = new Set<string>();
    binds.add(`${this.socketPath}:/var/run/docker.sock`);

    for (const bind of inspect.HostConfig?.Binds ?? []) {
      if (bind.includes(':/var/lib/baker')) {
        binds.add(bind);
      }
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

    if (!Array.from(binds).some((bind) => bind.includes(':/var/lib/baker'))) {
      throw new Error(
        'The current container does not expose a /var/lib/baker data mount.',
      );
    }

    return Array.from(binds);
  }

  private requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.request(method, path, body).then((text) => {
      if (!text) {
        return {} as T;
      }
      return JSON.parse(text) as T;
    });
  }

  private requestText(method: string, path: string, body?: unknown) {
    return this.request(method, path, body);
  }

  private request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<string> {
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
          socketPath: this.socketPath,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((response.statusCode ?? 500) >= 400) {
              reject(
                new Error(readDockerError(text, response.statusCode ?? 500)),
              );
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
}

function readDockerError(text: string, statusCode: number) {
  try {
    const json = JSON.parse(text) as { message?: string };
    return json.message
      ? `Docker API ${statusCode}: ${json.message}`
      : `Docker API ${statusCode}`;
  } catch {
    return text
      ? `Docker API ${statusCode}: ${text}`
      : `Docker API ${statusCode}`;
  }
}

export function createDockerEngineClient() {
  return new DockerEngineClient();
}

export function readContainerHostPort(
  inspect: DockerInspectResponse | null | undefined,
  containerPort: number,
  protocol: 'tcp' | 'udp' = 'tcp',
) {
  const binding = inspect?.HostConfig?.PortBindings?.[
    `${containerPort}/${protocol}`
  ]?.find((entry) => entry?.HostPort);
  const value = Number(binding?.HostPort);
  return Number.isInteger(value) && value > 0 ? value : null;
}
