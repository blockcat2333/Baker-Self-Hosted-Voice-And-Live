import { describe, expect, it } from 'vitest';

import { GatewayEnvelopeSchema, createEventEnvelope } from './envelope';

describe('GatewayEnvelopeSchema', () => {
  it('parses a system.ready event envelope', () => {
    const envelope = createEventEnvelope(1, 'system.ready', {
      capabilities: {
        chat: true,
        presence: true,
        stream: false,
        voice: false,
      },
      connectionId: 'conn-1',
      serverTime: new Date().toISOString(),
    });

    const parsed = GatewayEnvelopeSchema.parse(envelope);

    expect(parsed.op).toBe('event');
    expect(parsed).toMatchObject({
      event: 'system.ready',
      seq: 1,
      v: 1,
    });
  });

  it('parses a stream.state.updated snapshot with no active session', () => {
    const envelope = createEventEnvelope(2, 'stream.state.updated', {
      channelId: '11111111-1111-1111-1111-111111111111',
      session: null,
      streams: [],
      viewers: [],
    });

    const parsed = GatewayEnvelopeSchema.parse(envelope);

    expect(parsed.op).toBe('event');
    expect(parsed).toMatchObject({
      event: 'stream.state.updated',
      seq: 2,
      v: 1,
    });
  });

  it('parses a multi-stream room snapshot with compatibility fields', () => {
    const envelope = createEventEnvelope(3, 'stream.state.updated', {
      channelId: '11111111-1111-1111-1111-111111111111',
      session: {
        hostUserId: '22222222-2222-2222-2222-222222222222',
        sessionId: '33333333-3333-3333-3333-333333333333',
        sourceType: 'screen',
        status: 'live',
        streamId: '44444444-4444-4444-4444-444444444444',
      },
      streams: [
        {
          channelId: '11111111-1111-1111-1111-111111111111',
          hostUserId: '22222222-2222-2222-2222-222222222222',
          sessionId: '33333333-3333-3333-3333-333333333333',
          sourceType: 'screen',
          status: 'live',
          streamId: '44444444-4444-4444-4444-444444444444',
          viewers: [
            {
              sessionId: '55555555-5555-5555-5555-555555555555',
              userId: '66666666-6666-6666-6666-666666666666',
            },
          ],
        },
      ],
      viewers: [
        {
          sessionId: '55555555-5555-5555-5555-555555555555',
          userId: '66666666-6666-6666-6666-666666666666',
        },
      ],
    });

    const parsed = GatewayEnvelopeSchema.parse(envelope);

    expect(parsed.op).toBe('event');
    expect(parsed).toMatchObject({
      event: 'stream.state.updated',
      seq: 3,
      v: 1,
    });
  });
});
