import type { AuthSessionPersistence, AuthSessionSnapshot } from '@baker/client';

const ACCESS_TOKEN_KEY = 'baker_access_token';
const REFRESH_TOKEN_KEY = 'baker_refresh_token';
const USER_KEY = 'baker_auth_user';
const REMEMBERED_CREDENTIALS_KEY = 'baker_remembered_credentials_v1';

function readLegacySession(): AuthSessionSnapshot | null {
  try {
    const accessToken = window.sessionStorage.getItem(ACCESS_TOKEN_KEY);
    const refreshToken = window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
    const rawUser = window.sessionStorage.getItem(USER_KEY);
    if (!accessToken || !refreshToken) return null;
    const user = rawUser ? (JSON.parse(rawUser) as AuthSessionSnapshot['user']) : null;
    return { accessToken, refreshToken, user };
  } catch {
    return null;
  }
}

function clearLegacyDesktopAuth() {
  try {
    window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
  } catch {
    // Storage cleanup is best-effort; encrypted session handling still works.
  }
}

export function createDesktopAuthSessionPersistence(
  serverId: string,
  onPersistenceUnavailable: () => void,
): AuthSessionPersistence {
  return {
    async clear() {
      clearLegacyDesktopAuth();
      await window.bakerDesktop?.clearServerSession(serverId);
    },
    async load() {
      const saved = await window.bakerDesktop?.getServerSession(serverId);
      if (saved) {
        clearLegacyDesktopAuth();
        return saved;
      }

      const legacy = readLegacySession();
      clearLegacyDesktopAuth();
      if (!legacy) return null;
      const result = await window.bakerDesktop?.saveServerSession(serverId, legacy);
      if (result && !result.persisted) onPersistenceUnavailable();
      return legacy;
    },
    async save(session) {
      clearLegacyDesktopAuth();
      const result = await window.bakerDesktop?.saveServerSession(serverId, session);
      if (result && !result.persisted) onPersistenceUnavailable();
    },
  };
}
