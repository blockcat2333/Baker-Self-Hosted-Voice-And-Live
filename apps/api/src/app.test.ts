import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApiApp } from './app';
import { createInMemoryDataAccess } from './testing/create-in-memory-data-access';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('api app', () => {
  it('serves health and service manifest', async () => {
    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const manifest = await app.inject({
      method: 'GET',
      url: '/v1/meta/services',
    });

    expect(health.statusCode).toBe(200);
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json().services).toHaveLength(5);

    await app.close();
  });

  it('returns a client error for malformed JSON requests', async () => {
    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    const response = await app.inject({
      headers: {
        'content-type': 'application/json',
        'x-admin-password': 'admin',
      },
      method: 'POST',
      payload: '',
      url: '/v1/admin/deployment/apply',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_PAYLOAD');

    await app.close();
  });

  it('runs the auth and text chat backend slice end-to-end', async () => {
    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    // ── Register first user ───────────────────────────────────────────────────

    const registerResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'staff@example.com',
        password: 'supersecurepassword',
        username: 'Staff',
      },
      url: '/v1/auth/register',
    });

    expect(registerResponse.statusCode).toBe(200);
    const registeredSession = registerResponse.json();
    expect(registeredSession.user.email).toBe('staff@example.com');

    const meResponse = await app.inject({
      headers: {
        authorization: `Bearer ${registeredSession.tokens.accessToken}`,
      },
      method: 'GET',
      url: '/v1/auth/me',
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().username).toBe('Staff');

    const updateMeResponse = await app.inject({
      headers: {
        authorization: `Bearer ${registeredSession.tokens.accessToken}`,
      },
      method: 'PATCH',
      payload: { username: 'Staff Renamed' },
      url: '/v1/auth/me',
    });

    expect(updateMeResponse.statusCode).toBe(200);
    expect(updateMeResponse.json().username).toBe('Staff Renamed');

    const meAfterUpdateResponse = await app.inject({
      headers: {
        authorization: `Bearer ${registeredSession.tokens.accessToken}`,
      },
      method: 'GET',
      url: '/v1/auth/me',
    });

    expect(meAfterUpdateResponse.statusCode).toBe(200);
    expect(meAfterUpdateResponse.json().username).toBe('Staff Renamed');

    // First user lands in the shared default workspace with one 'general' channel.
    const guildsResponse = await app.inject({
      headers: {
        authorization: `Bearer ${registeredSession.tokens.accessToken}`,
      },
      method: 'GET',
      url: '/v1/guilds',
    });

    expect(guildsResponse.statusCode).toBe(200);
    expect(guildsResponse.json()).toHaveLength(1);
    const guildId = guildsResponse.json()[0].id as string;
    expect(guildsResponse.json()[0].name).toBe('Baker');

    const channelsResponse = await app.inject({
      headers: {
        authorization: `Bearer ${registeredSession.tokens.accessToken}`,
      },
      method: 'GET',
      url: `/v1/guilds/${guildId}/channels`,
    });

    expect(channelsResponse.statusCode).toBe(200);
    expect(channelsResponse.json()).toHaveLength(2);
    const generalChannel = channelsResponse
      .json()
      .find((c: { name: string }) => c.name === 'general');
    expect(generalChannel).toBeDefined();
    const channelId = generalChannel.id as string;

    // ── Register second user — must land in the SAME shared guild ─────────────

    const register2Response = await app.inject({
      method: 'POST',
      payload: {
        email: 'alice@example.com',
        password: 'alicespassword',
        username: 'Alice',
      },
      url: '/v1/auth/register',
    });

    expect(register2Response.statusCode).toBe(200);
    const session2 = register2Response.json();

    const guilds2Response = await app.inject({
      headers: { authorization: `Bearer ${session2.tokens.accessToken}` },
      method: 'GET',
      url: '/v1/guilds',
    });

    expect(guilds2Response.statusCode).toBe(200);
    expect(guilds2Response.json()).toHaveLength(1);
    // Both users share the SAME guild ID.
    expect(guilds2Response.json()[0].id).toBe(guildId);

    // ── Message exchange across users ─────────────────────────────────────────

    const sendMessageResponse = await app.inject({
      headers: {
        authorization: `Bearer ${registeredSession.tokens.accessToken}`,
      },
      method: 'POST',
      payload: { content: 'hello baker' },
      url: `/v1/channels/${channelId}/messages`,
    });

    expect(sendMessageResponse.statusCode).toBe(200);
    expect(sendMessageResponse.json().content).toBe('hello baker');

    // Second user can read the message sent by the first user.
    const listMessagesResponse = await app.inject({
      headers: { authorization: `Bearer ${session2.tokens.accessToken}` },
      method: 'GET',
      url: `/v1/channels/${channelId}/messages?limit=20`,
    });

    expect(listMessagesResponse.statusCode).toBe(200);
    expect(listMessagesResponse.json().items).toHaveLength(1);

    // ── Login and refresh still work ──────────────────────────────────────────

    const loginResponse = await app.inject({
      method: 'POST',
      payload: { email: 'staff@example.com', password: 'supersecurepassword' },
      url: '/v1/auth/login',
    });

    expect(loginResponse.statusCode).toBe(200);

    const refreshResponse = await app.inject({
      method: 'POST',
      payload: { refreshToken: loginResponse.json().tokens.refreshToken },
      url: '/v1/auth/refresh',
    });

    expect(refreshResponse.statusCode).toBe(200);

    const logoutResponse = await app.inject({
      headers: {
        authorization: `Bearer ${loginResponse.json().tokens.accessToken}`,
      },
      method: 'POST',
      url: '/v1/auth/logout',
    });

    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({ ok: true });

    const meAfterLogoutResponse = await app.inject({
      headers: {
        authorization: `Bearer ${loginResponse.json().tokens.accessToken}`,
      },
      method: 'GET',
      url: '/v1/auth/me',
    });

    expect(meAfterLogoutResponse.statusCode).toBe(401);

    const refreshAfterLogoutResponse = await app.inject({
      method: 'POST',
      payload: { refreshToken: refreshResponse.json().tokens.refreshToken },
      url: '/v1/auth/refresh',
    });

    expect(refreshAfterLogoutResponse.statusCode).toBe(401);

    await app.close();
  });

  it('supports admin-managed server settings, account creation, and channel management', async () => {
    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    const verifyAdminResponse = await app.inject({
      method: 'POST',
      payload: { password: 'admin' },
      url: '/v1/admin/auth/verify',
    });

    expect(verifyAdminResponse.statusCode).toBe(200);

    const initialPublicConfig = await app.inject({
      method: 'GET',
      url: '/v1/meta/public-config',
    });

    expect(initialPublicConfig.statusCode).toBe(200);
    expect(initialPublicConfig.json().serverName).toBe('Baker');
    expect(initialPublicConfig.json().webPort).toBe(80);

    const updateSettingsResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'PATCH',
      payload: {
        allowPublicRegistration: false,
        appPort: 5174,
        serverName: 'Control Room',
        webEnabled: true,
        webPort: 8080,
      },
      url: '/v1/admin/settings',
    });

    expect(updateSettingsResponse.statusCode).toBe(200);
    expect(updateSettingsResponse.json().serverName).toBe('Control Room');

    const publicRegisterBlockedResponse = await app.inject({
      method: 'POST',
      payload: {
        email: 'blocked@example.com',
        password: 'blockedpassword',
        username: 'Blocked',
      },
      url: '/v1/auth/register',
    });

    expect(publicRegisterBlockedResponse.statusCode).toBe(403);

    const adminCreateUserResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'ownerpassword',
        username: 'Owner',
      },
      url: '/v1/admin/users',
    });

    expect(adminCreateUserResponse.statusCode).toBe(200);
    expect(adminCreateUserResponse.json().username).toBe('Owner');

    const loginResponse = await app.inject({
      method: 'POST',
      payload: { email: 'owner@example.com', password: 'ownerpassword' },
      url: '/v1/auth/login',
    });

    expect(loginResponse.statusCode).toBe(200);
    const ownerSession = loginResponse.json();

    const guildsResponse = await app.inject({
      headers: { authorization: `Bearer ${ownerSession.tokens.accessToken}` },
      method: 'GET',
      url: '/v1/guilds',
    });

    expect(guildsResponse.statusCode).toBe(200);
    expect(guildsResponse.json()[0].name).toBe('Control Room');
    const guildId = guildsResponse.json()[0].id as string;

    const createChannelResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'POST',
      payload: {
        name: 'Ops Voice',
        type: 'voice',
        voiceQuality: 'high',
      },
      url: '/v1/admin/channels',
    });

    expect(createChannelResponse.statusCode).toBe(200);
    expect(createChannelResponse.json().voiceQuality).toBe('high');
    const managedChannelId = createChannelResponse.json().id as string;

    const renameChannelResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'PATCH',
      payload: {
        name: 'Ops Voice Updated',
        voiceQuality: 'standard',
      },
      url: `/v1/admin/channels/${managedChannelId}`,
    });

    expect(renameChannelResponse.statusCode).toBe(200);
    expect(renameChannelResponse.json().name).toBe('Ops Voice Updated');

    const channelsResponse = await app.inject({
      headers: { authorization: `Bearer ${ownerSession.tokens.accessToken}` },
      method: 'GET',
      url: `/v1/guilds/${guildId}/channels`,
    });

    expect(channelsResponse.statusCode).toBe(200);
    expect(
      channelsResponse
        .json()
        .some(
          (channel: { name: string; voiceQuality: string }) =>
            channel.name === 'Ops Voice Updated' &&
            channel.voiceQuality === 'standard',
        ),
    ).toBe(true);

    const publicConfigResponse = await app.inject({
      method: 'GET',
      url: '/v1/meta/public-config',
    });

    expect(publicConfigResponse.statusCode).toBe(200);
    expect(publicConfigResponse.json().allowPublicRegistration).toBe(false);
    expect(publicConfigResponse.json().serverName).toBe('Control Room');

    const manifestResponse = await app.inject({
      method: 'GET',
      url: '/v1/meta/services',
    });

    expect(manifestResponse.statusCode).toBe(200);
    expect(
      manifestResponse
        .json()
        .services.find((service: { name: string }) => service.name === 'web')
        ?.url,
    ).toBe('http://localhost:8080');

    await app.close();
  });

  it('validates and publishes admin media mode changes', async () => {
    const publishMediaModeChanged = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          deviceSwitch: true,
          metrics: true,
          sfu: {
            available: true,
            configured: true,
            requiredAnnouncedIp: true,
          },
          simulcast: false,
          speakerSelection: true,
        }),
        ok: true,
      }),
    );

    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
      publisher: {
        publishMediaModeChanged,
        publishMessageCreated: vi.fn().mockResolvedValue(undefined),
      },
    });

    const updateSettingsResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'PATCH',
      payload: {
        mediaMode: 'sfu',
      },
      url: '/v1/admin/settings',
    });

    expect(updateSettingsResponse.statusCode).toBe(200);
    expect(updateSettingsResponse.json().mediaMode).toBe('sfu');
    expect(publishMediaModeChanged).toHaveBeenCalledWith('sfu');

    const publicConfigResponse = await app.inject({
      method: 'GET',
      url: '/v1/meta/public-config',
    });

    expect(publicConfigResponse.json().mediaMode).toBe('sfu');

    await app.close();
  });

  it('rejects sfu media mode when media capabilities are not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          deviceSwitch: true,
          metrics: true,
          sfu: {
            available: true,
            configured: false,
            requiredAnnouncedIp: true,
          },
          simulcast: false,
          speakerSelection: true,
        }),
        ok: true,
      }),
    );

    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    const updateSettingsResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'PATCH',
      payload: {
        mediaMode: 'sfu',
      },
      url: '/v1/admin/settings',
    });

    expect(updateSettingsResponse.statusCode).toBe(409);
    expect(updateSettingsResponse.json().message).toContain('SFU');

    await app.close();
  });

  it('serves deployment settings and rejects apply without Docker socket access', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-api-deployment-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);

    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    try {
      const settingsResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'GET',
        url: '/v1/admin/deployment/settings',
      });

      expect(settingsResponse.statusCode).toBe(200);
      expect(settingsResponse.json()).toMatchObject({
        adminHostPort: 3001,
        dockerEnabled: false,
        pendingApply: false,
        turnEnabled: false,
        webHostPort: 3000,
      });

      const saveResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'PATCH',
        payload: {
          adminHostPort: 13001,
          turnEnabled: true,
          turnExternalIp: '203.0.113.10',
          turnPassword: 'relay-secret',
          turnUsername: 'relay',
          webHostPort: 13000,
        },
        url: '/v1/admin/deployment/settings',
      });

      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.json()).toMatchObject({
        adminHostPort: 13001,
        pendingApply: true,
        turnEnabled: true,
        turnPasswordConfigured: true,
        webHostPort: 13000,
      });

      const applyResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'POST',
        url: '/v1/admin/deployment/apply',
      });

      expect(applyResponse.statusCode).toBe(409);
    } finally {
      await app.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('serves and validates admin update proxy settings', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-api-update-proxy-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);

    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    try {
      const unauthorizedResponse = await app.inject({
        method: 'GET',
        url: '/v1/admin/updates/proxy',
      });
      expect(unauthorizedResponse.statusCode).toBe(401);

      const defaultsResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'GET',
        url: '/v1/admin/updates/proxy',
      });
      expect(defaultsResponse.statusCode).toBe(200);
      expect(defaultsResponse.json()).toMatchObject({
        enabled: false,
        proxyUrl: '',
      });

      const saveResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'PATCH',
        payload: {
          enabled: true,
          proxyUrl: ' http://127.0.0.1:7890 ',
        },
        url: '/v1/admin/updates/proxy',
      });
      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.json()).toMatchObject({
        enabled: true,
        proxyUrl: 'http://127.0.0.1:7890',
      });

      const invalidResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'PATCH',
        payload: {
          enabled: true,
          proxyUrl: 'socks5://127.0.0.1:1080',
        },
        url: '/v1/admin/updates/proxy',
      });
      expect(invalidResponse.statusCode).toBe(400);
    } finally {
      await app.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('serves runtime health, repair status, and self-repair settings without supervisor access', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'baker-api-runtime-'));
    vi.stubEnv('BAKER_RUNTIME_DIR', tempDir);

    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    try {
      const healthResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'GET',
        url: '/v1/admin/runtime/health',
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json()).toMatchObject({
        dockerEnabled: false,
        repairInProgress: false,
        supervisorAvailable: false,
      });
      expect(
        healthResponse
          .json()
          .services.find((service: { name: string }) => service.name === 'turn')
          ?.status,
      ).toBe('disabled');

      const selfRepairResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'GET',
        url: '/v1/admin/runtime/self-repair',
      });

      expect(selfRepairResponse.statusCode).toBe(200);
      expect(selfRepairResponse.json()).toMatchObject({
        allowContainerRepair: true,
        enabled: false,
        intervalSeconds: 60,
      });

      const updateSelfRepairResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'PATCH',
        payload: {
          allowContainerRepair: false,
          enabled: true,
          intervalSeconds: 120,
        },
        url: '/v1/admin/runtime/self-repair',
      });

      expect(updateSelfRepairResponse.statusCode).toBe(200);
      expect(updateSelfRepairResponse.json()).toMatchObject({
        allowContainerRepair: false,
        enabled: true,
        intervalSeconds: 120,
      });

      const publicIpResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'GET',
        url: '/v1/admin/runtime/public-ip',
      });

      expect(publicIpResponse.statusCode).toBe(200);
      expect(publicIpResponse.json()).toMatchObject({
        enabled: false,
        intervalSeconds: 300,
        lastAppliedIp: null,
      });

      const updatePublicIpResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'PATCH',
        payload: {
          enabled: true,
          intervalSeconds: 600,
        },
        url: '/v1/admin/runtime/public-ip',
      });

      expect(updatePublicIpResponse.statusCode).toBe(200);
      expect(updatePublicIpResponse.json()).toMatchObject({
        enabled: true,
        intervalSeconds: 600,
      });

      const repairResponse = await app.inject({
        headers: { 'x-admin-password': 'admin' },
        method: 'POST',
        payload: { allowContainerRepair: false },
        url: '/v1/admin/runtime/repair',
      });

      expect(repairResponse.statusCode).toBe(200);
      expect(repairResponse.json()).toMatchObject({
        containerRepairStarted: false,
        status: 'failed',
        trigger: 'manual',
      });
    } finally {
      await app.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('supports admin channel deletion constraints and position compaction', async () => {
    const dataAccess = createInMemoryDataAccess();
    const app = buildApiApp({ dataAccess });

    const adminCreateUserResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'POST',
      payload: {
        email: 'owner@example.com',
        password: 'ownerpassword',
        username: 'Owner',
      },
      url: '/v1/admin/users',
    });

    expect(adminCreateUserResponse.statusCode).toBe(200);
    const ownerId = adminCreateUserResponse.json().id as string;

    const createTextChannelResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'POST',
      payload: {
        name: 'announcements',
        type: 'text',
      },
      url: '/v1/admin/channels',
    });

    expect(createTextChannelResponse.statusCode).toBe(200);
    const extraTextChannelId = createTextChannelResponse.json().id as string;

    const createVoiceChannelResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'POST',
      payload: {
        name: 'ops-voice',
        type: 'voice',
        voiceQuality: 'high',
      },
      url: '/v1/admin/channels',
    });

    expect(createVoiceChannelResponse.statusCode).toBe(200);
    const extraVoiceChannelId = createVoiceChannelResponse.json().id as string;

    const deleteTextChannelResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'DELETE',
      url: `/v1/admin/channels/${extraTextChannelId}`,
    });

    expect(deleteTextChannelResponse.statusCode).toBe(200);
    expect(deleteTextChannelResponse.json()).toEqual({ ok: true });

    const deleteVoiceChannelResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'DELETE',
      url: `/v1/admin/channels/${extraVoiceChannelId}`,
    });

    expect(deleteVoiceChannelResponse.statusCode).toBe(200);
    expect(deleteVoiceChannelResponse.json()).toEqual({ ok: true });

    const workspaceAfterDeletes = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'GET',
      url: '/v1/admin/workspace',
    });

    expect(workspaceAfterDeletes.statusCode).toBe(200);
    expect(
      workspaceAfterDeletes
        .json()
        .channels.map((channel: { position: number }) => channel.position),
    ).toEqual([0, 1]);

    const remainingTextChannel = workspaceAfterDeletes
      .json()
      .channels.find((channel: { type: string }) => channel.type === 'text');
    const remainingVoiceChannel = workspaceAfterDeletes
      .json()
      .channels.find((channel: { type: string }) => channel.type === 'voice');

    const deleteLastTextResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'DELETE',
      url: `/v1/admin/channels/${remainingTextChannel.id as string}`,
    });

    expect(deleteLastTextResponse.statusCode).toBe(409);
    expect(deleteLastTextResponse.json().message).toBe(
      'At least one text channel must remain.',
    );

    const deleteLastVoiceResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'DELETE',
      url: `/v1/admin/channels/${remainingVoiceChannel.id as string}`,
    });

    expect(deleteLastVoiceResponse.statusCode).toBe(409);
    expect(deleteLastVoiceResponse.json().message).toBe(
      'At least one voice channel must remain.',
    );

    const createBlockedVoiceChannelResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'POST',
      payload: {
        name: 'blocked-voice',
        type: 'voice',
      },
      url: '/v1/admin/channels',
    });

    expect(createBlockedVoiceChannelResponse.statusCode).toBe(200);
    const blockedVoiceChannelId = createBlockedVoiceChannelResponse.json()
      .id as string;

    await dataAccess.streamSessions.create({
      channelId: blockedVoiceChannelId,
      hostUserId: ownerId,
      id: 'stream-session-1',
      sourceType: 'camera',
    });
    await dataAccess.streamSessions.updateStatus('stream-session-1', 'live', {
      startedAt: new Date(),
    });

    const deleteBlockedVoiceResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'DELETE',
      url: `/v1/admin/channels/${blockedVoiceChannelId}`,
    });

    expect(deleteBlockedVoiceResponse.statusCode).toBe(409);
    expect(deleteBlockedVoiceResponse.json().message).toBe(
      'Stop active livestreams before deleting this voice channel.',
    );

    await dataAccess.streamSessions.updateStatus(
      'stream-session-1',
      'stopping',
      { endedAt: new Date() },
    );

    const deleteUnblockedVoiceResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'DELETE',
      url: `/v1/admin/channels/${blockedVoiceChannelId}`,
    });

    expect(deleteUnblockedVoiceResponse.statusCode).toBe(200);

    const createReplacementChannelResponse = await app.inject({
      headers: { 'x-admin-password': 'admin' },
      method: 'POST',
      payload: {
        name: 'ops-room',
        type: 'voice',
      },
      url: '/v1/admin/channels',
    });

    expect(createReplacementChannelResponse.statusCode).toBe(200);
    expect(createReplacementChannelResponse.json().position).toBe(2);

    await app.close();
  });
});
