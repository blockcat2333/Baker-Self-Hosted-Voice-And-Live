import { jsonb, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { channels } from './channels';
import { users } from './users';

export const streamSourceEnum = pgEnum('stream_source_type', ['camera', 'screen']);
export const streamStatusEnum = pgEnum('stream_status', ['failed', 'idle', 'live', 'starting', 'stopping']);

export const streamSessions = pgTable('stream_sessions', {
  channelId: uuid('channel_id')
    .notNull()
    .references(() => channels.id, { onDelete: 'cascade' }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  hostUserId: uuid('host_user_id')
    .notNull()
    .references(() => users.id),
  id: uuid('id').primaryKey().defaultRandom(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  sourceType: streamSourceEnum('source_type').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  status: streamStatusEnum('status').notNull().default('idle'),
});
