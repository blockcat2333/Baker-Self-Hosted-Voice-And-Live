import { index } from 'drizzle-orm/pg-core';
import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { channels } from './channels';
import { users } from './users';

export const messageKindEnum = pgEnum('message_kind', ['system', 'text']);

export const messages = pgTable(
  'messages',
  {
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    id: uuid('id').primaryKey().defaultRandom(),
    kind: messageKindEnum('kind').notNull().default('text'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    channelCreatedAtIdx: index('messages_channel_created_at_idx').on(table.channelId, table.createdAt, table.id),
  }),
);
