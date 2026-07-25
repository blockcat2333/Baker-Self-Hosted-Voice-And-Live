import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseAppEnv } from '@baker/shared';

const mocks = vi.hoisted(() => ({
  createWebRtcServer: vi.fn(),
  createWebRtcTransport: vi.fn(),
  createWorker: vi.fn(),
}));

vi.mock('mediasoup', () => ({
  createWorker: mocks.createWorker,
}));

import { MediasoupMediaAdapter } from './mediasoup-media-adapter';

beforeEach(() => {
  let transportSequence = 0;
  let serverSequence = 0;

  mocks.createWebRtcServer.mockReset();
  mocks.createWebRtcServer.mockImplementation(async () => ({
    id: `web-rtc-server-${++serverSequence}`,
  }));
  mocks.createWebRtcTransport.mockReset();
  mocks.createWebRtcTransport.mockImplementation(async () => ({
    dtlsParameters: {},
    iceCandidates: [],
    iceParameters: {},
    id: `transport-${++transportSequence}`,
    on: vi.fn(),
    sctpParameters: undefined,
  }));
  mocks.createWorker.mockReset();
  mocks.createWorker.mockResolvedValue({
    createRouter: vi.fn(async () => ({
      createWebRtcTransport: mocks.createWebRtcTransport,
      rtpCapabilities: {},
    })),
    createWebRtcServer: mocks.createWebRtcServer,
    on: vi.fn(),
  });
});

describe('MediasoupMediaAdapter shared WebRTC servers', () => {
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
});
