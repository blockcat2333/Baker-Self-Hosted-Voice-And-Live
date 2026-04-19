import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { parseAppEnv } from '@baker/shared';

const env = parseAppEnv();
const expectedSecret = Buffer.from(env.MEDIA_INTERNAL_SECRET, 'utf8');

export function isInternalMediaRequestAuthorized(request: FastifyRequest) {
  const header = request.headers['x-baker-internal-secret'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided) {
    return false;
  }

  const providedBuffer = Buffer.from(provided, 'utf8');
  if (providedBuffer.length !== expectedSecret.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedSecret);
}

export function rejectUnauthorizedInternalMediaRequest(reply: FastifyReply) {
  return reply.status(401).send({
    code: 'UNAUTHORIZED',
    message: 'Internal media secret is required.',
  });
}
