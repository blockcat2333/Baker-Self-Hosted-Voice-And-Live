import { describe, expect, it } from 'vitest';

import { buildApiApp } from './app';
import { createInMemoryDataAccess } from './testing/create-in-memory-data-access';

describe('api app', () => {
  it('serves health and service manifest', async () => {
    const app = buildApiApp({
      dataAccess: createInMemoryDataAccess(),
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const manifest = await app.inject({ method: 'GET', url: '/v1/meta/services' });

    expect(health.statusCode).toBe(200);
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json().services).toHaveLength(5);

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
      headers: { authorization: `Bearer ${registeredSession.tokens.accessToken}` },
      method: 'GET',
      url: '/v1/auth/me',
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().username).toBe('Staff');

    const updateMeResponse = await app.inject({
      headers: { authorization: `Bearer ${registeredSession.tokens.accessToken}` },
      method: 'PATCH',
      payload: { username: 'Staff Renamed' },
      url: '/v1/auth/me',
    });

    expect(updateMeResponse.statusCode).toBe(200);
    expect(updateMeResponse.json().username).toBe('Staff Renamed');

    const meAfterUpdateResponse = await app.inject({
      headers: { authorization: `Bearer ${registeredSession.tokens.accessToken}` },
      method: 'GET',
      url: '/v1/auth/me',
    });

    expect(meAfterUpdateResponse.statusCode).toBe(200);
    expect(meAfterUpdateResponse.json().username).toBe('Staff Renamed');

    // First user lands in the shared default workspace with one 'general' channel.
    const guildsResponse = await app.inject({
      headers: { authorization: `Bearer ${registeredSession.tokens.accessToken}` },
      method: 'GET',
      url: '/v1/guilds',
    });

    expect(guildsResponse.statusCode).toBe(200);
    expect(guildsResponse.json()).toHaveLength(1);
    const guildId = guildsResponse.json()[0].id as string;
    expect(guildsResponse.json()[0].name).toBe('Baker');

    const channelsResponse = await app.inject({
      headers: { authorization: `Bearer ${registeredSession.tokens.accessToken}` },
      method: 'GET',
      url: `/v1/guilds/${guildId}/channels`,
    });

    expect(channelsResponse.statusCode).toBe(200);
    expect(channelsResponse.json()).toHaveLength(2);
    const generalChannel = channelsResponse.json().find((c: { name: string }) => c.name === 'general');
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
      headers: { authorization: `Bearer ${registeredSession.tokens.accessToken}` },
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
      headers: { authorization: `Bearer ${loginResponse.json().tokens.accessToken}` },
      method: 'POST',
      url: '/v1/auth/logout',
    });

    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toEqual({ ok: true });

    const meAfterLogoutResponse = await app.inject({
      headers: { authorization: `Bearer ${loginResponse.json().tokens.accessToken}` },
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
      channelsResponse.json().some((channel: { name: string; voiceQuality: string }) =>
        channel.name === 'Ops Voice Updated' && channel.voiceQuality === 'standard'),
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
      manifestResponse.json().services.find((service: { name: string }) => service.name === 'web')?.url,
    ).toBe('http://localhost:8080');

    await app.close();
  });
});
