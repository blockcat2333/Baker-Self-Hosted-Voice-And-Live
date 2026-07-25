import {
  AdminCreateChannelRequestSchema,
  AdminDeleteChannelResponseSchema,
  AdminCreateUserPayloadSchema,
  AdminCreateUserResponseSchema,
  AdminApplyUpdateRequestSchema,
  AdminDeploymentSettingsSchema,
  AdminRuntimeHealthSchema,
  AdminRuntimePublicIpCheckResultSchema,
  AdminRuntimePublicIpSettingsSchema,
  AdminRuntimeRepairRequestSchema,
  AdminRuntimeRepairResultSchema,
  AdminRuntimeSelfRepairSettingsSchema,
  AdminServerSettingsSchema,
  AdminUpdateDeploymentSettingsRequestSchema,
  AdminUpdateChannelRequestSchema,
  AdminUpdateJobStatusSchema,
  AdminUpdateProxySettingsRequestSchema,
  AdminUpdateProxySettingsSchema,
  AdminUpdateRuntimePublicIpSettingsRequestSchema,
  AdminUpdateRuntimeSelfRepairSettingsRequestSchema,
  AdminUpdateSettingsRequestSchema,
  AdminUpdateVersionsResponseSchema,
  AdminVerifyPasswordRequestSchema,
  AdminVerifyPasswordResponseSchema,
  AdminWorkspaceStateSchema,
  AuthUserSchema,
  MediaCapabilitiesSchema,
  PublicServerConfigSchema,
} from '@baker/protocol';
import type { DatabaseAccess } from '@baker/db';
import {
  BAKER_VERSION,
  parseAppEnv,
  parseMediaRegionProfiles,
} from '@baker/shared';

import { ApiError } from '../lib/api-error';
import {
  BAKER_IMAGE_REPOSITORY,
  createDockerEngineClient,
  readContainerHostPort,
  type DockerInspectResponse,
} from '../lib/docker-control';
import {
  DEFAULT_WORKSPACE_SLUG,
  ensureNewUserJoinsDefaultWorkspace,
} from '../lib/default-workspace';
import { hashPassword } from '../lib/password';
import {
  getRuntimeHealth,
  isRuntimeRepairRunning,
  readSelfRepairSettings,
  repairRuntimeServices,
  RuntimeRepairLockError,
  updateSelfRepairSettings,
} from '../lib/runtime-health';
import {
  readDeploymentPendingMarker,
  readDeploymentRuntimeSettings,
  readRuntimePublicIpSettings,
  readRuntimeUpdateProxySettings,
  updateRuntimePublicIpSettings,
  updateRuntimeUpdateProxySettings,
  updateDeploymentRuntimeSettings,
  type DeploymentRuntimeSettings,
} from '../lib/runtime-config';
import { checkAndApplyRuntimePublicIp } from '../lib/runtime-public-ip';
import {
  getOrCreateServerSettings,
  syncWorkspaceServerName,
  verifyAdminPassword,
} from '../lib/server-settings';
import { listBakerUpdateVersions } from '../lib/update-versions';
import {
  readUpdateStatus,
  writeFailedUpdateStatus,
  writeStartingUpdateStatus,
} from '../lib/update-status';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string) {
  return username.trim();
}

function assertValidUsername(username: string) {
  if (username.length < 2 || username.length > 32) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Username must be between 2 and 32 characters.',
      {
        field: 'username',
      },
    );
  }
}

function extractHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function toAuthUser(user: { email: string; id: string; username: string }) {
  return AuthUserSchema.parse({
    email: user.email,
    id: user.id,
    username: user.username,
  });
}

function toChannelSummary(channel: {
  guildId: string;
  id: string;
  name: string;
  position: number;
  topic: string | null;
  type: 'text' | 'voice';
  voiceQuality: 'high' | 'standard';
}) {
  return {
    guildId: channel.guildId,
    id: channel.id,
    name: channel.name,
    position: channel.position,
    topic: channel.topic,
    type: channel.type,
    voiceQuality: channel.voiceQuality,
  };
}

async function requireAdmin(
  app: { dataAccess: Pick<DatabaseAccess, 'serverSettings'> },
  request: { headers: Record<string, string | string[] | undefined> },
) {
  const password = extractHeaderValue(request.headers['x-admin-password']);
  if (!password) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Admin password is required.');
  }

  const valid = await verifyAdminPassword(app.dataAccess, password);
  if (!valid) {
    throw new ApiError(
      401,
      'INVALID_CREDENTIALS',
      'Admin password is incorrect.',
    );
  }
}

