import type { FastifyReply, FastifyRequest } from 'fastify';

import { MediaSessionDescriptorSchema, MediaSessionResponseSchema } from '@baker/protocol';
import {
  createLogger,
  getDefaultMediaRegionProfile,
  parseAppEnv,
  parseMediaRegionProfiles,
  resolveMediaRegionProfileById,
  type MediaRegionProfile,
} from '@baker/shared';

import type { MediaAdapter } from '../adapters/media-adapter';
import { isInternalMediaRequestAuthorized, rejectUnauthorizedInternalMediaRequest } from '../lib/internal-auth';

interface SessionRouteRegistrar {
  post(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>): unknown;
}

export function registerSessionsRoute(app: SessionRouteRegistrar, adapter: MediaAdapter) {
  const log = createLogger('media:sessions');
  const env = parseAppEnv();
  const defaultProfile = getDefaultMediaRegionProfile(env);
  const mediaRegionProfiles = parseMediaRegionProfiles(env);
  log.info(
    {
      defaultStunUrls: defaultProfile.stunUrls,
      mediaRegionProfiles: mediaRegionProfiles.map((profile) => ({
        hosts: profile.hosts,
        id: profile.id,
        sfuAnnouncedIpConfigured: profile.sfuAnnouncedIp.length > 0,
        turnConfigured: profile.turnUrls.length > 0,
      })),
      turnConfigured: defaultProfile.turnUrls.length > 0,
      turnUrls: defaultProfile.turnUrls.length > 0 ? defaultProfile.turnUrls : undefined,
      turnUsernameConfigured: Boolean(defaultProfile.turnUsername),
      turnPasswordConfigured: Boolean(defaultProfile.turnPassword),
    },
    'ICE server config loaded',
  );

  function resolveProfile(mediaRegionId: string | undefined): MediaRegionProfile | null {
    if (!mediaRegionId) {
      return defaultProfile;
    }
    return resolveMediaRegionProfileById(mediaRegionProfiles, mediaRegionId);
  }

  /**
   * Build RTCIceServer[] from env config.
   * STUN and TURN are derived from shared env; TURN is omitted when unconfigured.
   */
  function buildIceServers(profile: MediaRegionProfile) {
    const servers: { credential?: string; urls: string | string[]; username?: string }[] = [];

    if (profile.stunUrls.length > 0) {
      servers.push({ urls: profile.stunUrls });
    }

    if (profile.turnUrls.length > 0) {
      if (!profile.turnUsername || !profile.turnPassword) {
        log.warn(
          {
            mediaRegionId: profile.id,
            turnUrls: profile.turnUrls,
            turnUsernameConfigured: Boolean(profile.turnUsername),
            turnPasswordConfigured: Boolean(profile.turnPassword),
          },
          'TURN_URLS is set but TURN_USERNAME/TURN_PASSWORD is missing; TURN may fail',
        );
      }
      servers.push({
        credential: profile.turnPassword || undefined,
        urls: profile.turnUrls,
        username: profile.turnUsername || undefined,
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
    const profile = resolveProfile(descriptor.mediaRegionId);
    if (!profile) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Unknown media region profile.',
      });
    }
    await adapter.createSession(descriptor);

    let sfu: Awaited<ReturnType<MediaAdapter['getSfuSessionInfo']>> | undefined;
    if (descriptor.transportMode === 'sfu') {
      try {
        sfu = await adapter.getSfuSessionInfo(descriptor);
      } catch (err) {
        log.warn({ err, channelId: descriptor.channelId, sessionId: descriptor.sessionId }, 'SFU session info failed');
        await adapter.closeSfu(descriptor).catch(() => undefined);
        return reply.status(503).send({
          code: 'SFU_UNAVAILABLE',
          message: 'Failed to prepare SFU media session.',
        });
      }
    }

    return reply.send(
      MediaSessionResponseSchema.parse({
        iceServers: buildIceServers(profile),
        sessionId: descriptor.sessionId,
        ...(sfu ? { sfu } : {}),
      }),
    );
  });
}
