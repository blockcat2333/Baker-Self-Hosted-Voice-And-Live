import { integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { guilds } from './guilds';

export const channelTypeEnum = pgEnum('channel_type', ['text', 'voice']);
export const voiceQualityEnum = pgEnum('voice_quality', ['standard', 'high']);

export const channels = pgTable('channels', {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  guildId: uuid('guild_id')
    .notNull()
    .references(() => guilds.id, { onDelete: 'cascade' }),
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  topic: text('topic'),
  type: channelTypeEnum('type').notNull(),
  voiceQuality: voiceQualityEnum('voice_quality').notNull().default('standard'),
});