async function getWorkspaceState(
  dataAccess: Pick<DatabaseAccess, 'channels' | 'guilds' | 'serverSettings'>,
) {
  const settings = await getOrCreateServerSettings(dataAccess);
  const guild = await dataAccess.guilds.findBySlug(DEFAULT_WORKSPACE_SLUG);
  const channels = guild ? await dataAccess.channels.listByGuild(guild.id) : [];

  return AdminWorkspaceStateSchema.parse({
    channels: channels.map(toChannelSummary),
    guildId: guild?.id ?? null,
    serverName: settings.serverName,
  });
}

interface SystemRoutesRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  params: unknown;
}

interface SystemRoutesApp {
  dataAccess: DatabaseAccess;
  delete(
    path: string,
    handler: (request: SystemRoutesRequest) => Promise<unknown>,
  ): unknown;
  get(
    path: string,
    handler: (request: SystemRoutesRequest) => Promise<unknown>,
  ): unknown;
  patch(
    path: string,
    handler: (request: SystemRoutesRequest) => Promise<unknown>,
  ): unknown;
  post(
    path: string,
    handler: (request: SystemRoutesRequest) => Promise<unknown>,
  ): unknown;
  publisher: {
    publishMediaModeChanged(mediaMode: 'p2p' | 'sfu'): Promise<void>;
  };
}

async function assertSfuAvailable() {
  const env = parseAppEnv();
  let response: Response;
  try {
    response = await fetch(
      `${env.MEDIA_INTERNAL_URL}/v1/internal/media/capabilities`,
      {
        headers: {
          'x-baker-internal-secret': env.MEDIA_INTERNAL_SECRET,
        },
        method: 'GET',
      },
    );
  } catch (err) {
    throw new ApiError(
      409,
      'VALIDATION_ERROR',
      'SFU media backend is not reachable.',
      {
        cause: err instanceof Error ? err.message : String(err),
      },
    );
  }

  if (!response.ok) {
    throw new ApiError(
      409,
      'VALIDATION_ERROR',
      `SFU media backend check failed with HTTP ${response.status}.`,
    );
  }

  const capabilities = MediaCapabilitiesSchema.parse(await response.json());
  if (!capabilities.sfu?.available) {
    throw new ApiError(
      409,
      'VALIDATION_ERROR',
      'This media service build does not support SFU mode.',
    );
  }
  if (!capabilities.sfu.configured) {
    throw new ApiError(
      409,
      'VALIDATION_ERROR',
      'SFU mode requires SFU_ANNOUNCED_IP and the SFU RTC port range to be configured.',
    );
  }
}

function assertValidDeploymentSettings(settings: DeploymentRuntimeSettings) {
  if (settings.turnMinPort > settings.turnMaxPort) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'TURN relay minimum port must be less than or equal to the maximum port.',
    );
  }
  if (settings.sfuRtcMinPort > settings.sfuRtcMaxPort) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'SFU RTC minimum port must be less than or equal to the maximum port.',
    );
  }
  try {
    parseMediaRegionProfiles(
      parseAppEnv({
        MEDIA_REGION_PROFILES: settings.mediaRegionProfiles,
        NODE_ENV: 'development',
        SFU_ANNOUNCED_IP: settings.sfuAnnouncedIp,
        SFU_ENABLE_TCP: String(settings.sfuEnableTcp),
        SFU_RTC_MAX_PORT: String(settings.sfuRtcMaxPort),
        SFU_RTC_MIN_PORT: String(settings.sfuRtcMinPort),
        STUN_URLS: settings.stunUrls,
        TURN_PASSWORD: settings.turnPasswordConfigured ? 'configured' : '',
        TURN_URLS: settings.turnUrls,
        TURN_USERNAME: settings.turnUsername,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `MEDIA_REGION_PROFILES is invalid: ${message}`,
    );
  }
  if (settings.turnEnabled && !settings.turnUrls && !settings.turnExternalIp) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'TURN requires TURN URLs or an external IP.',
    );
  }
  if (
    settings.turnEnabled &&
    (!settings.turnUsername || !settings.turnPasswordConfigured)
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'TURN requires a username and password.',
    );
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

