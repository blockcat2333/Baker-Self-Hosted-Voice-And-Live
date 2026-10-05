import { describe, expect, it, vi } from 'vitest';
import type { SfuProducer } from '@baker/protocol';

import { assertSelectedProducerCodec, SfuClientSession } from './sfu-client';

describe('strict SFU video codec selection', () => {
  it('accepts the selected AV1 primary codec with RTX', () => {
    expect(() =>
      assertSelectedProducerCodec(
        [{ mimeType: 'video/AV1' }, { mimeType: 'video/rtx' }],
        'av1',
      ),
    ).not.toThrow();
  });

  it('rejects an H264 producer when AV1 was selected', () => {
    expect(() =>
      assertSelectedProducerCodec([{ mimeType: 'video/H264' }], 'av1'),
    ).toThrow(/actual: H264.*no fallback codec/i);
  });
});

describe('SFU consumer recovery', () => {
  it('preserves video bitrate settings while prioritizing voice', async () => {
    const produce = vi.fn().mockResolvedValue({ id: 'producer', on: vi.fn() });
    const createSession = (mode: 'voice' | 'stream_publish') => {
      const session = new SfuClientSession({ channelId: 'channel', mode, sessionId: 'session' }, vi.fn());
      (session as unknown as { sendTransport: unknown }).sendTransport = { produce };
      return session;
    };
    await createSession('voice').produceTracks([{ kind: 'audio' } as MediaStreamTrack]);
    expect(produce).toHaveBeenLastCalledWith(expect.objectContaining({
      encodings: [{ priority: 'high', networkPriority: 'high' }],
    }));
    await createSession('stream_publish').produceTracks([{ kind: 'video' } as MediaStreamTrack], {
      maxVideoBitrateKbps: 4000, maxVideoFramerate: 30,
    });
    expect(produce).toHaveBeenLastCalledWith(expect.objectContaining({
      codecOptions: { videoGoogleMaxBitrate: 4000, videoGoogleStartBitrate: 4000 },
      encodings: [{ maxBitrate: 4_000_000, maxFramerate: 30, priority: 'low', networkPriority: 'low' }],
    }));
  });

  it('allows the same producer to be retried after resume acknowledgement times out', async () => {
    const consumer = { id: 'consumer-1', close: vi.fn(), on: vi.fn(), track: {} };
    const transport = { id: 'transport-1', consume: vi.fn().mockResolvedValue(consumer) };
    const sendCommand = vi.fn(async (command: string) => {
      if (command === 'media.sfu.consume') return {
        id: 'consumer-1', consumerId: 'consumer-1', producerId: 'producer-1', kind: 'audio', rtpParameters: {}, producerPaused: false, type: 'simple',
      };
      return {};
    });
    const session = new SfuClientSession({ channelId: 'channel', mode: 'voice', sessionId: 'session' }, sendCommand);
    // Isolate browser transport negotiation from the acknowledgement lifecycle.
    const internals = session as unknown as {
      device: { rtpCapabilities: Record<string, unknown> }; recvTransport: typeof transport;
    };
    internals.device = { rtpCapabilities: {} };
    internals.recvTransport = transport;
    const producer = { id: 'producer-1', kind: 'audio', userId: 'remote' } as SfuProducer;
    sendCommand.mockImplementationOnce(async () => ({
      id: 'consumer-1', consumerId: 'consumer-1', producerId: 'producer-1', kind: 'audio', rtpParameters: {}, producerPaused: false, type: 'simple',
    }));
    sendCommand.mockRejectedValueOnce(new Error('resume timed out'));
    await expect(session.consumeProducer(producer)).rejects.toThrow('resume timed out');
    expect(consumer.close).toHaveBeenCalledOnce();
    await expect(session.consumeProducer(producer)).resolves.toMatchObject({ consumerId: 'consumer-1' });
    expect(transport.consume).toHaveBeenCalledTimes(2);
  });
});
