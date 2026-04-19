import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const serverSettings = pgTable('server_settings', {
  adminPasswordHash: text('admin_password_hash').notNull(),
  allowPublicRegistration: boolean('allow_public_registration').notNull().default(true),
  appPort: integer('app_port').notNull().default(5174),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  id: text('id').primaryKey(),
  serverName: text('server_name').notNull().default('Baker'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  webEnabled: boolean('web_enabled').notNull().default(true),
  webPort: integer('web_port').notNull().default(80),
});
