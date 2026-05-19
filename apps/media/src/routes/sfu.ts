import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  MediaSfuCloseCommandDataSchema,
  MediaSfuConnectTransportCommandDataSchema,
  MediaSfuConsumeAckDataSchema,
  MediaSfuConsumeCommandDataSchema,
  MediaSfuCreateTransportAckDataSchema,
  MediaSfuCreateTransportCommandDataSchema,
  MediaSfuProduceAckDataSchema,
  MediaSfuProduceCommandDataSchema,
  MediaSfuResumeConsumerCommandDataSchema,
} from '@baker/protocol';

import type { MediaAdapter } from '../adapters/media-adapter';
import { isInternalMediaRequestAuthorized, rejectUnauthorizedInternalMediaRequest } from '../lib/internal-auth';

interface SfuRouteRegistrar {
  post(path: string, handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>): unknown;
}

function validationError(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'VALIDATION_ERROR',
    message: 'Invalid SFU request.',
  });
}

function sfuError(reply: FastifyReply, err: unknown) {
  return reply.status(409).send({
    code: 'MEDIA_NEGOTIATION_TIMEOUT',
    message: err instanceof Error ? err.message : 'SFU operation failed.',
  });
}

export function registerSfuRoutes(app: SfuRouteRegistrar, adapter: MediaAdapter) {
  app.post('/v1/internal/media/sfu/transports', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    const parsed = MediaSfuCreateTransportCommandDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply);
    }

    try {
      return reply.send(MediaSfuCreateTransportAckDataSchema.parse(await adapter.createSfuTransport(parsed.data)));
    } catch (err) {
      return sfuError(reply, err);
    }
  });

  app.post('/v1/internal/media/sfu/transports/connect', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    const parsed = MediaSfuConnectTransportCommandDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply);
    }

    try {
      await adapter.connectSfuTransport(parsed.data);
      return reply.send({ connected: true });
    } catch (err) {
      return sfuError(reply, err);
    }
  });

  app.post('/v1/internal/media/sfu/producers', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    const parsed = MediaSfuProduceCommandDataSchema.safeParse(request.body);
    const userId = typeof (request.body as { userId?: unknown })?.userId === 'string'
      ? (request.body as { userId: string }).userId
      : '';
    if (!parsed.success) {
      return validationError(reply);
    }
    if (!userId) {
      return validationError(reply);
    }

    try {
      return reply.send(MediaSfuProduceAckDataSchema.parse(await adapter.produceSfu({ ...parsed.data, userId })));
    } catch (err) {
      return sfuError(reply, err);
    }
  });

  app.post('/v1/internal/media/sfu/consumers', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    const parsed = MediaSfuConsumeCommandDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply);
    }

    try {
      return reply.send(MediaSfuConsumeAckDataSchema.parse(await adapter.consumeSfu(parsed.data)));
    } catch (err) {
      return sfuError(reply, err);
    }
  });

  app.post('/v1/internal/media/sfu/consumers/resume', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    const parsed = MediaSfuResumeConsumerCommandDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply);
    }

    try {
      await adapter.resumeSfuConsumer(parsed.data);
      return reply.send({ resumed: true });
    } catch (err) {
      return sfuError(reply, err);
    }
  });

  app.post('/v1/internal/media/sfu/close', async (request, reply) => {
    if (!isInternalMediaRequestAuthorized(request)) {
      return rejectUnauthorizedInternalMediaRequest(reply);
    }

    const parsed = MediaSfuCloseCommandDataSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply);
    }

    try {
      return reply.send(await adapter.closeSfu(parsed.data));
    } catch (err) {
      return sfuError(reply, err);
    }
  });
}
