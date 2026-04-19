import fp from 'fastify-plugin';

import { createDatabaseAccess, type DatabaseAccess } from '@baker/db';
import { parseAppEnv } from '@baker/shared';

declare module 'fastify' {
  interface FastifyInstance {
    dataAccess: DatabaseAccess;
  }
}

export interface DatabasePluginOptions {
  dataAccess?: DatabaseAccess;
}

export const databasePlugin = fp<DatabasePluginOptions>(async (app, options) => {
  const env = parseAppEnv();
  const dataAccess = options.dataAccess ?? createDatabaseAccess(env.DATABASE_URL);

  app.decorate('dataAccess', dataAccess);

  if (!options.dataAccess) {
    app.addHook('onClose', async () => {
      await dataAccess.close();
    });
  }
});
