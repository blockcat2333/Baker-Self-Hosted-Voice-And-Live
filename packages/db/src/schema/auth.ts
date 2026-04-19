import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const authSessions = pgTable(
  'auth_sessions',
  {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    id: uuid('id').primaryKey().defaultRandom(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    userIdx: index('auth_sessions_user_idx').on(table.userId),
  }),
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    sessionIdx: index('refresh_tokens_session_idx').on(table.sessionId),
    userIdx: index('refresh_tokens_user_idx').on(table.userId),
  }),
);
