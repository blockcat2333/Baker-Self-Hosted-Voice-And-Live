import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  email: text('email').notNull().unique(),
  id: uuid('id').primaryKey().defaultRandom(),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull().default('active'),
  username: text('username').notNull(),
});
