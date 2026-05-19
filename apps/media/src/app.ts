import type { IncomingMessage, ServerResponse } from 'node:http';

import Fastify, { type FastifyInstance, type RawServerDefault } from 'fastify';

import { MediaCapabilitiesSchema } from '@baker/protocol';
import { createLogger, parseAppEnv, type Logger } from '@baker/shared';

import { MediasoupMediaAdapter } from './adapters/mediasoup-media-adapter';
import { isInternalMediaRequestAuthorized, rejectUnauthorizedInternalMediaRequest } from './lib/internal-auth';
import { registerHealthRoute } from './routes/health';
import { registerSessionsRoute } from './routes/sessions';
import { registerSfuRoutes } from './routes/sfu';

type MediaApp = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger
>;

export function buildMediaApp(): MediaApp {
  const app = Fastify({
    loggerInstance: createLogger('media'),
  });
  const adapter = new MediasoupMediaAdapter(parseAppEnv());

  registerHealthRoute(app);
  registerSessionsRoute(app, adapter);
  registerSfuRoutes(app, adapter);

  app.get('/v1/internal/media/capabilities', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    return reply.send(MediaCapabilitiesSchema.parse(adapter.getCapabilities()));
  });

  app.get('/v1/internal/media/health', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    return reply.send(adapter.getHealth());
  });

  return app;
}
