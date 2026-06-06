import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@baker/sdk';
import type { AuthUser } from '@baker/protocol';

import { useAuthStore } from './auth-store';

const user: AuthUser = {
  email: 'user@example.com',
  id: '11111111-1111-4111-8111-111111111111',
  username: 'user',
};

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function resetAuthStore() {
  useAuthStore.setState({
    accessToken: null,
    error: null,
    isBootstrapping: false,
    isLoading: false,
    refreshToken: null,
    user: null,
  });
}

describe('auth store persistence', () => {
  let localStorage: Storage;
  let sessionStorage: Storage;

  beforeEach(() => {
    localStorage = createMemoryStorage();
    sessionStorage = createMemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    resetAuthStore();
  });

  afterEach(() => {
    resetAuthStore();
    vi.unstubAllGlobals();
  });

  it('persists login sessions across app restarts', async () => {
    const api = {
      login: vi.fn().mockResolvedValue({
        tokens: {
          accessToken: 'access-token',
          expiresInSeconds: 900,
          refreshToken: 'refresh-token',
        },
        user,
      }),
    } as unknown as ApiClient;

    await useAuthStore.getState().login(api, user.email, 'password123');

    expect(sessionStorage.getItem('baker_access_token')).toBe('access-token');
    expect(sessionStorage.getItem('baker_refresh_token')).toBe('refresh-token');
    expect(sessionStorage.getItem('baker_auth_user')).toBe(JSON.stringify(user));
    expect(localStorage.getItem('baker_access_token')).toBeNull();
    expect(localStorage.getItem('baker_refresh_token')).toBeNull();
    expect(localStorage.getItem('baker_auth_user')).toBeNull();

    resetAuthStore();
    useAuthStore.getState().rehydrate();

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user,
    });
  });

  it('clears the persisted session on logout', async () => {
    sessionStorage.setItem('baker_access_token', 'access-token');
    sessionStorage.setItem('baker_refresh_token', 'refresh-token');
    sessionStorage.setItem('baker_auth_user', JSON.stringify(user));
    useAuthStore.getState().rehydrate();

    await useAuthStore.getState().logout();

    expect(sessionStorage.getItem('baker_access_token')).toBeNull();
    expect(sessionStorage.getItem('baker_refresh_token')).toBeNull();
    expect(sessionStorage.getItem('baker_auth_user')).toBeNull();
    expect(localStorage.getItem('baker_access_token')).toBeNull();
    expect(localStorage.getItem('baker_refresh_token')).toBeNull();
    expect(localStorage.getItem('baker_auth_user')).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      refreshToken: null,
      user: null,
    });
  });

  it('clears legacy localStorage tokens during rehydrate', () => {
    localStorage.setItem('baker_access_token', 'legacy-access-token');
    localStorage.setItem('baker_refresh_token', 'legacy-refresh-token');
    localStorage.setItem('baker_auth_user', JSON.stringify(user));

    useAuthStore.getState().rehydrate();

    expect(localStorage.getItem('baker_access_token')).toBeNull();
    expect(localStorage.getItem('baker_refresh_token')).toBeNull();
    expect(localStorage.getItem('baker_auth_user')).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      refreshToken: null,
      user: null,
    });
  });
});
