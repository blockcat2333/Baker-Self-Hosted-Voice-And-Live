import { describe, expect, it } from 'vitest';
import type { StreamDiagnosticsGetAckData } from '@baker/protocol';

import type { WatchedStreamVideoStats } from './stream-store';
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

const receiver: WatchedStreamVideoStats = {
  averageDecodeTimeMs: 1,
  bitrateKbps: 3800,
  codec: 'AV1',
  decoderAcceleration: 'hardware',
  decodeFrameRate: 30,
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
  receiveFrameRate: 30,
  renderFrameRate: 30,
  resolution: '1280x720',
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
          ...receiver,
          bitrateKbps: 1000,
        },
        10_000,
      ),
    ).toBe('downlink');
    expect(
      diagnoseStream(
        base,
        {
          ...receiver,
          averageDecodeTimeMs: 80,
          decoderAcceleration: 'software',
          freezeCount: 1,
          freezeDurationMs: 250,
        },
        10_000,
      ),
    ).toBe('decode');
  });

  it('does not mistake a healthy low-motion stream below its bitrate ceiling for a fault', () => {
    expect(diagnoseStream({
      ...base,
      publisher: { ...base.publisher!, bitrateKbps: 250, targetBitrateKbps: 10_000 },
      sfu: {
        ...base.sfu!,
        ingress: { ...base.sfu!.ingress!, bitrateKbps: 245 },
        egress: { ...base.sfu!.egress!, bitrateKbps: 240 },
      },
    }, { ...receiver, bitrateKbps: 235 }, 10_000)).toBe('healthy');
  });

  it('uses encoder time and available uplink bandwidth as distinct boundaries', () => {
    expect(diagnoseStream({
      ...base,
      publisher: { ...base.publisher!, averageEncodeTimeMs: 40 },
    }, null, 10_000)).toBe('sender_encode');
    expect(diagnoseStream({
      ...base,
      publisher: {
        ...base.publisher!,
        availableOutgoingBitrateKbps: 1_000,
        encoderTargetBitrateKbps: 4_000,
      },
    }, null, 10_000)).toBe('uplink');
  });

  it('identifies SFU transport failure, viewer loss, and render backlog', () => {
    expect(diagnoseStream({
      ...base,
      sfu: { ...base.sfu!, ingress: { ...base.sfu!.ingress!, iceState: 'failed' } },
    }, receiver, 10_000)).toBe('server');
    expect(diagnoseStream(base, {
      ...receiver,
      packetsLost: 10,
      packetsReceived: 90,
    }, 10_000)).toBe('downlink');
    expect(diagnoseStream(base, {
      ...receiver,
      renderFrameRate: 10,
    }, 10_000)).toBe('decode');
  });
});
