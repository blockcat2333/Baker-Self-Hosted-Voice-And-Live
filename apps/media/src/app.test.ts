import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMediaApp } from './app';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('media app internal auth', () => {
  it('rejects unauthenticated internal media routes', async () => {
    const app = buildMediaApp();

    const capabilitiesResponse = await app.inject({
      method: 'GET',
      url: '/v1/internal/media/capabilities',
    });

    const sessionResponse = await app.inject({
      method: 'POST',
      payload: {
        channelId: '00000000-0000-0000-0000-000000000001',
        mode: 'voice',
        sessionId: '00000000-0000-0000-0000-000000000002',
        userId: '00000000-0000-0000-0000-000000000003',
      },
      url: '/v1/internal/media/sessions',
    });

    expect(capabilitiesResponse.statusCode).toBe(401);
    expect(sessionResponse.statusCode).toBe(401);

    await app.close();
  });

  it('accepts authenticated internal media session requests', async () => {
    const app = buildMediaApp();

    const response = await app.inject({
      headers: {
        'x-baker-internal-secret': 'replace-me-for-local-media-internal-secret',
      },
      method: 'POST',
      payload: {
        channelId: '00000000-0000-0000-0000-000000000001',
        mode: 'voice',
        sessionId: '00000000-0000-0000-0000-000000000002',
        userId: '00000000-0000-0000-0000-000000000003',
      },
      url: '/v1/internal/media/sessions',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().iceServers).toBeDefined();

    await app.close();
  });

  it('reports sfu capability configuration from the media backend', async () => {
    vi.stubEnv('SFU_ANNOUNCED_IP', '203.0.113.10');

    const app = buildMediaApp();

    const response = await app.inject({
      headers: {
        'x-baker-internal-secret': 'replace-me-for-local-media-internal-secret',
      },
      method: 'GET',
      url: '/v1/internal/media/capabilities',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().sfu).toMatchObject({
      available: true,
      configured: true,
      requiredAnnouncedIp: true,
    });

    await app.close();
  });

  it('reports sfu configured when a media-region profile has an announced address', async () => {
    vi.stubEnv('MEDIA_REGION_PROFILES', JSON.stringify([
      {
        hosts: ['hkserver.evergarden.space'],
        id: 'hongkong',
        sfuAnnouncedIp: '168.70.50.141',
      },
    ]));

    const app = buildMediaApp();

    const response = await app.inject({
      headers: {
        'x-baker-internal-secret': 'replace-me-for-local-media-internal-secret',
      },
      method: 'GET',
      url: '/v1/internal/media/capabilities',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().sfu).toMatchObject({
      available: true,
      configured: true,
      requiredAnnouncedIp: true,
    });

    await app.close();
  });

  it('includes TURN servers in media sessions when relay env is configured', async () => {
    vi.stubEnv('TURN_URLS', 'turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp');
    vi.stubEnv('TURN_USERNAME', 'baker');
    vi.stubEnv('TURN_PASSWORD', 'change-this');

    const app = buildMediaApp();

    const response = await app.inject({
      headers: {
        'x-baker-internal-secret': 'replace-me-for-local-media-internal-secret',
      },
      method: 'POST',
      payload: {
        channelId: '00000000-0000-0000-0000-000000000001',
        mode: 'voice',
        sessionId: '00000000-0000-0000-0000-000000000002',
        userId: '00000000-0000-0000-0000-000000000003',
      },
      url: '/v1/internal/media/sessions',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().iceServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credential: 'change-this',
          urls: [
            'turn:turn.example.com:3478?transport=udp',
            'turn:turn.example.com:3478?transport=tcp',
          ],
          username: 'baker',
        }),
      ]),
    );

    await app.close();
  });

  it('uses media-region TURN servers when the session selects a region profile', async () => {
    vi.stubEnv('MEDIA_REGION_PROFILES', JSON.stringify([
      {
        hosts: ['hkserver.evergarden.space'],
        id: 'hongkong',
        sfuAnnouncedIp: '168.70.50.141',
        turnPassword: 'hk-secret',
        turnUrls: ['turn:hkserver.evergarden.space:23304?transport=udp'],
        turnUsername: 'hk-baker',
      },
    ]));
    vi.stubEnv('TURN_URLS', 'turn:violet.evergarden.space:3478?transport=udp');
    vi.stubEnv('TURN_USERNAME', 'baker');
    vi.stubEnv('TURN_PASSWORD', 'mainland-secret');

    const app = buildMediaApp();

    const response = await app.inject({
      headers: {
        'x-baker-internal-secret': 'replace-me-for-local-media-internal-secret',
      },
      method: 'POST',
      payload: {
        channelId: '00000000-0000-0000-0000-000000000001',
        mediaRegionId: 'hongkong',
        mode: 'voice',
        sessionId: '00000000-0000-0000-0000-000000000002',
        userId: '00000000-0000-0000-0000-000000000003',
      },
      url: '/v1/internal/media/sessions',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().iceServers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credential: 'hk-secret',
          urls: ['turn:hkserver.evergarden.space:23304?transport=udp'],
          username: 'hk-baker',
        }),
      ]),
    );

    await app.close();
  });

  it('rejects unknown media-region session requests', async () => {
    vi.stubEnv('MEDIA_REGION_PROFILES', JSON.stringify([
      {
        hosts: ['violet.evergarden.space'],
        id: 'mainland',
        sfuAnnouncedIp: '113.80.68.23',
      },
    ]));

    const app = buildMediaApp();

    const response = await app.inject({
      headers: {
        'x-baker-internal-secret': 'replace-me-for-local-media-internal-secret',
      },
      method: 'POST',
      payload: {
        channelId: '00000000-0000-0000-0000-000000000001',
        mediaRegionId: 'hongkong',
        mode: 'voice',
        sessionId: '00000000-0000-0000-0000-000000000002',
        userId: '00000000-0000-0000-0000-000000000003',
      },
      url: '/v1/internal/media/sessions',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Unknown media region profile.',
    });

    await app.close();
  });
});
