import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { channels } from '../schema/channels';
import { guildMembers } from '../schema/guilds';
import type { ChannelsRepository, CreateChannelInput } from './types';

export function createChannelsRepository(executor: DatabaseExecutor): ChannelsRepository {
  return {
    async create(input: CreateChannelInput) {
      const [channel] = await executor.insert(channels).values(input).returning();
      if (!channel) {
        throw new Error('Expected channel insert to return a row.');
      }

      return channel;
    },
    async delete(channelId) {
      const [channel] = await executor
        .delete(channels)
        .where(eq(channels.id, channelId))
        .returning();
      return channel ?? null;
    },
    async findById(channelId: string) {
      const [channel] = await executor.select().from(channels).where(eq(channels.id, channelId)).limit(1);
      return channel ?? null;
    },
    async findAccessibleById(channelId: string, userId: string) {
      const [channel] = await executor
        .select({
          createdAt: channels.createdAt,
          guildId: channels.guildId,
          id: channels.id,
          name: channels.name,
          position: channels.position,
          topic: channels.topic,
          type: channels.type,
          voiceQuality: channels.voiceQuality,
        })
        .from(channels)
        .innerJoin(guildMembers, eq(channels.guildId, guildMembers.guildId))
        .where(and(eq(channels.id, channelId), eq(guildMembers.userId, userId)))
        .limit(1);

      return channel ?? null;
    },
    async listByGuildForUser(guildId: string, userId: string) {
      return executor
        .select({
          createdAt: channels.createdAt,
          guildId: channels.guildId,
          id: channels.id,
          name: channels.name,
          position: channels.position,
          topic: channels.topic,
          type: channels.type,
          voiceQuality: channels.voiceQuality,
        })
        .from(channels)
        .innerJoin(guildMembers, eq(channels.guildId, guildMembers.guildId))
        .where(and(eq(channels.guildId, guildId), eq(guildMembers.userId, userId)))
        .orderBy(asc(channels.position), asc(channels.id));
    },
    async listByGuild(guildId: string) {
      return executor
        .select()
        .from(channels)
        .where(eq(channels.guildId, guildId))
        .orderBy(asc(channels.position), asc(channels.id));
    },
    async update(channelId, input) {
      const [channel] = await executor
        .update(channels)
        .set(input)
        .where(eq(channels.id, channelId))
        .returning();
      return channel ?? null;
    },
  };
}
