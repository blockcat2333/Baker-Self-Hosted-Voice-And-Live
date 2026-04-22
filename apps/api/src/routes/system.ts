import {
  AdminCreateChannelRequestSchema,
  AdminDeleteChannelResponseSchema,
  AdminCreateUserPayloadSchema,
  AdminCreateUserResponseSchema,
  AdminServerSettingsSchema,
  AdminUpdateChannelRequestSchema,
  AdminUpdateSettingsRequestSchema,
  AdminVerifyPasswordRequestSchema,
  AdminVerifyPasswordResponseSchema,
  AdminWorkspaceStateSchema,
  AuthUserSchema,
  PublicServerConfigSchema,
} from '@baker/protocol';
import type { DatabaseAccess } from '@baker/db';

import { ApiError } from '../lib/api-error';
import { DEFAULT_WORKSPACE_SLUG, ensureNewUserJoinsDefaultWorkspace } from '../lib/default-workspace';
import { hashPassword } from '../lib/password';
import { getOrCreateServerSettings, syncWorkspaceServerName, verifyAdminPassword } from '../lib/server-settings';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string) {
  return username.trim();
}

function assertValidUsername(username: string) {
  if (username.length < 2 || username.length > 32) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Username must be between 2 and 32 characters.', {
      field: 'username',
    });
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
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Admin password is incorrect.');
  }
}

async function getWorkspaceState(dataAccess: Pick<DatabaseAccess, 'channels' | 'guilds' | 'serverSettings'>) {
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
  delete(path: string, handler: (request: SystemRoutesRequest) => Promise<unknown>): unknown;
  get(path: string, handler: (request: SystemRoutesRequest) => Promise<unknown>): unknown;
  patch(path: string, handler: (request: SystemRoutesRequest) => Promise<unknown>): unknown;
  post(path: string, handler: (request: SystemRoutesRequest) => Promise<unknown>): unknown;
}

export function registerSystemRoutes(app: SystemRoutesApp) {
  app.get('/v1/meta/public-config', async () => {
    const settings = await getOrCreateServerSettings(app.dataAccess);
    return PublicServerConfigSchema.parse({
      allowPublicRegistration: settings.allowPublicRegistration,
      appPort: settings.appPort,
      serverName: settings.serverName,
      webEnabled: settings.webEnabled,
      webPort: settings.webPort,
    });
  });

  app.post('/v1/admin/auth/verify', async (request) => {
    const input = AdminVerifyPasswordRequestSchema.parse(request.body);
    const valid = await verifyAdminPassword(app.dataAccess, input.password);
    if (!valid) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Admin password is incorrect.');
    }
    return AdminVerifyPasswordResponseSchema.parse({ ok: true });
  });

  app.get('/v1/admin/settings', async (request) => {
    await requireAdmin(app, request);
    const settings = await getOrCreateServerSettings(app.dataAccess);
    return AdminServerSettingsSchema.parse({
      allowPublicRegistration: settings.allowPublicRegistration,
      appPort: settings.appPort,
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
      throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Failed to update server settings.');
    }

    if (input.serverName) {
      await syncWorkspaceServerName(app.dataAccess, input.serverName);
    }

    return AdminServerSettingsSchema.parse({
      allowPublicRegistration: nextSettings.allowPublicRegistration,
      appPort: nextSettings.appPort,
      serverName: nextSettings.serverName,
      webEnabled: nextSettings.webEnabled,
      webPort: nextSettings.webPort,
    });
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
      throw new ApiError(400, 'VALIDATION_ERROR', 'Email is already in use.', { field: 'email' });
    }

    const createdUser = await app.dataAccess.withTransaction(async (repositories) => {
      const settings = await getOrCreateServerSettings(repositories);
      const user = await repositories.users.create({
        email,
        passwordHash: await hashPassword(input.password),
        username,
      });

      await ensureNewUserJoinsDefaultWorkspace(repositories, user.id, username, settings.serverName);
      return user;
    });

    return AdminCreateUserResponseSchema.parse(toAuthUser(createdUser));
  });

  app.post('/v1/admin/channels', async (request) => {
    await requireAdmin(app, request);
    const input = AdminCreateChannelRequestSchema.parse(request.body);
    const guild = await app.dataAccess.guilds.findBySlug(DEFAULT_WORKSPACE_SLUG);
    if (!guild) {
      throw new ApiError(409, 'VALIDATION_ERROR', 'Create the first user before managing channels.');
    }

    const existingChannels = await app.dataAccess.channels.listByGuild(guild.id);
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
      ...(input.voiceQuality !== undefined ? { voiceQuality: input.voiceQuality } : {}),
    });

    if (!updatedChannel) {
      throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Failed to update channel.');
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

      const siblingChannels = await repositories.channels.listByGuild(existingChannel.guildId);
      const sameTypeChannels = siblingChannels.filter((channel) => channel.type === existingChannel.type);
      if (sameTypeChannels.length <= 1) {
        const message = existingChannel.type === 'text'
          ? 'At least one text channel must remain.'
          : 'At least one voice channel must remain.';
        throw new ApiError(409, 'VALIDATION_ERROR', message);
      }

      const activeSessions = await repositories.streamSessions.listActiveByChannel(channelId);
      if (activeSessions.length > 0) {
        throw new ApiError(409, 'VALIDATION_ERROR', 'Stop active livestreams before deleting this voice channel.');
      }

      const deletedChannel = await repositories.channels.delete(channelId);
      if (!deletedChannel) {
        throw new ApiError(500, 'INTERNAL_SERVER_ERROR', 'Failed to delete channel.');
      }

      const remainingChannels = await repositories.channels.listByGuild(existingChannel.guildId);
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
