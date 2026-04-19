import type { DatabaseAccess } from '@baker/db';

import {
  AuthSessionSchema,
  AuthUserSchema,
  LoginRequestSchema,
  LogoutResponseSchema,
  MeResponseSchema,
  RefreshTokenRequestSchema,
  RegisterRequestSchema,
  UpdateMeRequestSchema,
} from '@baker/protocol';

import { ApiError } from '../lib/api-error';
import { ensureNewUserJoinsDefaultWorkspace } from '../lib/default-workspace';
import { hashPassword, verifyPassword } from '../lib/password';
import { requireAuth } from '../lib/require-auth';
import { getOrCreateServerSettings } from '../lib/server-settings';
import type { TokenService } from '../lib/token-service';

const REFRESH_TOKEN_TTL_DAYS = 30;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username: string) {
  return username.trim();
}

function assertValidUsername(username: string) {
  if (username.length < 2 || username.length > 32) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Username must be between 2 and 32 characters.', {
      field: 'username',
    });
  }
}

function toAuthUser(user: { email: string; id: string; username: string }) {
  return AuthUserSchema.parse({
    email: user.email,
    id: user.id,
    username: user.username,
  });
}

function createRefreshTokenExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
}

async function createSessionTokens(
  app: {
    dataAccess: DatabaseAccess;
    tokenService: TokenService;
  },
  input: {
    sessionId?: string;
    user: {
      email: string;
      id: string;
      username: string;
    };
  },
) {
  const session =
    input.sessionId != null
      ? await app.dataAccess.authSessions.touch(input.sessionId)
      : await app.dataAccess.authSessions.create({ userId: input.user.id });

  if (!session) {
    throw new ApiError(401, 'TOKEN_INVALID', 'Session is invalid.');
  }

  const refreshToken = app.tokenService.generateRefreshToken();
  await app.dataAccess.refreshTokens.create({
    expiresAt: createRefreshTokenExpiry(),
    sessionId: session.id,
    tokenHash: app.tokenService.hashRefreshToken(refreshToken),
    userId: input.user.id,
  });

  const accessToken = await app.tokenService.signAccessToken({
    sessionId: session.id,
    userId: input.user.id,
  });

  return AuthSessionSchema.parse({
    tokens: {
      accessToken,
      expiresInSeconds: app.tokenService.accessTokenTtlSeconds,
      refreshToken,
    },
    user: toAuthUser(input.user),
  });
}

interface AuthRoutesRequest {
  auth: {
    sessionId: string | null;
    userId: string | null;
  };
  authError: ApiError | null;
  body: unknown;
}

interface AuthRoutesApp {
  dataAccess: DatabaseAccess;
  get(path: string, handler: (request: AuthRoutesRequest) => Promise<unknown>): unknown;
  patch(path: string, handler: (request: AuthRoutesRequest) => Promise<unknown>): unknown;
  post(path: string, handler: (request: AuthRoutesRequest) => Promise<unknown>): unknown;
  tokenService: TokenService;
}

export function registerAuthRoutes(app: AuthRoutesApp) {
  app.post('/v1/auth/register', async (request) => {
    const settings = await getOrCreateServerSettings(app.dataAccess);
    if (!settings.allowPublicRegistration) {
      throw new ApiError(403, 'FORBIDDEN', 'Public registration is disabled by the server administrator.');
    }

    const input = RegisterRequestSchema.parse(request.body);
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    assertValidUsername(username);
    const existingUser = await app.dataAccess.users.findByEmail(email);

    if (existingUser) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Email is already in use.', { field: 'email' });
    }

    const passwordHash = await hashPassword(input.password);

    return app.dataAccess.withTransaction(async (repositories) => {
      const user = await repositories.users.create({
        email,
        passwordHash,
        username,
      });

      // All users join the shared default workspace rather than getting their own private guild.
      await ensureNewUserJoinsDefaultWorkspace(repositories, user.id, username, settings.serverName);

      const session = await repositories.authSessions.create({ userId: user.id });
      const refreshToken = app.tokenService.generateRefreshToken();

      await repositories.refreshTokens.create({
        expiresAt: createRefreshTokenExpiry(),
        sessionId: session.id,
        tokenHash: app.tokenService.hashRefreshToken(refreshToken),
        userId: user.id,
      });

      const accessToken = await app.tokenService.signAccessToken({
        sessionId: session.id,
        userId: user.id,
      });

      return AuthSessionSchema.parse({
        tokens: {
          accessToken,
          expiresInSeconds: app.tokenService.accessTokenTtlSeconds,
          refreshToken,
        },
        user: toAuthUser(user),
      });
    });
  });

  app.post('/v1/auth/login', async (request) => {
    const input = LoginRequestSchema.parse(request.body);
    const email = normalizeEmail(input.email);
    const user = await app.dataAccess.users.findByEmail(email);

    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    return createSessionTokens(app, { user });
  });

  app.post('/v1/auth/refresh', async (request) => {
    const input = RefreshTokenRequestSchema.parse(request.body);
    const hashedToken = app.tokenService.hashRefreshToken(input.refreshToken);
    const storedToken = await app.dataAccess.refreshTokens.findActiveByTokenHash(hashedToken);

    if (!storedToken) {
      throw new ApiError(401, 'TOKEN_INVALID', 'Refresh token is invalid.');
    }

    if (storedToken.expiresAt.getTime() <= Date.now()) {
      await app.dataAccess.refreshTokens.revoke(storedToken.id);
      throw new ApiError(401, 'TOKEN_EXPIRED', 'Refresh token has expired.');
    }

    const session = await app.dataAccess.authSessions.findById(storedToken.sessionId);
    if (!session || session.revokedAt) {
      throw new ApiError(401, 'TOKEN_INVALID', 'Session is invalid.');
    }

    const user = await app.dataAccess.users.findById(storedToken.userId);
    if (!user) {
      throw new ApiError(401, 'TOKEN_INVALID', 'User for refresh token no longer exists.');
    }

    await app.dataAccess.refreshTokens.revoke(storedToken.id);

    return createSessionTokens(app, { sessionId: session.id, user });
  });

  app.post('/v1/auth/logout', async (request) => {
    const auth = requireAuth(request);
    await app.dataAccess.authSessions.revoke(auth.sessionId);
    await app.dataAccess.refreshTokens.revokeBySessionId(auth.sessionId);
    return LogoutResponseSchema.parse({ ok: true });
  });

  app.get('/v1/auth/me', async (request) => {
    const auth = requireAuth(request);
    const user = await app.dataAccess.users.findById(auth.userId);

    if (!user) {
      throw new ApiError(401, 'TOKEN_INVALID', 'Authenticated user no longer exists.');
    }

    return MeResponseSchema.parse(toAuthUser(user));
  });

  app.patch('/v1/auth/me', async (request) => {
    const auth = requireAuth(request);
    const input = UpdateMeRequestSchema.parse(request.body);
    const username = normalizeUsername(input.username);
    assertValidUsername(username);

    const updatedUser = await app.dataAccess.users.update(auth.userId, { username });
    if (!updatedUser) {
      throw new ApiError(401, 'TOKEN_INVALID', 'Authenticated user no longer exists.');
    }

    return MeResponseSchema.parse(toAuthUser(updatedUser));
  });
}
