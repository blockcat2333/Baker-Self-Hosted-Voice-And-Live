import { and, desc, eq, isNull, or } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { streamSessions } from '../schema/streams';
import type { CreateStreamSessionInput, StreamSessionRecord, StreamSessionsRepository, StreamStatus } from './types';

export function createStreamSessionsRepository(executor: DatabaseExecutor): StreamSessionsRepository {
  function activeSessionWhereClause(channelId: string) {
    return and(
      eq(streamSessions.channelId, channelId),
      or(
        eq(streamSessions.status, 'starting'),
        eq(streamSessions.status, 'live'),
      ),
      isNull(streamSessions.endedAt),
    );
  }

  function listActiveByChannel(channelId: string): Promise<StreamSessionRecord[]> {
    return executor
      .select()
      .from(streamSessions)
      .where(activeSessionWhereClause(channelId))
      .orderBy(desc(streamSessions.startedAt), desc(streamSessions.id));
  }

  return {
    async create(input: CreateStreamSessionInput): Promise<StreamSessionRecord> {
      const [record] = await executor
        .insert(streamSessions)
        .values({
          channelId: input.channelId,
          hostUserId: input.hostUserId,
          id: input.id,
          metadata: input.metadata ?? {},
          sourceType: input.sourceType,
          status: 'starting',
        })
        .returning();
      if (!record) throw new Error('Expected stream_sessions insert to return a row.');
      return record;
    },

    async updateStatus(id: string, status: StreamStatus, opts?: { startedAt?: Date; endedAt?: Date }): Promise<void> {
      await executor
        .update(streamSessions)
        .set({
          endedAt: opts?.endedAt ?? undefined,
          startedAt: opts?.startedAt ?? undefined,
          status,
        })
        .where(eq(streamSessions.id, id));
    },

    async findActiveByChannel(channelId: string): Promise<StreamSessionRecord | null> {
      const [record] = await listActiveByChannel(channelId);
      return record ?? null;
    },

    async findActiveByChannelAndHostUser(channelId: string, hostUserId: string): Promise<StreamSessionRecord | null> {
      const [record] = await executor
        .select()
        .from(streamSessions)
        .where(
          and(
            activeSessionWhereClause(channelId),
            eq(streamSessions.hostUserId, hostUserId),
          ),
        )
        .limit(1);
      return record ?? null;
    },

    async listActiveByChannel(channelId: string): Promise<StreamSessionRecord[]> {
      return listActiveByChannel(channelId);
    },

    async findById(id: string): Promise<StreamSessionRecord | null> {
      const [record] = await executor
        .select()
        .from(streamSessions)
        .where(eq(streamSessions.id, id))
        .limit(1);
      return record ?? null;
    },
  };
}
