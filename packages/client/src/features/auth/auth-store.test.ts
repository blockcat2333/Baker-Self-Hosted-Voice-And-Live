import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '@baker/sdk';
import type { AuthUser } from '@baker/protocol';

import {
  createBrowserAuthSessionPersistence,
  type AuthSessionPersistence,
  type AuthSessionSnapshot,
  useAuthStore,
} from './auth-store';

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

  beforeEach(async () => {
    localStorage = createMemoryStorage();
    sessionStorage = createMemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    resetAuthStore();
    await useAuthStore
      .getState()
      .activateSessionPersistence('web-test', createBrowserAuthSessionPersistence());
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
    await useAuthStore.getState().rehydrate();

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
    await useAuthStore.getState().rehydrate();

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

  it('clears legacy localStorage tokens during rehydrate', async () => {
    localStorage.setItem('baker_access_token', 'legacy-access-token');
    localStorage.setItem('baker_refresh_token', 'legacy-refresh-token');
    localStorage.setItem('baker_auth_user', JSON.stringify(user));

    await useAuthStore.getState().rehydrate();

    expect(localStorage.getItem('baker_access_token')).toBeNull();
    expect(localStorage.getItem('baker_refresh_token')).toBeNull();
    expect(localStorage.getItem('baker_auth_user')).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      refreshToken: null,
      user: null,
    });
  });

  it('keeps encrypted-style session adapters isolated by server scope', async () => {
    function createScopedPersistence(): AuthSessionPersistence & { session: AuthSessionSnapshot | null } {
      const persistence = {
        session: null as AuthSessionSnapshot | null,
        async clear() {
          persistence.session = null;
        },
        async load() {
          return persistence.session;
        },
        async save(session: AuthSessionSnapshot) {
          persistence.session = session;
        },
      };
      return persistence;
    }

    const first = createScopedPersistence();
    const second = createScopedPersistence();
    const firstApi = {
      login: vi.fn().mockResolvedValue({
        tokens: { accessToken: 'first-access', refreshToken: 'first-refresh' },
        user,
      }),
    } as unknown as ApiClient;
    const secondApi = {
      login: vi.fn().mockResolvedValue({
        tokens: { accessToken: 'second-access', refreshToken: 'second-refresh' },
        user: { ...user, id: '22222222-2222-4222-8222-222222222222' },
      }),
    } as unknown as ApiClient;

    await useAuthStore.getState().activateSessionPersistence('server:first', first);
    await useAuthStore.getState().login(firstApi, user.email, 'password123');
    await useAuthStore.getState().activateSessionPersistence('server:second', second);
    await useAuthStore.getState().login(secondApi, user.email, 'password123');
    await useAuthStore.getState().activateSessionPersistence('server:first', first);

    expect(useAuthStore.getState().accessToken).toBe('first-access');
    await useAuthStore.getState().logout();
    expect(first.session).toBeNull();
    expect(second.session?.accessToken).toBe('second-access');
  });

  it('ignores a login response that completes after switching scopes', async () => {
    let resolveLogin!: (value: unknown) => void;
    const pendingLogin = new Promise((resolve) => {
      resolveLogin = resolve;
    });
    const first: AuthSessionPersistence = {
      clear: vi.fn(async () => undefined),
      load: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
    };
    const second: AuthSessionPersistence = {
      clear: vi.fn(async () => undefined),
      load: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
    };
    const api = { login: vi.fn(() => pendingLogin) } as unknown as ApiClient;

    await useAuthStore.getState().activateSessionPersistence('server:first', first);
    const login = useAuthStore.getState().login(api, user.email, 'password123');
    await useAuthStore.getState().activateSessionPersistence('server:second', second);
    resolveLogin({
      tokens: { accessToken: 'stale-access', refreshToken: 'stale-refresh' },
      user,
    });
    await login;

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      sessionScope: 'server:second',
    });
    expect(first.save).not.toHaveBeenCalled();
    expect(second.save).not.toHaveBeenCalled();
  });
});
