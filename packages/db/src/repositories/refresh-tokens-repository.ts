import { and, eq, isNull } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { refreshTokens } from '../schema/auth';
import type { CreateRefreshTokenInput, RefreshTokensRepository } from './types';

export function createRefreshTokensRepository(executor: DatabaseExecutor): RefreshTokensRepository {
  return {
    async create(input: CreateRefreshTokenInput) {
      const [token] = await executor.insert(refreshTokens).values(input).returning();
      if (!token) {
        throw new Error('Expected refresh token insert to return a row.');
      }

      return token;
    },
    async findActiveByTokenHash(tokenHash: string) {
      const [token] = await executor
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
        .limit(1);

      return token ?? null;
    },
    async revoke(id: string) {
      const [token] = await executor
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, id))
        .returning();

      return token ?? null;
    },
    async revokeBySessionId(sessionId: string) {
      await executor
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.sessionId, sessionId), isNull(refreshTokens.revokedAt)));
    },
  };
}
