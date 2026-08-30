import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopAuthSessionPersistence } from './desktop-session-persistence';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('desktop auth session persistence', () => {
  it('migrates a legacy renderer session and removes plaintext credentials', async () => {
    const localStorage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    const user = { email: 'user@example.com', id: 'user-id', username: 'user' };
    sessionStorage.setItem('baker_access_token', 'legacy-access');
    sessionStorage.setItem('baker_refresh_token', 'legacy-refresh');
    sessionStorage.setItem('baker_auth_user', JSON.stringify(user));
    localStorage.setItem('baker_remembered_credentials_v1', 'plaintext-password');
    const saveServerSession = vi.fn(async () => ({ persisted: true }));
    vi.stubGlobal('window', {
      bakerDesktop: { getServerSession: vi.fn(async () => null), saveServerSession },
      localStorage,
      sessionStorage,
    });

    const session = await createDesktopAuthSessionPersistence('server-one', vi.fn()).load();

    expect(session).toEqual({ accessToken: 'legacy-access', refreshToken: 'legacy-refresh', user });
    expect(saveServerSession).toHaveBeenCalledWith('server-one', session);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem('baker_remembered_credentials_v1')).toBeNull();
  });

  it('warns instead of falling back to plaintext without secure storage', async () => {
    const onPersistenceUnavailable = vi.fn();
    vi.stubGlobal('window', {
      bakerDesktop: { saveServerSession: vi.fn(async () => ({ persisted: false })) },
      localStorage: createMemoryStorage(),
      sessionStorage: createMemoryStorage(),
    });

    await createDesktopAuthSessionPersistence('server-one', onPersistenceUnavailable).save({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: null,
    });

    expect(onPersistenceUnavailable).toHaveBeenCalledOnce();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
