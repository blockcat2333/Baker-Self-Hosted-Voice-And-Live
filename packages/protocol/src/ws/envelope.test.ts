import { describe, expect, it } from 'vitest';

import { SessionModeSchema, SfuProducerSourceSchema } from '../media/signaling';
import { GatewayCommandNameSchema } from './events';
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

  it('parses music protocol commands, session modes, and SFU producer source', () => {
    expect(GatewayCommandNameSchema.parse('music.start')).toBe('music.start');
    expect(GatewayCommandNameSchema.parse('music.listen')).toBe('music.listen');
    expect(SessionModeSchema.parse('music_publish')).toBe('music_publish');
    expect(SessionModeSchema.parse('music_listen')).toBe('music_listen');
    expect(SfuProducerSourceSchema.parse('music')).toBe('music');
  });

  it('parses a music.state.updated snapshot with multiple publications and listeners', () => {
    const envelope = createEventEnvelope(4, 'music.state.updated', {
      channelId: '11111111-1111-1111-1111-111111111111',
      publications: [
        {
          channelId: '11111111-1111-1111-1111-111111111111',
          hostUserId: '22222222-2222-2222-2222-222222222222',
          listeners: [
            {
              sessionId: '33333333-3333-3333-3333-333333333333',
              userId: '44444444-4444-4444-4444-444444444444',
            },
          ],
          musicId: '55555555-5555-5555-5555-555555555555',
          sessionId: '66666666-6666-6666-6666-666666666666',
          status: 'live',
        },
        {
          channelId: '11111111-1111-1111-1111-111111111111',
          hostUserId: '77777777-7777-7777-7777-777777777777',
          listeners: [],
          musicId: '88888888-8888-8888-8888-888888888888',
          sessionId: '99999999-9999-9999-9999-999999999999',
          status: 'live',
        },
      ],
    });

    const parsed = GatewayEnvelopeSchema.parse(envelope);

    expect(parsed.op).toBe('event');
    expect(parsed).toMatchObject({
      event: 'music.state.updated',
      seq: 4,
      v: 1,
    });
  });
});
