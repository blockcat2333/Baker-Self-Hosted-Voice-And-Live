import { and, eq } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { guildMembers } from '../schema/guilds';
import type { CreateGuildMemberInput, GuildMembersRepository } from './types';

export function createGuildMembersRepository(executor: DatabaseExecutor): GuildMembersRepository {
  return {
    async add(input: CreateGuildMemberInput) {
      const [member] = await executor.insert(guildMembers).values(input).returning();
      if (!member) {
        throw new Error('Expected guild member insert to return a row.');
      }

      return member;
    },
    async findMembership(guildId: string, userId: string) {
      const [member] = await executor
        .select()
        .from(guildMembers)
        .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
        .limit(1);

      return member ?? null;
    },
  };
}
