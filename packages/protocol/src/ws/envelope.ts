import { z } from 'zod';

import { ErrorCodeSchema } from '../errors';
import { GatewayCommandNameSchema, GatewayEventNameSchema } from './events';

export const GatewayEventEnvelopeSchema = z.object({
  data: z.unknown(),
  event: GatewayEventNameSchema,
  op: z.literal('event'),
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  v: z.literal(1),
});

export const GatewayCommandEnvelopeSchema = z.object({
  command: GatewayCommandNameSchema,
  data: z.unknown(),
  op: z.literal('command'),
  reqId: z.string().min(1),
  ts: z.string().datetime(),
  v: z.literal(1),
});

export const GatewayAckEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  op: z.literal('ack'),
  reqId: z.string().min(1),
  ts: z.string().datetime(),
  v: z.literal(1),
});

export const GatewayErrorEnvelopeSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  op: z.literal('error'),
  reqId: z.string().min(1).optional(),
  retryable: z.boolean(),
  ts: z.string().datetime(),
  v: z.literal(1),
});

export const GatewayHeartbeatEnvelopeSchema = z.object({
  op: z.enum(['ping', 'pong']),
  ts: z.string().datetime(),
  v: z.literal(1),
});

export const GatewayEnvelopeSchema = z.union([
  GatewayEventEnvelopeSchema,
  GatewayCommandEnvelopeSchema,
  GatewayAckEnvelopeSchema,
  GatewayErrorEnvelopeSchema,
  GatewayHeartbeatEnvelopeSchema,
]);

export type GatewayEnvelope = z.infer<typeof GatewayEnvelopeSchema>;

export function createEventEnvelope<TData>(seq: number, event: z.infer<typeof GatewayEventNameSchema>, data: TData) {
  return GatewayEventEnvelopeSchema.parse({
    data,
    event,
    op: 'event',
    seq,
    ts: new Date().toISOString(),
    v: 1,
  });
}

export function createAckEnvelope<TData>(reqId: string, data?: TData) {
  return GatewayAckEnvelopeSchema.parse({
    data,
    op: 'ack',
    reqId,
    ts: new Date().toISOString(),
    v: 1,
  });
}

export function createErrorEnvelope(input: {
  code: z.infer<typeof ErrorCodeSchema>;
  message: string;
  reqId?: string;
  retryable: boolean;
}) {
  return GatewayErrorEnvelopeSchema.parse({
    ...input,
    op: 'error',
    ts: new Date().toISOString(),
    v: 1,
  });
}

export function createHeartbeatEnvelope(op: 'ping' | 'pong') {
  return GatewayHeartbeatEnvelopeSchema.parse({
    op,
    ts: new Date().toISOString(),
    v: 1,
  });
}
