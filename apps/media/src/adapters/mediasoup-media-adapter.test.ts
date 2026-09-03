import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseAppEnv } from '@baker/shared';

const mocks = vi.hoisted(() => ({
  consumerGetStats: vi.fn(),
  createRouter: vi.fn(),
  createWebRtcServer: vi.fn(),
  createWebRtcTransport: vi.fn(),
  createWorker: vi.fn(),
  producerGetStats: vi.fn(),
}));

vi.mock('mediasoup', () => ({
  createWorker: mocks.createWorker,
}));

import { MediasoupMediaAdapter } from './mediasoup-media-adapter';

beforeEach(() => {
  let transportSequence = 0;
  let serverSequence = 0;

  mocks.consumerGetStats.mockReset();
  mocks.consumerGetStats.mockResolvedValue([
    {
      bitrate: 3_000_000,
      byteCount: 3000,
      jitter: 0.004,
      packetCount: 300,
      packetsLost: 2,
      type: 'outbound-rtp',
    },
  ]);
  mocks.producerGetStats.mockReset();
  mocks.producerGetStats.mockResolvedValue([
    {
      bitrate: 3_500_000,
      byteCount: 3500,
      packetCount: 350,
      packetsLost: 1,
      type: 'inbound-rtp',
    },
  ]);

  mocks.createWebRtcServer.mockReset();
  mocks.createWebRtcServer.mockImplementation(async () => ({
    id: `web-rtc-server-${++serverSequence}`,
  }));
  mocks.createWebRtcTransport.mockReset();
  mocks.createWebRtcTransport.mockImplementation(async () => ({
    close: vi.fn(),
    connect: vi.fn(),
    consume: vi.fn(async ({ producerId }) => ({
      close: vi.fn(),
      getStats: mocks.consumerGetStats,
      id: `consumer-${transportSequence}`,
      kind: 'video',
      on: vi.fn(),
      paused: false,
      producerId,
      producerPaused: false,
      resume: vi.fn(),
      rtpParameters: {},
      score: { producerScore: 9, producerScores: [9], score: 8 },
      type: 'simple',
    })),
    dtlsState: 'connected',
    dtlsParameters: {},
    iceCandidates: [],
    iceParameters: {},
    iceSelectedTuple: { protocol: 'udp' },
    iceState: 'completed',
    getStats: vi.fn().mockResolvedValue([{
      availableOutgoingBitrate: 5_000_000,
      type: 'webrtc-transport',
    }]),
    id: `transport-${++transportSequence}`,
    on: vi.fn(),
    produce: vi.fn(async ({ kind }) => ({
      close: vi.fn(),
      getStats: mocks.producerGetStats,
      id: `producer-${transportSequence}`,
      kind,
      observer: { on: vi.fn() },
      on: vi.fn(),
      paused: false,
      score: [{ encodingIdx: 0, score: 9, ssrc: 1 }],
    })),
    sctpParameters: undefined,
  }));
  mocks.createWorker.mockReset();
  mocks.createRouter.mockReset();
  mocks.createRouter.mockImplementation(async () => ({
    canConsume: vi.fn().mockReturnValue(true),
    createWebRtcTransport: mocks.createWebRtcTransport,
    rtpCapabilities: {},
  }));
  mocks.createWorker.mockResolvedValue({
    createRouter: mocks.createRouter,
    createWebRtcServer: mocks.createWebRtcServer,
    on: vi.fn(),
    getResourceUsage: vi.fn().mockResolvedValue({ ru_stime: 10, ru_utime: 20 }),
  });
});

