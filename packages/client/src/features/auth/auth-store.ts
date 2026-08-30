import { create } from 'zustand';

import { ApiError, type ApiClient } from '@baker/sdk';
import type { AuthUser } from '@baker/protocol';

import { useChatStore } from '../chat/chat-store';

const ACCESS_TOKEN_KEY = 'baker_access_token';
const REFRESH_TOKEN_KEY = 'baker_refresh_token';
const USER_KEY = 'baker_auth_user';

export interface AuthSessionSnapshot {
  accessToken: string;
  refreshToken: string;
  user: AuthUser | null;
}

export interface AuthSessionPersistence {
  clear(): Promise<void>;
  load(): Promise<AuthSessionSnapshot | null>;
  save(session: AuthSessionSnapshot): Promise<void>;
}

function getSessionStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
}

function clearLegacyLocalStorageTokens() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // Legacy localStorage may be blocked; session auth should still work.
  }
}

function loadStoredSession(): AuthSessionSnapshot | null {
  try {
    clearLegacyLocalStorageTokens();
    const storage = getSessionStorage();
    if (!storage) return null;
    const access = storage.getItem(ACCESS_TOKEN_KEY);
    const refresh = storage.getItem(REFRESH_TOKEN_KEY);
    const rawUser = storage.getItem(USER_KEY);
    const user = rawUser ? (JSON.parse(rawUser) as AuthUser) : null;
    if (access && refresh) return { accessToken: access, refreshToken: refresh, user };
  } catch {
    // Session storage unavailable (SSR / test env)
  }
  return null;
}

function saveBrowserSession(accessToken: string, refreshToken: string, user: AuthUser) {
  try {
    clearLegacyLocalStorageTokens();
    const storage = getSessionStorage();
    if (!storage) return;
    storage.setItem(ACCESS_TOKEN_KEY, accessToken);
    storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    storage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // ignore
  }
}

