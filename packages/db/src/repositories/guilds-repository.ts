import { desc, eq } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { guildMembers, guilds } from '../schema/guilds';
import type { CreateGuildInput, GuildsRepository } from './types';

export function createGuildsRepository(executor: DatabaseExecutor): GuildsRepository {
  return {
    async create(input: CreateGuildInput) {
      const [guild] = await executor.insert(guilds).values(input).returning();
      if (!guild) {
        throw new Error('Expected guild insert to return a row.');
      }

      return guild;
    },
    async findById(id: string) {
      const [guild] = await executor.select().from(guilds).where(eq(guilds.id, id)).limit(1);
      return guild ?? null;
    },
    async findBySlug(slug: string) {
      const [guild] = await executor.select().from(guilds).where(eq(guilds.slug, slug)).limit(1);
      return guild ?? null;
    },
    async listForUser(userId: string) {
      return executor
        .select({
          createdAt: guilds.createdAt,
          id: guilds.id,
          name: guilds.name,
          ownerUserId: guilds.ownerUserId,
          slug: guilds.slug,
        })
        .from(guildMembers)
        .innerJoin(guilds, eq(guildMembers.guildId, guilds.id))
        .where(eq(guildMembers.userId, userId))
        .orderBy(desc(guildMembers.joinedAt), desc(guilds.id));
    },
    async update(id, input) {
      const [guild] = await executor
        .update(guilds)
        .set(input)
        .where(eq(guilds.id, id))
        .returning();
      return guild ?? null;
    },
  };
}
