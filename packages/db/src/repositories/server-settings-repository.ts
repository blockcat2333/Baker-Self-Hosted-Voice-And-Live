import { eq } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { serverSettings } from '../schema/server-settings';
import type { ServerSettingsRepository } from './types';

export function createServerSettingsRepository(executor: DatabaseExecutor): ServerSettingsRepository {
  return {
    async create(input) {
      const [settings] = await executor.insert(serverSettings).values(input).returning();
      if (!settings) {
        throw new Error('Expected server settings insert to return a row.');
      }
      return settings;
    },
    async findById(id) {
      const [settings] = await executor.select().from(serverSettings).where(eq(serverSettings.id, id)).limit(1);
      return settings ?? null;
    },
    async update(id, input) {
      const [settings] = await executor
        .update(serverSettings)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(serverSettings.id, id))
        .returning();
      return settings ?? null;
    },
  };
}
