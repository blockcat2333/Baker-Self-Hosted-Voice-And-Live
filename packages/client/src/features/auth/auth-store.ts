import { create } from 'zustand';

import { ApiError, type ApiClient } from '@baker/sdk';
import type { AuthUser } from '@baker/protocol';

import { useChatStore } from '../chat/chat-store';

const ACCESS_TOKEN_KEY = 'baker_access_token';
const REFRESH_TOKEN_KEY = 'baker_refresh_token';
const USER_KEY = 'baker_auth_user';

function getSessionStorage() {
  return sessionStorage;
}

function loadStoredSession(): { accessToken: string; refreshToken: string; user: AuthUser | null } | null {
  try {
    const storage = getSessionStorage();
    const access = storage.getItem(ACCESS_TOKEN_KEY);
    const refresh = storage.getItem(REFRESH_TOKEN_KEY);
    const rawUser = storage.getItem(USER_KEY);
    const user = rawUser ? (JSON.parse(rawUser) as AuthUser) : null;
    if (access && refresh) return { accessToken: access, refreshToken: refresh, user };
  } catch {
    // sessionStorage unavailable (SSR / test env)
  }
  return null;
}

function saveSession(accessToken: string, refreshToken: string, user: AuthUser) {
  try {
    const storage = getSessionStorage();
    storage.setItem(ACCESS_TOKEN_KEY, accessToken);
    storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    storage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

function clearTokens() {
  try {
    const storage = getSessionStorage();
    storage.removeItem(ACCESS_TOKEN_KEY);
    storage.removeItem(REFRESH_TOKEN_KEY);
    storage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  isLoading: boolean;
  isBootstrapping: boolean;

  login(api: ApiClient, email: string, password: string): Promise<void>;
  register(api: ApiClient, email: string, password: string, username: string): Promise<void>;
  updateUsername(api: ApiClient, username: string): Promise<void>;
  bootstrapSession(api: ApiClient): Promise<void>;
  logout(api?: ApiClient): Promise<void>;
  /** Attempt a silent token refresh. Returns new accessToken or null on failure. */
  refreshTokens(api: ApiClient): Promise<string | null>;
  /** Rehydrate from localStorage on app mount. */
  rehydrate(): void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  error: null,
  isLoading: false,
  isBootstrapping: false,

  rehydrate() {
    const stored = loadStoredSession();
    if (stored) {
      set({
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        user: stored.user,
      });
    }
  },

  async bootstrapSession(api) {
    const { accessToken, refreshToken } = get();
    if (!accessToken || !refreshToken) {
      set({ isBootstrapping: false });
      return;
    }

    set({ isBootstrapping: true });

    try {
      const user = await api.me();
      saveSession(accessToken, refreshToken, user);
      set({ error: null, isBootstrapping: false, user });
      return;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) {
        set({ isBootstrapping: false });
        return;
      }
    }

    const newAccessToken = await get().refreshTokens(api);
    if (!newAccessToken) {
      set({ isBootstrapping: false });
      return;
    }

    try {
      const refreshedUser = await api.me();
      const currentRefreshToken = get().refreshToken;
      if (currentRefreshToken) {
        saveSession(newAccessToken, currentRefreshToken, refreshedUser);
      }
      set({ error: null, isBootstrapping: false, user: refreshedUser });
    } catch {
      clearTokens();
      set({
        accessToken: null,
        error: null,
        isBootstrapping: false,
        refreshToken: null,
        user: null,
      });
    }
  },

  async login(api, email, password) {
    set({ isLoading: true, error: null });
    try {
      const session = await api.login({ email, password });
      saveSession(session.tokens.accessToken, session.tokens.refreshToken, session.user);
      set({
        user: session.user,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
        isBootstrapping: false,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Login failed.' });
      throw err;
    }
  },

  async register(api, email, password, username) {
    set({ isLoading: true, error: null });
    try {
      const session = await api.register({ email, password, username });
      saveSession(session.tokens.accessToken, session.tokens.refreshToken, session.user);
      set({
        user: session.user,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
        isBootstrapping: false,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Registration failed.' });
      throw err;
    }
  },

  async updateUsername(api, username) {
    const { accessToken, refreshToken } = get();
    if (!accessToken || !refreshToken) {
      throw new Error('You must be signed in to update your username.');
    }

    set({ isLoading: true, error: null });
    try {
      const user = await api.updateMe({ username });
      saveSession(accessToken, refreshToken, user);
      set({
        user,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Profile update failed.' });
      throw err;
    }
  },

  async logout(api) {
    const { accessToken } = get();
    if (api && accessToken) {
      try {
        await api.logout();
      } catch {
        // Best effort: local logout should still complete if the server is unavailable.
      }
    }
    clearTokens();
    set({ user: null, accessToken: null, refreshToken: null, error: null, isBootstrapping: false });
    // Clear cached chat data so a subsequent login doesn't see stale state.
    // Gateway disconnect is handled by AppRoot's useEffect reacting to accessToken -> null.
    useChatStore.getState().reset();
  },

  async refreshTokens(api) {
    const { refreshToken } = get();
    if (!refreshToken) return null;
    try {
      const session = await api.refresh({ refreshToken });
      saveSession(session.tokens.accessToken, session.tokens.refreshToken, session.user);
      set({
        user: session.user,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
      });
      return session.tokens.accessToken;
    } catch {
      // Refresh failed -> force logout
      clearTokens();
      set({ user: null, accessToken: null, refreshToken: null });
      return null;
    }
  },
}));
