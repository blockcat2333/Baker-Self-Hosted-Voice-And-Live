import { boolean, integer, pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const mediaTransportModeEnum = pgEnum('media_transport_mode', ['p2p', 'sfu']);

export const serverSettings = pgTable('server_settings', {
  adminPasswordHash: text('admin_password_hash').notNull(),
  allowPublicRegistration: boolean('allow_public_registration').notNull().default(true),
  appPort: integer('app_port').notNull().default(5174),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  id: text('id').primaryKey(),
  mediaMode: mediaTransportModeEnum('media_mode').notNull().default('p2p'),
  serverName: text('server_name').notNull().default('Baker'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  webEnabled: boolean('web_enabled').notNull().default(true),
  webPort: integer('web_port').notNull().default(80),
});
