import { createDatabaseClient, type DatabaseExecutor } from '../client';
import {
  createAuthSessionsRepository,
} from './auth-sessions-repository';
import { createChannelsRepository } from './channels-repository';
import { createGuildMembersRepository } from './guild-members-repository';
import { createGuildsRepository } from './guilds-repository';
import { createMessagesRepository } from './messages-repository';
import { createRefreshTokensRepository } from './refresh-tokens-repository';
import { createServerSettingsRepository } from './server-settings-repository';
import { createStreamSessionsRepository } from './stream-sessions-repository';
import type { DatabaseAccess, RepositoryContext } from './types';
import { createUsersRepository } from './users-repository';

export * from './types';

export function createRepositoryContext(executor: DatabaseExecutor): RepositoryContext {
  return {
    authSessions: createAuthSessionsRepository(executor),
    channels: createChannelsRepository(executor),
    guildMembers: createGuildMembersRepository(executor),
    guilds: createGuildsRepository(executor),
    messages: createMessagesRepository(executor),
    refreshTokens: createRefreshTokensRepository(executor),
    serverSettings: createServerSettingsRepository(executor),
    streamSessions: createStreamSessionsRepository(executor),
    users: createUsersRepository(executor),
  };
}

export function createDatabaseAccess(connectionString: string): DatabaseAccess {
  const client = createDatabaseClient(connectionString);
  const repositories = createRepositoryContext(client.db);

  return {
    ...repositories,
    close: client.close,
    async withTransaction<T>(operation: (transactionRepositories: RepositoryContext) => Promise<T>) {
      return client.db.transaction(async (transaction) => operation(createRepositoryContext(transaction)));
    },
  };
}