function clearBrowserSession() {
  try {
    clearLegacyLocalStorageTokens();
    const storage = getSessionStorage();
    if (!storage) return;
    storage.removeItem(ACCESS_TOKEN_KEY);
    storage.removeItem(REFRESH_TOKEN_KEY);
    storage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

export function createBrowserAuthSessionPersistence(): AuthSessionPersistence {
  return {
    async clear() {
      clearBrowserSession();
    },
    async load() {
      return loadStoredSession();
    },
    async save(session) {
      if (session.user) {
        saveBrowserSession(session.accessToken, session.refreshToken, session.user);
      }
    },
  };
}

let activeSessionPersistence: AuthSessionPersistence = createBrowserAuthSessionPersistence();
let activeSessionScope = 'web';
let activeSessionGeneration = 0;

async function saveActiveSession(accessToken: string, refreshToken: string, user: AuthUser) {
  try {
    await activeSessionPersistence.save({ accessToken, refreshToken, user });
  } catch {
    // Persistence failures must not discard a valid in-memory login.
  }
}

async function clearActiveSession(persistence = activeSessionPersistence) {
  try {
    await persistence.clear();
  } catch {
    // Local logout still succeeds if the persistence layer is unavailable.
  }
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  error: string | null;
  isLoading: boolean;
  isBootstrapping: boolean;

  sessionScope: string;

  activateSessionPersistence(scope: string, persistence: AuthSessionPersistence): Promise<void>;
  clearRuntimeSession(): void;
  login(api: ApiClient, email: string, password: string): Promise<void>;
  register(api: ApiClient, email: string, password: string, username: string): Promise<void>;
  updateUsername(api: ApiClient, username: string): Promise<void>;
  bootstrapSession(api: ApiClient): Promise<void>;
  logout(api?: ApiClient): Promise<void>;
  /** Attempt a silent token refresh. Returns new accessToken or null on failure. */
  refreshTokens(api: ApiClient): Promise<string | null>;
  /** Rehydrate from the active persistence adapter on app mount. */
  rehydrate(): Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  error: null,
  isLoading: false,
  isBootstrapping: false,
  sessionScope: activeSessionScope,

  async activateSessionPersistence(scope, persistence) {
    const generation = ++activeSessionGeneration;
    activeSessionScope = scope;
    activeSessionPersistence = persistence;
    set({
      accessToken: null,
      error: null,
      isBootstrapping: true,
      isLoading: false,
      refreshToken: null,
      sessionScope: scope,
      user: null,
    });

    let stored: AuthSessionSnapshot | null = null;
    try {
      stored = await persistence.load();
    } catch {
      stored = null;
    }

    if (generation !== activeSessionGeneration || scope !== activeSessionScope) return;
    set({
      accessToken: stored?.accessToken ?? null,
      isBootstrapping: false,
      refreshToken: stored?.refreshToken ?? null,
      user: stored?.user ?? null,
    });
  },

  clearRuntimeSession() {
    activeSessionGeneration += 1;
    set({
      accessToken: null,
      error: null,
      isBootstrapping: false,
      isLoading: false,
      refreshToken: null,
      user: null,
    });
  },

  async rehydrate() {
    await get().activateSessionPersistence(activeSessionScope, activeSessionPersistence);
  },

  async bootstrapSession(api) {
    const generation = activeSessionGeneration;
    const { accessToken, refreshToken } = get();
    if (!accessToken || !refreshToken) {
      set({ isBootstrapping: false });
      return;
    }

    set({ isBootstrapping: true });

    try {
      const user = await api.me();
      if (generation !== activeSessionGeneration) return;
      await saveActiveSession(accessToken, refreshToken, user);
      if (generation !== activeSessionGeneration) return;
      set({ error: null, isBootstrapping: false, user });
      return;
    } catch (err) {
      if (generation !== activeSessionGeneration) return;
      if (!(err instanceof ApiError) || err.status !== 401) {
        set({ isBootstrapping: false });
        return;
      }
    }

    const newAccessToken = await get().refreshTokens(api);
    if (generation !== activeSessionGeneration) return;
    if (!newAccessToken) {
      set({ isBootstrapping: false });
      return;
    }

    try {
      const refreshedUser = await api.me();
      if (generation !== activeSessionGeneration) return;
      const currentRefreshToken = get().refreshToken;
      if (currentRefreshToken) {
        await saveActiveSession(newAccessToken, currentRefreshToken, refreshedUser);
      }
      if (generation !== activeSessionGeneration) return;
      set({ error: null, isBootstrapping: false, user: refreshedUser });
    } catch {
      if (generation !== activeSessionGeneration) return;
      await clearActiveSession();
      if (generation !== activeSessionGeneration) return;
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
    const generation = activeSessionGeneration;
    set({ isLoading: true, error: null });
    try {
      const session = await api.login({ email, password });
      if (generation !== activeSessionGeneration) return;
      await saveActiveSession(session.tokens.accessToken, session.tokens.refreshToken, session.user);
      if (generation !== activeSessionGeneration) return;
      set({
        user: session.user,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
        isBootstrapping: false,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      if (generation !== activeSessionGeneration) return;
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Login failed.' });
      throw err;
    }
  },

  async register(api, email, password, username) {
    const generation = activeSessionGeneration;
    set({ isLoading: true, error: null });
    try {
      const session = await api.register({ email, password, username });
      if (generation !== activeSessionGeneration) return;
      await saveActiveSession(session.tokens.accessToken, session.tokens.refreshToken, session.user);
      if (generation !== activeSessionGeneration) return;
      set({
        user: session.user,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
        isBootstrapping: false,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      if (generation !== activeSessionGeneration) return;
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Registration failed.' });
      throw err;
    }
  },

  async updateUsername(api, username) {
    const generation = activeSessionGeneration;
    const { accessToken, refreshToken } = get();
    if (!accessToken || !refreshToken) {
      throw new Error('You must be signed in to update your username.');
    }

    set({ isLoading: true, error: null });
    try {
      const user = await api.updateMe({ username });
      if (generation !== activeSessionGeneration) return;
      await saveActiveSession(accessToken, refreshToken, user);
      if (generation !== activeSessionGeneration) return;
      set({
        user,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      if (generation !== activeSessionGeneration) return;
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Profile update failed.' });
      throw err;
    }
  },

  async logout(api) {
    const { accessToken } = get();
    const generation = activeSessionGeneration;
    const persistence = activeSessionPersistence;
    if (api && accessToken) {
      try {
        await api.logout();
      } catch {
        // Best effort: local logout should still complete if the server is unavailable.
      }
    }
    await clearActiveSession(persistence);
    if (generation !== activeSessionGeneration) return;
    set({ user: null, accessToken: null, refreshToken: null, error: null, isBootstrapping: false });
    // Clear cached chat data so a subsequent login doesn't see stale state.
    // Gateway disconnect is handled by AppRoot's useEffect reacting to accessToken -> null.
    useChatStore.getState().reset();
  },

  async refreshTokens(api) {
    const { refreshToken } = get();
    if (!refreshToken) return null;
    const generation = activeSessionGeneration;
    try {
      const session = await api.refresh({ refreshToken });
      if (generation !== activeSessionGeneration) return null;
      await saveActiveSession(session.tokens.accessToken, session.tokens.refreshToken, session.user);
      if (generation !== activeSessionGeneration) return null;
      set({
        user: session.user,
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
      });
      return session.tokens.accessToken;
    } catch {
      // Refresh failed -> force logout
      if (generation !== activeSessionGeneration) return null;
      await clearActiveSession();
      if (generation !== activeSessionGeneration) return null;
      set({ user: null, accessToken: null, refreshToken: null });
      return null;
    }
  },
}));
