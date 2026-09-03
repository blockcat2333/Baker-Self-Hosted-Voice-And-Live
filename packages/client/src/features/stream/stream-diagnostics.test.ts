import { describe, expect, it } from 'vitest';
import type { StreamDiagnosticsGetAckData } from '@baker/protocol';

import { diagnoseStream } from './stream-diagnostics';

const base: StreamDiagnosticsGetAckData = {
  mediaMode: 'sfu',
  publisher: {
    actualCodec: 'av1',
    bitrateKbps: 4000,
    captureFrameRate: 30,
    encodedFrameRate: 30,
    encoderAcceleration: 'hardware',
    packetsLost: 0,
    packetsSent: 1000,
    qualityLimitationReason: 'none',
    requestedCodec: 'av1',
    roundTripTimeMs: 20,
    targetBitrateKbps: 4000,
    targetFrameRate: 30,
  },
  publisherSampledAt: 10_000,
  sampledAt: 10_000,
  sfu: {
    ingress: {
      bitrateKbps: 3900,
      bytes: 1,
      jitterMs: 2,
      nackCount: 0,
      packets: 1,
      packetsLost: 0,
      paused: false,
      pliCount: 0,
      retransmittedPackets: 0,
      score: 10,
    },
    egress: {
      bitrateKbps: 3800,
      bytes: 1,
      jitterMs: 2,
      nackCount: 0,
      packets: 1,
      packetsLost: 0,
      paused: false,
      pliCount: 0,
      retransmittedPackets: 0,
      score: 10,
    },
    queryLatencyMs: 2,
    workerCpuPct: 5,
  },
};

describe('diagnoseStream', () => {
  it('classifies healthy and stale samples', () => {
    expect(diagnoseStream(base, null, 10_000)).toBe('healthy');
    expect(diagnoseStream(base, null, 16_001)).toBe('insufficient');
  });
  it('separates sender, uplink, server, downlink, and decoder failures', () => {
    expect(
      diagnoseStream(
        { ...base, publisher: { ...base.publisher!, captureFrameRate: 10 } },
        null,
        10_000,
      ),
    ).toBe('sender_capture');
    expect(
      diagnoseStream(
        {
          ...base,
          publisher: { ...base.publisher!, qualityLimitationReason: 'cpu' },
        },
        null,
        10_000,
      ),
    ).toBe('sender_encode');
    expect(
      diagnoseStream(
        {
          ...base,
          sfu: { ...base.sfu!, ingress: { ...base.sfu!.ingress!, score: 4 } },
        },
        null,
        10_000,
      ),
    ).toBe('uplink');
    expect(
      diagnoseStream(
        { ...base, sfu: { ...base.sfu!, workerCpuPct: 90 } },
        null,
        10_000,
      ),
    ).toBe('server');
    expect(
      diagnoseStream(
        base,
        {
          averageDecodeTimeMs: 1,
          bitrateKbps: 1000,
          codec: 'AV1',
          decoderAcceleration: 'hardware',
          frameRate: 30,
          framesDropped: 0,
          framesReceived: 60,
          freezeCount: 0,
          freezeDurationMs: 0,
          jitterMs: 1,
          jitterBufferDelayMs: 1,
          nackCount: 0,
          packetsLost: 0,
          packetsReceived: 100,
          pliCount: 0,
          resolution: '1280x720',
        },
        10_000,
      ),
    ).toBe('downlink');
    expect(
      diagnoseStream(
        base,
        {
          averageDecodeTimeMs: 80,
          bitrateKbps: 3800,
          codec: 'AV1',
          decoderAcceleration: 'software',
          frameRate: 30,
          framesDropped: 0,
          framesReceived: 60,
          freezeCount: 1,
          freezeDurationMs: 250,
          jitterMs: 1,
          jitterBufferDelayMs: 1,
          nackCount: 0,
          packetsLost: 0,
          packetsReceived: 100,
          pliCount: 0,
          resolution: '1280x720',
        },
        10_000,
      ),
    ).toBe('decode');
  });
});
