import { eq } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { authSessions } from '../schema/auth';
import type { AuthSessionsRepository, CreateAuthSessionInput } from './types';

export function createAuthSessionsRepository(executor: DatabaseExecutor): AuthSessionsRepository {
  return {
    async create(input: CreateAuthSessionInput) {
      const [session] = await executor.insert(authSessions).values(input).returning();
      if (!session) {
        throw new Error('Expected auth session insert to return a row.');
      }

      return session;
    },
    async findById(id: string) {
      const [session] = await executor.select().from(authSessions).where(eq(authSessions.id, id)).limit(1);
      return session ?? null;
    },
    async revoke(id: string) {
      const [session] = await executor
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(eq(authSessions.id, id))
        .returning();

      return session ?? null;
    },
    async touch(id: string) {
      const [session] = await executor
        .update(authSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(authSessions.id, id))
        .returning();

      return session ?? null;
    },
  };
}
