import { z } from 'zod';

import type { DatabaseAccess } from '@baker/db';
import { ChannelListResponseSchema, GuildListResponseSchema } from '@baker/protocol';

import { ApiError } from '../lib/api-error';
import { requireAuth } from '../lib/require-auth';

const GuildParamsSchema = z.object({
  guildId: z.string().uuid(),
});

function toGuildSummary(guild: { createdAt: Date; id: string; name: string; ownerUserId: string }) {
  return {
    createdAt: guild.createdAt.toISOString(),
    id: guild.id,
    name: guild.name,
    ownerUserId: guild.ownerUserId,
  };
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

interface GuildRoutesRequest {
  auth: {
    sessionId: string | null;
    userId: string | null;
  };
  authError: ApiError | null;
  params: unknown;
}

interface GuildRoutesApp {
  dataAccess: DatabaseAccess;
  get(path: string, handler: (request: GuildRoutesRequest) => Promise<unknown>): unknown;
}

export function registerGuildRoutes(app: GuildRoutesApp) {
  app.get('/v1/guilds', async (request) => {
    const auth = requireAuth(request);
    const guilds = await app.dataAccess.guilds.listForUser(auth.userId);

    return GuildListResponseSchema.parse(guilds.map(toGuildSummary));
  });

  app.get('/v1/guilds/:guildId/channels', async (request) => {
    const auth = requireAuth(request);
    const { guildId } = GuildParamsSchema.parse(request.params);

    const guild = await app.dataAccess.guilds.findById(guildId);
    if (!guild) {
      throw new ApiError(404, 'NOT_FOUND', 'Guild not found.');
    }

    const membership = await app.dataAccess.guildMembers.findMembership(guildId, auth.userId);
    if (!membership) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this guild.');
    }

    const channels = await app.dataAccess.channels.listByGuildForUser(guildId, auth.userId);
    return ChannelListResponseSchema.parse(channels.map(toChannelSummary));
  });
}
