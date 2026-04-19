import { and, desc, eq, lt, or } from 'drizzle-orm';

import type { DatabaseExecutor } from '../client';
import { messages } from '../schema/messages';
import { users } from '../schema/users';
import type { CreateMessageInput, MessagePageResult, MessagesRepository } from './types';

export function createMessagesRepository(executor: DatabaseExecutor): MessagesRepository {
  return {
    async create(input: CreateMessageInput) {
      const [message] = await executor.insert(messages).values(input).returning();
      if (!message) {
        throw new Error('Expected message insert to return a row.');
      }

      return message;
    },
    async listByChannel(input: { beforeId?: string; channelId: string; limit: number }): Promise<MessagePageResult> {
      const { beforeId, channelId, limit } = input;

      let cursorResolved = true;
      let cursor:
        | {
            createdAt: Date;
            id: string;
          }
        | null = null;

      if (beforeId) {
        const [resolvedCursor] = await executor
          .select({
            createdAt: messages.createdAt,
            id: messages.id,
          })
          .from(messages)
          .where(and(eq(messages.channelId, channelId), eq(messages.id, beforeId)))
          .limit(1);

        cursor = resolvedCursor ?? null;
        cursorResolved = Boolean(cursor);
      }

      if (!cursorResolved) {
        return {
          cursorResolved: false,
          items: [],
          nextCursor: null,
        };
      }

      const whereClause = cursor
        ? and(
            eq(messages.channelId, channelId),
            or(
              lt(messages.createdAt, cursor.createdAt),
              and(eq(messages.createdAt, cursor.createdAt), lt(messages.id, cursor.id)),
            ),
          )
        : eq(messages.channelId, channelId);

      const rows = await executor
        .select({
          authorUserId: messages.authorUserId,
          authorUsername: users.username,
          channelId: messages.channelId,
          content: messages.content,
          createdAt: messages.createdAt,
          editedAt: messages.editedAt,
          id: messages.id,
          kind: messages.kind,
          metadata: messages.metadata,
        })
        .from(messages)
        .innerJoin(users, eq(messages.authorUserId, users.id))
        .where(whereClause)
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

      return {
        cursorResolved: true,
        items,
        nextCursor,
      };
    },
  };
}
