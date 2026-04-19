import type { IncomingMessage, ServerResponse } from 'node:http';

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';

import type { DatabaseAccess } from '@baker/db';
import { ServiceManifestSchema } from '@baker/protocol';
import { createLogger, parseAppEnv, type Logger } from '@baker/shared';

import { handleApiError } from './lib/api-error';
import {
  createRedisClient,
  createRedisPublisher,
  tryConnectRedisPublisher,
  type RedisPublisher,
} from './lib/redis-publisher';
import { createTokenService, type TokenService } from './lib/token-service';
import { authPlugin } from './plugins/auth';
import { databasePlugin } from './plugins/db';
import { registerAuthRoutes } from './routes/auth';
import { registerChannelRoutes } from './routes/channels';
import { registerGuildRoutes } from './routes/guilds';
import { registerHealthRoute } from './routes/health';
import { registerSystemRoutes } from './routes/system';
import { getOrCreateServerSettings } from './lib/server-settings';

declare module 'fastify' {
  interface FastifyInstance {
    publisher: RedisPublisher;
    tokenService: TokenService;
  }
}

export interface BuildApiAppOptions {
  dataAccess?: DatabaseAccess;
  publisher?: RedisPublisher;
  tokenService?: TokenService;
}

type ApiApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger
>;

export function buildApiApp(options: BuildApiAppOptions = {}): ApiApp {
  const env = parseAppEnv();
  const tokenService = options.tokenService ?? createTokenService(env);

  // Publisher defaults to a no-op client (null Redis) when not injected.
  // The real publisher is wired at startup in index.ts after Redis connects.
  const publisher = options.publisher ?? createRedisPublisher(null);

  const app = Fastify({
    loggerInstance: createLogger('api'),
  });

  app.decorate('tokenService', tokenService);
  app.decorate('publisher', publisher);
  app.setErrorHandler(handleApiError);

  void app.register(cors, { origin: true });
  void app.register(databasePlugin, { dataAccess: options.dataAccess });
  void app.register(authPlugin);
  registerHealthRoute(app);
  registerAuthRoutes(app);
  registerGuildRoutes(app);
  registerChannelRoutes(app);
  registerSystemRoutes(app);

  app.get('/v1/meta/services', async () => {
    const settings = await getOrCreateServerSettings(app.dataAccess);
    return ServiceManifestSchema.parse({
      generatedAt: new Date().toISOString(),
      services: [
        {
          description: 'Fastify HTTP API',
          name: 'api',
          url: `http://${env.API_HOST}:${env.API_PORT}`,
        },
        {
          description: 'WebSocket gateway',
          name: 'gateway',
          url: `ws://${env.GATEWAY_HOST}:${env.GATEWAY_PORT}/ws`,
        },
        {
          description: 'Media control-plane service',
          name: 'media',
          url: `http://${env.MEDIA_HOST}:${env.MEDIA_PORT}`,
        },
        {
          description: 'Browser client',
          name: 'web',
          url: `http://localhost:${settings.webPort}`,
        },
        {
          description: 'Electron shell',
          name: 'desktop',
          url: `http://localhost:${settings.appPort}`,
        },
      ],
    });
  });

  return app;
}

export { createRedisClient, createRedisPublisher, tryConnectRedisPublisher };
