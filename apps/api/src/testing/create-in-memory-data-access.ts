import { randomUUID } from 'node:crypto';

import type {
  AuthSessionRecord,
  ChannelRecord,
  DatabaseAccess,
  GuildMemberRecord,
  GuildRecord,
  MessageRecord,
  MessageWithAuthorRecord,
  RefreshTokenRecord,
  RepositoryContext,
  ServerSettingsRecord,
  StreamSessionRecord,
  UserRecord,
} from '@baker/db';

function compareDatesDesc(left: Date, right: Date) {
  return right.getTime() - left.getTime();
}

function compareStringsDesc(left: string, right: string) {
  return right.localeCompare(left);
}

function compareOptionalDatesDesc(left: Date | null, right: Date | null) {
  if (left && right) {
    return compareDatesDesc(left, right);
  }
  if (left) {
    return -1;
  }
  if (right) {
    return 1;
  }
  return 0;
}

export function createInMemoryDataAccess(): DatabaseAccess {
  const users = new Map<string, UserRecord>();
  const authSessions = new Map<string, AuthSessionRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();
  const guilds = new Map<string, GuildRecord>();
  const guildMembers = new Map<string, GuildMemberRecord>();
  const channels = new Map<string, ChannelRecord>();
  const messages = new Map<string, MessageRecord>();
  const serverSettings = new Map<string, ServerSettingsRecord>();
  const streamSessions = new Map<string, StreamSessionRecord>();

  function listActiveStreamSessionsByChannel(channelId: string): StreamSessionRecord[] {
    return Array.from(streamSessions.values())
      .filter(
        (session) =>
          session.channelId === channelId &&
          session.endedAt == null &&
          (session.status === 'starting' || session.status === 'live'),
      )
      .sort(
        (left, right) =>
          compareOptionalDatesDesc(left.startedAt, right.startedAt) || compareStringsDesc(left.id, right.id),
      );
  }

  const repositories: RepositoryContext = {
    authSessions: {
      async create(input) {
        const session: AuthSessionRecord = {
          createdAt: new Date(),
          id: randomUUID(),
          lastSeenAt: new Date(),
          revokedAt: null,
          userId: input.userId,
        };
        authSessions.set(session.id, session);
        return session;
      },
      async findById(id) {
        return authSessions.get(id) ?? null;
      },
      async revoke(id) {
        const session = authSessions.get(id);
        if (!session) {
          return null;
        }

        const updated: AuthSessionRecord = {
          ...session,
          revokedAt: new Date(),
        };
        authSessions.set(id, updated);
        return updated;
      },
      async touch(id) {
        const session = authSessions.get(id);
        if (!session) {
          return null;
        }

        const updated: AuthSessionRecord = {
          ...session,
          lastSeenAt: new Date(),
        };
        authSessions.set(id, updated);
        return updated;
      },
    },
    channels: {
      async create(input) {
        const channel: ChannelRecord = {
          createdAt: new Date(),
          guildId: input.guildId,
          id: randomUUID(),
          name: input.name,
          position: input.position ?? 0,
          topic: input.topic ?? null,
          type: input.type,
          voiceQuality: input.voiceQuality ?? 'standard',
        };
        channels.set(channel.id, channel);
        return channel;
      },
      async delete(channelId) {
        const channel = channels.get(channelId);
        if (!channel) {
          return null;
        }

        channels.delete(channelId);

        for (const [messageId, message] of messages.entries()) {
          if (message.channelId === channelId) {
            messages.delete(messageId);
          }
        }

        for (const [sessionId, session] of streamSessions.entries()) {
          if (session.channelId === channelId) {
            streamSessions.delete(sessionId);
          }
        }

        return channel;
      },
      async findAccessibleById(channelId, userId) {
        const channel = channels.get(channelId);
        if (!channel) {
          return null;
        }

        const membership = Array.from(guildMembers.values()).find(
          (entry) => entry.guildId === channel.guildId && entry.userId === userId,
        );

        return membership ? channel : null;
      },
      async findById(channelId) {
        return channels.get(channelId) ?? null;
      },
      async listByGuildForUser(guildId, userId) {
        const membership = Array.from(guildMembers.values()).find(
          (entry) => entry.guildId === guildId && entry.userId === userId,
        );

        if (!membership) {
          return [];
        }

        return Array.from(channels.values())
          .filter((channel) => channel.guildId === guildId)
          .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
      },
      async listByGuild(guildId) {
        return Array.from(channels.values())
          .filter((channel) => channel.guildId === guildId)
          .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
      },
      async update(channelId, input) {
        const channel = channels.get(channelId);
        if (!channel) {
          return null;
        }

        const updated: ChannelRecord = {
          ...channel,
          ...input,
        };
        channels.set(channelId, updated);
        return updated;
      },
    },
    guildMembers: {
      async add(input) {
        const member: GuildMemberRecord = {
          guildId: input.guildId,
          joinedAt: new Date(),
          nickname: input.nickname ?? null,
          userId: input.userId,
        };
        guildMembers.set(`${input.guildId}:${input.userId}`, member);
        return member;
      },
      async findMembership(guildId, userId) {
        return guildMembers.get(`${guildId}:${userId}`) ?? null;
      },
    },
    guilds: {
      async create(input) {
        const guild: GuildRecord = {
          createdAt: new Date(),
          id: randomUUID(),
          name: input.name,
          ownerUserId: input.ownerUserId,
          slug: input.slug,
        };
        guilds.set(guild.id, guild);
        return guild;
      },
      async findById(id) {
        return guilds.get(id) ?? null;
      },
      async findBySlug(slug) {
        return Array.from(guilds.values()).find((guild) => guild.slug === slug) ?? null;
      },
      async listForUser(userId) {
        const membershipGuildIds = new Set(
          Array.from(guildMembers.values())
            .filter((entry) => entry.userId === userId)
            .map((entry) => entry.guildId),
        );

        return Array.from(guilds.values())
          .filter((guild) => membershipGuildIds.has(guild.id))
          .sort((left, right) => compareDatesDesc(left.createdAt, right.createdAt) || compareStringsDesc(left.id, right.id));
      },
      async update(id, input) {
        const guild = guilds.get(id);
        if (!guild) {
          return null;
        }

        const updated: GuildRecord = {
          ...guild,
          ...input,
        };
        guilds.set(id, updated);
        return updated;
      },
    },
    messages: {
      async create(input) {
        const message: MessageRecord = {
          authorUserId: input.authorUserId,
          channelId: input.channelId,
          content: input.content,
          createdAt: new Date(),
          editedAt: null,
          id: randomUUID(),
          kind: input.kind ?? 'text',
          metadata: input.metadata ?? {},
        };
        messages.set(message.id, message);
        return message;
      },
      async listByChannel(input) {
        function withAuthor(message: MessageRecord): MessageWithAuthorRecord {
          return {
            ...message,
            authorUsername: users.get(message.authorUserId)?.username ?? message.authorUserId,
          };
        }

        const channelMessages = Array.from(messages.values())
          .filter((message) => message.channelId === input.channelId)
          .sort(
            (left, right) =>
              compareDatesDesc(left.createdAt, right.createdAt) || compareStringsDesc(left.id, right.id),
          );

        if (!input.beforeId) {
          const items = channelMessages.slice(0, input.limit).map(withAuthor);
          return {
            cursorResolved: true,
            items,
            nextCursor: channelMessages.length > input.limit ? items[items.length - 1]?.id ?? null : null,
          };
        }

        const cursorIndex = channelMessages.findIndex((message) => message.id === input.beforeId);
        if (cursorIndex === -1) {
          return {
            cursorResolved: false,
            items: [],
            nextCursor: null,
          };
        }

        const pagedMessages = channelMessages.slice(cursorIndex + 1, cursorIndex + 1 + input.limit + 1);
        const hasMore = pagedMessages.length > input.limit;
        const items = (hasMore ? pagedMessages.slice(0, input.limit) : pagedMessages).map(withAuthor);

        return {
          cursorResolved: true,
          items,
          nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
        };
      },
    },
    refreshTokens: {
      async create(input) {
        const refreshToken: RefreshTokenRecord = {
          createdAt: new Date(),
          expiresAt: input.expiresAt,
          id: randomUUID(),
          revokedAt: null,
          sessionId: input.sessionId,
          tokenHash: input.tokenHash,
          userId: input.userId,
        };
        refreshTokens.set(refreshToken.id, refreshToken);
        return refreshToken;
      },
      async findActiveByTokenHash(tokenHash) {
        return (
          Array.from(refreshTokens.values()).find(
            (token) => token.tokenHash === tokenHash && token.revokedAt == null,
          ) ?? null
        );
      },
      async revoke(id) {
        const token = refreshTokens.get(id);
        if (!token) {
          return null;
        }

        const updated: RefreshTokenRecord = {
          ...token,
          revokedAt: new Date(),
        };
        refreshTokens.set(id, updated);
        return updated;
      },
      async revokeBySessionId(sessionId) {
        for (const [id, token] of refreshTokens.entries()) {
          if (token.sessionId !== sessionId || token.revokedAt != null) {
            continue;
          }

          refreshTokens.set(id, {
            ...token,
            revokedAt: new Date(),
          });
        }
      },
    },
    serverSettings: {
      async create(input) {
        const settings: ServerSettingsRecord = {
          adminPasswordHash: input.adminPasswordHash,
          allowPublicRegistration: input.allowPublicRegistration ?? true,
          appPort: input.appPort ?? 5174,
          createdAt: new Date(),
          id: input.id,
          serverName: input.serverName ?? 'Baker',
          updatedAt: new Date(),
          webEnabled: input.webEnabled ?? true,
          webPort: input.webPort ?? 80,
        };
        serverSettings.set(settings.id, settings);
        return settings;
      },
      async findById(id) {
        return serverSettings.get(id) ?? null;
      },
      async update(id, input) {
        const settings = serverSettings.get(id);
        if (!settings) {
          return null;
        }

        const updated: ServerSettingsRecord = {
          ...settings,
          ...input,
          updatedAt: new Date(),
        };
        serverSettings.set(id, updated);
        return updated;
      },
    },
    streamSessions: {
      async create(input) {
        const session: StreamSessionRecord = {
          channelId: input.channelId,
          endedAt: null,
          hostUserId: input.hostUserId,
          id: input.id,
          metadata: input.metadata ?? {},
          sourceType: input.sourceType,
          startedAt: null,
          status: 'starting',
        };
        streamSessions.set(session.id, session);
        return session;
      },
      async findActiveByChannel(channelId) {
        const [session] = listActiveStreamSessionsByChannel(channelId);
        return session ?? null;
      },
      async findActiveByChannelAndHostUser(channelId, hostUserId) {
        return (
          Array.from(streamSessions.values()).find(
            (session) =>
              session.channelId === channelId &&
              session.hostUserId === hostUserId &&
              session.endedAt == null &&
              (session.status === 'starting' || session.status === 'live'),
          ) ?? null
        );
      },
      async findById(id) {
        return streamSessions.get(id) ?? null;
      },
      async listActiveByChannel(channelId) {
        return listActiveStreamSessionsByChannel(channelId);
      },
      async updateStatus(id, status, opts) {
        const session = streamSessions.get(id);
        if (!session) {
          return;
        }

        streamSessions.set(id, {
          ...session,
          endedAt: opts?.endedAt ?? session.endedAt,
          startedAt: opts?.startedAt ?? session.startedAt,
          status,
        });
      },
    },
    users: {
      async create(input) {
        const user: UserRecord = {
          createdAt: new Date(),
          email: input.email,
          id: randomUUID(),
          passwordHash: input.passwordHash,
          status: 'active',
          username: input.username,
        };
        users.set(user.id, user);
        return user;
      },
      async findByEmail(email) {
        return Array.from(users.values()).find((user) => user.email === email) ?? null;
      },
      async findById(id) {
        return users.get(id) ?? null;
      },
      async update(id, input) {
        const user = users.get(id);
        if (!user) {
          return null;
        }

        const updated: UserRecord = {
          ...user,
          ...input,
        };
        users.set(id, updated);
        return updated;
      },
    },
  };

  return {
    ...repositories,
    async close() {},
    async withTransaction<T>(operation: (transactionRepositories: RepositoryContext) => Promise<T>) {
      return operation(repositories);
    },
  };
}
