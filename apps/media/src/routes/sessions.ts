import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { MediaSessionDescriptorSchema, MediaSessionResponseSchema } from '@baker/protocol';
import { createLogger, getIceConfig, parseAppEnv } from '@baker/shared';

import type { MediaAdapter } from '../adapters/media-adapter';
import { isInternalMediaRequestAuthorized, rejectUnauthorizedInternalMediaRequest } from '../lib/internal-auth';

interface SessionRouteRegistrar {
  post(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>): unknown;
}

export function registerSessionsRoute(app: SessionRouteRegistrar, adapter: MediaAdapter) {
  const log = createLogger('media:sessions');
  const env = parseAppEnv();
  const iceConfig = getIceConfig(env);
  log.info(
    {
      stunUrls: iceConfig.stunUrls,
      turnConfigured: iceConfig.turnUrls.length > 0,
      turnUrls: iceConfig.turnUrls.length > 0 ? iceConfig.turnUrls : undefined,
      turnUsernameConfigured: Boolean(iceConfig.turnUsername),
      turnPasswordConfigured: Boolean(iceConfig.turnPassword),
    },
    'ICE server config loaded',
  );

  /**
   * Build RTCIceServer[] from env config.
   * STUN and TURN are derived from shared env; TURN is omitted when unconfigured.
   */
  function buildIceServers() {
    const servers: { credential?: string; urls: string | string[]; username?: string }[] = [];

    if (iceConfig.stunUrls.length > 0) {
      servers.push({ urls: iceConfig.stunUrls });
    }

    if (iceConfig.turnUrls.length > 0) {
      if (!iceConfig.turnUsername || !iceConfig.turnPassword) {
        log.warn(
          {
            turnUrls: iceConfig.turnUrls,
            turnUsernameConfigured: Boolean(iceConfig.turnUsername),
            turnPasswordConfigured: Boolean(iceConfig.turnPassword),
          },
          'TURN_URLS is set but TURN_USERNAME/TURN_PASSWORD is missing; TURN may fail',
        );
      }
      servers.push({
        credential: iceConfig.turnPassword || undefined,
        urls: iceConfig.turnUrls,
        username: iceConfig.turnUsername || undefined,
      });
    }

    return servers;
  }

  app.post('/v1/internal/media/sessions', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    const bodyParsed = MediaSessionDescriptorSchema.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid session descriptor.',
      });
    }

    const descriptor = bodyParsed.data;
    await adapter.createSession(descriptor);

    const sessionId = randomUUID();

    return reply.send(
      MediaSessionResponseSchema.parse({
        iceServers: buildIceServers(),
        sessionId,
      }),
    );
  });
}