describe('MediasoupMediaAdapter shared WebRTC servers', () => {
  it('offers H.264 before the optional browser codecs', async () => {
    const adapter = new MediasoupMediaAdapter(
      parseAppEnv({
      NODE_ENV: 'test',
      SFU_ANNOUNCED_IP: '127.0.0.1',
      SFU_RTC_MAX_PORT: '23340',
      SFU_RTC_MIN_PORT: '23335',
      }),
    );
    const session = {
      channelId: '00000000-0000-4000-8000-000000000021',
      mode: 'voice' as const,
      sessionId: '00000000-0000-4000-8000-000000000022',
      transportMode: 'sfu' as const,
      userId: '00000000-0000-4000-8000-000000000023',
    };
    await adapter.createSession(session);
    await adapter.createSfuTransport({ ...session, direction: 'send' });

    const [{ mediaCodecs }] = mocks.createRouter.mock.calls[0] as [{ mediaCodecs: Array<{ mimeType: string }> }];
    expect(mediaCodecs.map((codec) => codec.mimeType)).toEqual([
      'audio/opus',
      'video/H264',
      'video/VP8',
      'video/VP9',
      'video/AV1',
    ]);
  });

  it('reuses one fixed listen port per media region across transports', async () => {
    const adapter = new MediasoupMediaAdapter(
      parseAppEnv({
        MEDIA_REGION_PROFILES: JSON.stringify([
          {
            hosts: ['violet.example.com'],
            id: 'mainland',
            sfuAnnouncedIp: 'violet.example.com',
            sfuRtcMaxPort: 23340,
            sfuRtcMinPort: 23335,
          },
          {
            hosts: ['hk.example.com'],
            id: 'hongkong',
            sfuAnnouncedIp: 'hk.example.com',
            sfuRtcMaxPort: 23340,
            sfuRtcMinPort: 23335,
          },
        ]),
        NODE_ENV: 'test',
        SFU_RTC_MAX_PORT: '23340',
        SFU_RTC_MIN_PORT: '23335',
      }),
    );
    const mainlandSession = {
      channelId: '00000000-0000-4000-8000-000000000001',
      mediaRegionId: 'mainland',
      mode: 'voice' as const,
      sessionId: '00000000-0000-4000-8000-000000000002',
      transportMode: 'sfu' as const,
      userId: '00000000-0000-4000-8000-000000000003',
    };
    const hongkongSession = {
      channelId: '00000000-0000-4000-8000-000000000004',
      mediaRegionId: 'hongkong',
      mode: 'voice' as const,
      sessionId: '00000000-0000-4000-8000-000000000005',
      transportMode: 'sfu' as const,
      userId: '00000000-0000-4000-8000-000000000006',
    };

    await adapter.createSession(mainlandSession);
    await adapter.createSession(hongkongSession);
    await adapter.createSfuTransport({
      ...mainlandSession,
      direction: 'send',
    });
    await adapter.createSfuTransport({
      ...mainlandSession,
      direction: 'recv',
    });
    await adapter.createSfuTransport({
      ...hongkongSession,
      direction: 'send',
    });
    await adapter.createSfuTransport({
      ...hongkongSession,
      direction: 'recv',
    });

    expect(mocks.createWebRtcServer).toHaveBeenCalledTimes(2);
    expect(mocks.createWebRtcServer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        listenInfos: expect.arrayContaining([
          expect.objectContaining({
            announcedAddress: 'violet.example.com',
            port: 23335,
            protocol: 'udp',
          }),
        ]),
      }),
    );
    expect(mocks.createWebRtcServer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        listenInfos: expect.arrayContaining([
          expect.objectContaining({
            announcedAddress: 'hk.example.com',
            port: 23336,
            protocol: 'udp',
          }),
        ]),
      }),
    );

    const transportServers = mocks.createWebRtcTransport.mock.calls.map(
      ([options]) => options.webRtcServer,
    );
    expect(transportServers[0]).toBe(transportServers[1]);
    expect(transportServers[2]).toBe(transportServers[3]);
    expect(transportServers[0]).not.toBe(transportServers[2]);
  });

  it('maps publisher and viewer RTP stats into cached stream diagnostics', async () => {
    const adapter = new MediasoupMediaAdapter(
      parseAppEnv({
        NODE_ENV: 'test',
        SFU_ANNOUNCED_IP: '127.0.0.1',
        SFU_RTC_MAX_PORT: '23340',
        SFU_RTC_MIN_PORT: '23335',
      }),
    );
    const channelId = '00000000-0000-4000-8000-000000000051';
    const streamId = '00000000-0000-4000-8000-000000000052';
    const publisherSessionId = '00000000-0000-4000-8000-000000000053';
    const viewerSessionId = '00000000-0000-4000-8000-000000000054';
    const host = {
      channelId,
      mode: 'stream_publish' as const,
      sessionId: publisherSessionId,
      streamId,
      transportMode: 'sfu' as const,
      userId: '00000000-0000-4000-8000-000000000055',
    };
    const viewer = {
      channelId,
      mode: 'stream_watch' as const,
      sessionId: viewerSessionId,
      streamId,
      transportMode: 'sfu' as const,
      userId: '00000000-0000-4000-8000-000000000056',
    };
    await adapter.createSession(host);
    await adapter.createSession(viewer);
    const send = await adapter.createSfuTransport({
      ...host,
      direction: 'send',
    });
    const produced = await adapter.produceSfu({
      ...host,
      kind: 'video',
      rtpParameters: {},
      transportId: send.transportOptions.id,
      userId: host.userId,
    });
    const recv = await adapter.createSfuTransport({
      ...viewer,
      direction: 'recv',
    });
    await adapter.consumeSfu({
      ...viewer,
      producerId: produced.producerId,
      rtpCapabilities: {},
      transportId: recv.transportOptions.id,
    });

    const diagnostics = await adapter.getStreamDiagnostics({
      channelId,
      publisherSessionId,
      streamId,
      viewerSessionId,
    });
    expect(diagnostics).toMatchObject({
      ingress: {
        availableOutgoingBitrateKbps: 5000,
        bitrateKbps: 3500,
        dtlsState: 'connected',
        iceState: 'completed',
        packetsLost: 1,
        score: 9,
        transportProtocol: 'udp',
      },
      egress: {
        availableOutgoingBitrateKbps: 5000,
        bitrateKbps: 3000,
        dtlsState: 'connected',
        iceState: 'completed',
        packetsLost: 2,
        score: 8,
        transportProtocol: 'udp',
      },
      workerCpuPct: null,
    });
  });

  it('derives an SFU bitrate from byte deltas when mediasoup omits instantaneous bitrate', async () => {
    mocks.producerGetStats
      .mockResolvedValueOnce([{ byteCount: 1_000, packetCount: 100, type: 'inbound-rtp' }])
      .mockResolvedValueOnce([{ byteCount: 751_000, packetCount: 200, type: 'inbound-rtp' }]);
    const adapter = new MediasoupMediaAdapter(parseAppEnv({
      NODE_ENV: 'test',
      SFU_ANNOUNCED_IP: '127.0.0.1',
      SFU_RTC_MAX_PORT: '23340',
      SFU_RTC_MIN_PORT: '23335',
    }));
    const session = {
      channelId: '00000000-0000-4000-8000-000000000061',
      mode: 'stream_publish' as const,
      sessionId: '00000000-0000-4000-8000-000000000062',
      streamId: '00000000-0000-4000-8000-000000000063',
      transportMode: 'sfu' as const,
      userId: '00000000-0000-4000-8000-000000000064',
    };
    await adapter.createSession(session);
    const send = await adapter.createSfuTransport({ ...session, direction: 'send' });
    await adapter.produceSfu({
      ...session,
      kind: 'video',
      rtpParameters: {},
      transportId: send.transportOptions.id,
      userId: session.userId,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const first = await adapter.getStreamDiagnostics({
      channelId: session.channelId,
      publisherSessionId: session.sessionId,
      streamId: session.streamId,
    });
    now.mockReturnValue(2_000);
    const second = await adapter.getStreamDiagnostics({
      channelId: session.channelId,
      publisherSessionId: session.sessionId,
      streamId: session.streamId,
    });
    now.mockRestore();

    expect(first.ingress?.bitrateKbps).toBeNull();
    expect(second.ingress?.bitrateKbps).toBe(6000);
    expect(second.ingress?.windowPackets).toBe(100);
  });
});
