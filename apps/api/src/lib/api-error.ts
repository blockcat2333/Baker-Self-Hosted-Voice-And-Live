import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { ErrorResponseSchema, type ErrorCode } from '@baker/protocol';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function sendError(reply: FastifyReply, error: ApiError) {
  return reply.status(error.statusCode).send(
    ErrorResponseSchema.parse({
      code: error.code,
      details: error.details,
      message: error.message,
    }),
  );
}

export function handleApiError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiError) {
    return sendError(reply, error);
  }

  if (error instanceof ZodError) {
    return reply.status(400).send(
      ErrorResponseSchema.parse({
        code: 'VALIDATION_ERROR',
        details: error.flatten(),
        message: 'Request validation failed.',
      }),
    );
  }

  request.log.error({ err: error }, 'Unhandled API error');

  return reply.status(500).send(
    ErrorResponseSchema.parse({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    }),
  );
}