async function getAdminDeploymentSettings() {
  const docker = createDockerEngineClient();
  const [dockerEnabled, dockerStatus, runtimeSettings, pendingMarker] =
    await Promise.all([
      docker.isAvailable(),
      docker.getStatusMessage(),
      readDeploymentRuntimeSettings(),
      readDeploymentPendingMarker(),
    ]);
  const inspect = dockerEnabled ? await docker.inspectCurrentContainer() : null;
  const resolvedSettings = dockerEnabled
    ? resolveContainerHostPorts(
        runtimeSettings,
        inspect,
        new Set(pendingMarker?.changedKeys ?? []),
      )
    : runtimeSettings;

  return AdminDeploymentSettingsSchema.parse({
    ...resolvedSettings,
    currentContainerName: inspect?.Name
      ? inspect.Name.replace(/^\//, '')
      : null,
    currentImage: inspect?.Config?.Image ?? null,
    dockerEnabled,
    pendingApply: pendingMarker?.pendingApply === true,
    ...(dockerEnabled
      ? {}
      : { currentContainerName: null, currentImage: null }),
    dockerStatus,
  });
}

export function registerSystemRoutes(app: SystemRoutesApp) {
  app.get('/v1/meta/public-config', async () => {
    const settings = await getOrCreateServerSettings(app.dataAccess);
    return PublicServerConfigSchema.parse({
      allowPublicRegistration: settings.allowPublicRegistration,
      appPort: settings.appPort,
      mediaMode: settings.mediaMode,
      serverName: settings.serverName,
      webEnabled: settings.webEnabled,
      webPort: settings.webPort,
    });
  });

  app.post('/v1/admin/auth/verify', async (request) => {
    const input = AdminVerifyPasswordRequestSchema.parse(request.body);
    const valid = await verifyAdminPassword(app.dataAccess, input.password);
    if (!valid) {
      throw new ApiError(
        401,
        'INVALID_CREDENTIALS',
        'Admin password is incorrect.',
      );
    }
    return AdminVerifyPasswordResponseSchema.parse({ ok: true });
  });

  app.get('/v1/admin/settings', async (request) => {
    await requireAdmin(app, request);
    const settings = await getOrCreateServerSettings(app.dataAccess);
    return AdminServerSettingsSchema.parse({
      allowPublicRegistration: settings.allowPublicRegistration,
      appPort: settings.appPort,
      mediaMode: settings.mediaMode,
      serverName: settings.serverName,
      webEnabled: settings.webEnabled,
      webPort: settings.webPort,
    });
  });

  app.patch('/v1/admin/settings', async (request) => {
    await requireAdmin(app, request);
    const input = AdminUpdateSettingsRequestSchema.parse(request.body);
    const currentSettings = await getOrCreateServerSettings(app.dataAccess);
    const nextInput: Record<string, unknown> = {};

    if (input.adminPassword) {
      nextInput['adminPasswordHash'] = await hashPassword(input.adminPassword);
    }
    if (input.allowPublicRegistration !== undefined) {
      nextInput['allowPublicRegistration'] = input.allowPublicRegistration;
    }
    if (input.appPort !== undefined) {
      nextInput['appPort'] = input.appPort;
    }
    if (input.mediaMode !== undefined) {
      if (input.mediaMode === 'sfu') {
        await assertSfuAvailable();
      }
      nextInput['mediaMode'] = input.mediaMode;
    }
    if (input.serverName !== undefined) {
      nextInput['serverName'] = input.serverName;
    }
    if (input.webEnabled !== undefined) {
      nextInput['webEnabled'] = input.webEnabled;
    }
    if (input.webPort !== undefined) {
      nextInput['webPort'] = input.webPort;
    }

    const nextSettings = await app.dataAccess.serverSettings.update(
      currentSettings.id,
      nextInput,
    );

    if (!nextSettings) {
      throw new ApiError(
        500,
        'INTERNAL_SERVER_ERROR',
        'Failed to update server settings.',
      );
    }

    if (input.serverName) {
      await syncWorkspaceServerName(app.dataAccess, input.serverName);
    }
    if (
      input.mediaMode !== undefined &&
      input.mediaMode !== currentSettings.mediaMode
    ) {
      await app.publisher.publishMediaModeChanged(input.mediaMode);
    }

    return AdminServerSettingsSchema.parse({
      allowPublicRegistration: nextSettings.allowPublicRegistration,
      appPort: nextSettings.appPort,
      mediaMode: nextSettings.mediaMode,
      serverName: nextSettings.serverName,
      webEnabled: nextSettings.webEnabled,
      webPort: nextSettings.webPort,
    });
  });

  app.get('/v1/admin/updates/versions', async (request) => {
    await requireAdmin(app, request);
    const docker = createDockerEngineClient();
    const [dockerEnabled, dockerStatus, containerInfo, versions] =
      await Promise.all([
        docker.isAvailable(),
        docker.getStatusMessage(),
        docker.getCurrentContainerInfo(),
        listBakerUpdateVersions(),
      ]);

    return AdminUpdateVersionsResponseSchema.parse({
      currentImage: containerInfo.currentImage,
      currentVersion: BAKER_VERSION,
      dockerEnabled,
      dockerStatus,
      repository: BAKER_IMAGE_REPOSITORY,
      versions,
    });
  });

  app.get('/v1/admin/updates/proxy', async (request) => {
    await requireAdmin(app, request);
    return AdminUpdateProxySettingsSchema.parse(
      await readRuntimeUpdateProxySettings(),
    );
  });

  app.patch('/v1/admin/updates/proxy', async (request) => {
    await requireAdmin(app, request);
    const input = AdminUpdateProxySettingsRequestSchema.parse(request.body);
    return AdminUpdateProxySettingsSchema.parse(
      await updateRuntimeUpdateProxySettings(input),
    );
  });

  app.get('/v1/admin/updates/status', async (request) => {
    await requireAdmin(app, request);
    return AdminUpdateJobStatusSchema.parse(await readUpdateStatus());
  });

  app.post('/v1/admin/updates/apply', async (request) => {
    await requireAdmin(app, request);
    const input = AdminApplyUpdateRequestSchema.parse(request.body);
    if (await isRuntimeRepairRunning()) {
      throw new ApiError(
        409,
        'VALIDATION_ERROR',
        'Runtime repair is already running.',
      );
    }
    const docker = createDockerEngineClient();
    if (!(await docker.isAvailable())) {
      throw new ApiError(
        409,
        'VALIDATION_ERROR',
        'Docker socket is not mounted; one-click update is unavailable.',
      );
    }

    const [runtimeSettings, pendingMarker, inspect, updateProxy] =
      await Promise.all([
        readDeploymentRuntimeSettings(),
        readDeploymentPendingMarker(),
        docker.inspectCurrentContainer(),
        readRuntimeUpdateProxySettings(),
      ]);
    const settings = resolveContainerHostPorts(
      runtimeSettings,
      inspect,
      new Set(pendingMarker?.changedKeys ?? []),
    );
    assertValidDeploymentSettings(settings);
    const targetImage = `${BAKER_IMAGE_REPOSITORY}:${input.tag}`;

    try {
      const started = await docker.startUpdateHelper({
        desiredSettings: settings,
        previousSettings: currentContainerHostPortSettings(
          runtimeSettings,
          inspect,
        ),
        pullPolicy: 'always',
        targetImage,
        targetTag: input.tag,
        updateProxyUrl:
          updateProxy.enabled && updateProxy.proxyUrl
            ? updateProxy.proxyUrl
            : undefined,
      });
      return AdminUpdateJobStatusSchema.parse(
        await writeStartingUpdateStatus(started),
      );
    } catch (err) {
      const failed = await writeFailedUpdateStatus({
        error: err instanceof Error ? err.message : String(err),
        targetImage,
        targetTag: input.tag,
      });
      return AdminUpdateJobStatusSchema.parse(failed);
    }
  });

  app.get('/v1/admin/deployment/settings', async (request) => {
    await requireAdmin(app, request);
    return getAdminDeploymentSettings();
  });

  app.patch('/v1/admin/deployment/settings', async (request) => {
    await requireAdmin(app, request);
    const input = AdminUpdateDeploymentSettingsRequestSchema.parse(
      request.body,
    );
    const current = await readDeploymentRuntimeSettings();
    const next = {
      ...current,
      ...input,
      turnPasswordConfigured:
        input.turnPassword !== undefined
          ? input.turnPassword.length > 0
          : current.turnPasswordConfigured,
    };
    assertValidDeploymentSettings(next);
    await updateDeploymentRuntimeSettings(input);
    return getAdminDeploymentSettings();
  });

  app.post('/v1/admin/deployment/apply', async (request) => {
    await requireAdmin(app, request);
    if (await isRuntimeRepairRunning()) {
      throw new ApiError(
        409,
        'VALIDATION_ERROR',
        'Runtime repair is already running.',
      );
    }
    const docker = createDockerEngineClient();
    if (!(await docker.isAvailable())) {
      throw new ApiError(
        409,
        'VALIDATION_ERROR',
        'Docker socket is not mounted; deployment apply is unavailable.',
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
    assertValidDeploymentSettings(desiredSettings);
    const targetImage =
      inspect?.Config?.Image ?? `${BAKER_IMAGE_REPOSITORY}:${BAKER_VERSION}`;
    const targetTag = imageTagFromImage(targetImage);

    try {
      const started = await docker.startUpdateHelper({
        desiredSettings,
        previousSettings,
        pullPolicy: 'never',
        targetImage,
        targetTag,
      });
      return AdminUpdateJobStatusSchema.parse(
        await writeStartingUpdateStatus(started),
      );
    } catch (err) {
      const failed = await writeFailedUpdateStatus({
        error: err instanceof Error ? err.message : String(err),
        targetImage,
        targetTag,
      });
      return AdminUpdateJobStatusSchema.parse(failed);
    }
  });

  app.get('/v1/admin/runtime/health', async (request) => {
    await requireAdmin(app, request);
    return AdminRuntimeHealthSchema.parse(await getRuntimeHealth());
  });

  app.post('/v1/admin/runtime/repair', async (request) => {
    await requireAdmin(app, request);
    const input = AdminRuntimeRepairRequestSchema.parse(request.body ?? {});
    const updateStatus = await readUpdateStatus();
    if (updateStatus.status === 'running') {
      throw new ApiError(
        409,
        'VALIDATION_ERROR',
        'Server update or deployment apply is already running.',
      );
    }

    try {
      return AdminRuntimeRepairResultSchema.parse(
        await repairRuntimeServices({
          allowContainerRepair: input.allowContainerRepair ?? true,
          trigger: 'manual',
        }),
      );
    } catch (err) {
      if (err instanceof RuntimeRepairLockError) {
        throw new ApiError(409, 'VALIDATION_ERROR', err.message);
      }
      throw err;
    }
  });

  app.get('/v1/admin/runtime/self-repair', async (request) => {
    await requireAdmin(app, request);
    return AdminRuntimeSelfRepairSettingsSchema.parse(
      await readSelfRepairSettings(),
    );
  });

  app.patch('/v1/admin/runtime/self-repair', async (request) => {
    await requireAdmin(app, request);
    const input = AdminUpdateRuntimeSelfRepairSettingsRequestSchema.parse(
      request.body,
    );
    return AdminRuntimeSelfRepairSettingsSchema.parse(
      await updateSelfRepairSettings(input),
    );
  });

  app.get('/v1/admin/runtime/public-ip', async (request) => {
    await requireAdmin(app, request);
    return AdminRuntimePublicIpSettingsSchema.parse(
      await readRuntimePublicIpSettings(),
    );
  });

  app.patch('/v1/admin/runtime/public-ip', async (request) => {
    await requireAdmin(app, request);
    const input = AdminUpdateRuntimePublicIpSettingsRequestSchema.parse(
      request.body,
    );
    return AdminRuntimePublicIpSettingsSchema.parse(
      await updateRuntimePublicIpSettings(input),
    );
  });

  app.post('/v1/admin/runtime/public-ip/check', async (request) => {
    await requireAdmin(app, request);
    const updateStatus = await readUpdateStatus();
    if (updateStatus.status === 'running' || (await isRuntimeRepairRunning())) {
      throw new ApiError(
        409,
        'VALIDATION_ERROR',
        'Server update, deployment apply, or runtime repair is already running.',
      );
    }

    return AdminRuntimePublicIpCheckResultSchema.parse(
      await checkAndApplyRuntimePublicIp(),
    );
  });

  app.get('/v1/admin/workspace', async (request) => {
    await requireAdmin(app, request);
    return getWorkspaceState(app.dataAccess);
  });

  app.post('/v1/admin/users', async (request) => {
    await requireAdmin(app, request);
    const input = AdminCreateUserPayloadSchema.parse(request.body);
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    assertValidUsername(username);

    const existingUser = await app.dataAccess.users.findByEmail(email);
    if (existingUser) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Email is already in use.', {
        field: 'email',
      });
    }

    const createdUser = await app.dataAccess.withTransaction(
      async (repositories) => {
        const settings = await getOrCreateServerSettings(repositories);
        const user = await repositories.users.create({
          email,
          passwordHash: await hashPassword(input.password),
          username,
        });

        await ensureNewUserJoinsDefaultWorkspace(
          repositories,
          user.id,
          username,
          settings.serverName,
        );
        return user;
      },
    );

    return AdminCreateUserResponseSchema.parse(toAuthUser(createdUser));
  });

  app.post('/v1/admin/channels', async (request) => {
    await requireAdmin(app, request);
    const input = AdminCreateChannelRequestSchema.parse(request.body);
    const guild = await app.dataAccess.guilds.findBySlug(
      DEFAULT_WORKSPACE_SLUG,
    );
    if (!guild) {
      throw new ApiError(
        409,
        'VALIDATION_ERROR',
        'Create the first user before managing channels.',
      );
    }

    const existingChannels = await app.dataAccess.channels.listByGuild(
      guild.id,
    );
    const channel = await app.dataAccess.channels.create({
      guildId: guild.id,
      name: input.name.trim(),
      position: existingChannels.length,
      topic: null,
      type: input.type,
      voiceQuality: input.voiceQuality ?? 'standard',
    });

    return toChannelSummary(channel);
  });

  app.patch('/v1/admin/channels/:channelId', async (request) => {
    await requireAdmin(app, request);
    const params = request.params as { channelId?: string };
    const channelId = params.channelId;
    if (!channelId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Channel id is required.');
    }

    const input = AdminUpdateChannelRequestSchema.parse(request.body);
    const existingChannel = await app.dataAccess.channels.findById(channelId);
    if (!existingChannel) {
      throw new ApiError(404, 'NOT_FOUND', 'Channel not found.');
    }

    const updatedChannel = await app.dataAccess.channels.update(channelId, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      topic: existingChannel.topic,
      ...(input.voiceQuality !== undefined
        ? { voiceQuality: input.voiceQuality }
        : {}),
    });

    if (!updatedChannel) {
      throw new ApiError(
        500,
        'INTERNAL_SERVER_ERROR',
        'Failed to update channel.',
      );
    }

    return toChannelSummary(updatedChannel);
  });

  app.delete('/v1/admin/channels/:channelId', async (request) => {
    await requireAdmin(app, request);
    const params = request.params as { channelId?: string };
    const channelId = params.channelId;
    if (!channelId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Channel id is required.');
    }

    return app.dataAccess.withTransaction(async (repositories) => {
      const existingChannel = await repositories.channels.findById(channelId);
      if (!existingChannel) {
        throw new ApiError(404, 'NOT_FOUND', 'Channel not found.');
      }

      const siblingChannels = await repositories.channels.listByGuild(
        existingChannel.guildId,
      );
      const sameTypeChannels = siblingChannels.filter(
        (channel) => channel.type === existingChannel.type,
      );
      if (sameTypeChannels.length <= 1) {
        const message =
          existingChannel.type === 'text'
            ? 'At least one text channel must remain.'
            : 'At least one voice channel must remain.';
        throw new ApiError(409, 'VALIDATION_ERROR', message);
      }

      const activeSessions =
        await repositories.streamSessions.listActiveByChannel(channelId);
      if (activeSessions.length > 0) {
        throw new ApiError(
          409,
          'VALIDATION_ERROR',
          'Stop active livestreams before deleting this voice channel.',
        );
      }

      const deletedChannel = await repositories.channels.delete(channelId);
      if (!deletedChannel) {
        throw new ApiError(
          500,
          'INTERNAL_SERVER_ERROR',
          'Failed to delete channel.',
        );
      }

      const remainingChannels = await repositories.channels.listByGuild(
        existingChannel.guildId,
      );
      await Promise.all(
        remainingChannels.map((channel, index) => {
          if (channel.position === index) {
            return Promise.resolve(channel);
          }
          return repositories.channels.update(channel.id, { position: index });
        }),
      );

      return AdminDeleteChannelResponseSchema.parse({ ok: true });
    });
  });
}
