import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'CHANNEL_NOT_FOUND',
  'CHANNEL_NOT_TEXT',
  'FORBIDDEN',
  'GUILD_NOT_FOUND',
  'INTERNAL_SERVER_ERROR',
  'INVALID_CREDENTIALS',
  'INVALID_PAYLOAD',
  'MEDIA_NEGOTIATION_TIMEOUT',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'STREAM_ALREADY_ACTIVE',
  'STREAM_ALREADY_LIVE',
  'STREAM_ALREADY_WATCHING',
  'STREAM_NOT_FOUND',
  'STREAM_NOT_HOST',
  'STREAM_NOT_LIVE',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'UNAUTHORIZED',
  'UNSUPPORTED_COMMAND',
  'VALIDATION_ERROR',
  'VOICE_ALREADY_JOINED',
  'VOICE_NOT_JOINED',
]);

export const ErrorResponseSchema = z.object({
  code: ErrorCodeSchema,
  details: z.unknown().optional(),
  message: z.string().min(1),
});

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
