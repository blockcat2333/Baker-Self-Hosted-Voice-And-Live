import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import type { authSessions, refreshTokens } from '../schema/auth';
import type { channels } from '../schema/channels';
import type { guildMembers, guilds } from '../schema/guilds';
import type { messages } from '../schema/messages';
import type { serverSettings } from '../schema/server-settings';
import type { streamSessions } from '../schema/streams';
import type { users } from '../schema/users';

export type AuthSessionRecord = InferSelectModel<typeof authSessions>;
export type ChannelRecord = InferSelectModel<typeof channels>;
export type ServerSettingsRecord = InferSelectModel<typeof serverSettings>;
export type CreateAuthSessionInput = Pick<InferInsertModel<typeof authSessions>, 'userId'>;
export type CreateChannelInput = Pick<InferInsertModel<typeof channels>, 'guildId' | 'name' | 'position' | 'topic' | 'type' | 'voiceQuality'>;
export type UpdateChannelInput = Partial<Pick<InferInsertModel<typeof channels>, 'name' | 'topic' | 'voiceQuality'>>;
export type CreateGuildInput = Pick<InferInsertModel<typeof guilds>, 'name' | 'ownerUserId' | 'slug'>;
export type UpdateGuildInput = Partial<Pick<InferInsertModel<typeof guilds>, 'name'>>;
export type CreateGuildMemberInput = Pick<InferInsertModel<typeof guildMembers>, 'guildId' | 'nickname' | 'userId'>;
export type CreateMessageInput = Pick<InferInsertModel<typeof messages>, 'authorUserId' | 'channelId' | 'content' | 'kind' | 'metadata'>;
export type CreateRefreshTokenInput = Pick<
  InferInsertModel<typeof refreshTokens>,
  'expiresAt' | 'sessionId' | 'tokenHash' | 'userId'
>;
export interface CreateStreamSessionInput {
  channelId: string;
  hostUserId: string;
  id: string;
  metadata?: InferInsertModel<typeof streamSessions>['metadata'];
  sourceType: InferInsertModel<typeof streamSessions>['sourceType'];
}
export type CreateServerSettingsInput = Pick<
  InferInsertModel<typeof serverSettings>,
  'adminPasswordHash' | 'allowPublicRegistration' | 'appPort' | 'id' | 'serverName' | 'webEnabled' | 'webPort'
>;
export type UpdateServerSettingsInput = Partial<Pick<
  InferInsertModel<typeof serverSettings>,
  'adminPasswordHash' | 'allowPublicRegistration' | 'appPort' | 'serverName' | 'webEnabled' | 'webPort'
>>;
export type CreateUserInput = Pick<InferInsertModel<typeof users>, 'email' | 'passwordHash' | 'username'>;
export type UpdateUserInput = Pick<InferInsertModel<typeof users>, 'username'>;
export type GuildMemberRecord = InferSelectModel<typeof guildMembers>;
export type GuildRecord = InferSelectModel<typeof guilds>;
export type MessageRecord = InferSelectModel<typeof messages>;
export type MessageWithAuthorRecord = MessageRecord & { authorUsername: string };
export type RefreshTokenRecord = InferSelectModel<typeof refreshTokens>;
export type StreamSessionRecord = InferSelectModel<typeof streamSessions>;
export type StreamSourceType = StreamSessionRecord['sourceType'];
export type StreamStatus = StreamSessionRecord['status'];
export type UserRecord = InferSelectModel<typeof users>;

export interface UsersRepository {
  create(input: CreateUserInput): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  update(id: string, input: UpdateUserInput): Promise<UserRecord | null>;
}

export interface AuthSessionsRepository {
  create(input: CreateAuthSessionInput): Promise<AuthSessionRecord>;
  findById(id: string): Promise<AuthSessionRecord | null>;
  revoke(id: string): Promise<AuthSessionRecord | null>;
  touch(id: string): Promise<AuthSessionRecord | null>;
}

export interface RefreshTokensRepository {
  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  findActiveByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revoke(id: string): Promise<RefreshTokenRecord | null>;
  revokeBySessionId(sessionId: string): Promise<void>;
}

export interface GuildsRepository {
  create(input: CreateGuildInput): Promise<GuildRecord>;
  findById(id: string): Promise<GuildRecord | null>;
  findBySlug(slug: string): Promise<GuildRecord | null>;
  listForUser(userId: string): Promise<GuildRecord[]>;
  update(id: string, input: UpdateGuildInput): Promise<GuildRecord | null>;
}

export interface GuildMembersRepository {
  add(input: CreateGuildMemberInput): Promise<GuildMemberRecord>;
  findMembership(guildId: string, userId: string): Promise<GuildMemberRecord | null>;
}

export interface ChannelsRepository {
  create(input: CreateChannelInput): Promise<ChannelRecord>;
  findById(channelId: string): Promise<ChannelRecord | null>;
  findAccessibleById(channelId: string, userId: string): Promise<ChannelRecord | null>;
  listByGuild(guildId: string): Promise<ChannelRecord[]>;
  listByGuildForUser(guildId: string, userId: string): Promise<ChannelRecord[]>;
  update(channelId: string, input: UpdateChannelInput): Promise<ChannelRecord | null>;
}

export interface MessagePageResult {
  cursorResolved: boolean;
  items: MessageWithAuthorRecord[];
  nextCursor: string | null;
}

export interface MessagesRepository {
  create(input: CreateMessageInput): Promise<MessageRecord>;
  listByChannel(input: { beforeId?: string; channelId: string; limit: number }): Promise<MessagePageResult>;
}

export interface StreamSessionsRepository {
  create(input: CreateStreamSessionInput): Promise<StreamSessionRecord>;
  /**
   * Deprecated single-stream compatibility helper.
   * Returns the first active stream for a channel, if any.
   */
  findActiveByChannel(channelId: string): Promise<StreamSessionRecord | null>;
  findActiveByChannelAndHostUser(channelId: string, hostUserId: string): Promise<StreamSessionRecord | null>;
  findById(id: string): Promise<StreamSessionRecord | null>;
  listActiveByChannel(channelId: string): Promise<StreamSessionRecord[]>;
  updateStatus(id: string, status: StreamStatus, opts?: { endedAt?: Date; startedAt?: Date }): Promise<void>;
}

export interface ServerSettingsRepository {
  create(input: CreateServerSettingsInput): Promise<ServerSettingsRecord>;
  findById(id: string): Promise<ServerSettingsRecord | null>;
  update(id: string, input: UpdateServerSettingsInput): Promise<ServerSettingsRecord | null>;
}

export interface RepositoryContext {
  authSessions: AuthSessionsRepository;
  channels: ChannelsRepository;
  guildMembers: GuildMembersRepository;
  guilds: GuildsRepository;
  messages: MessagesRepository;
  refreshTokens: RefreshTokensRepository;
  serverSettings: ServerSettingsRepository;
  streamSessions: StreamSessionsRepository;
  users: UsersRepository;
}

export interface DatabaseAccess extends RepositoryContext {
  close(): Promise<void>;
  withTransaction<T>(operation: (repositories: RepositoryContext) => Promise<T>): Promise<T>;
}
