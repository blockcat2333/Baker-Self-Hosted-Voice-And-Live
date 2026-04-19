import { describe, expect, it } from 'vitest';

import { buildMediaApp } from './app';

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
});
