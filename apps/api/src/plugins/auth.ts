import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { ApiError } from '../lib/api-error';
import type { TokenService } from '../lib/token-service';

declare module 'fastify' {
  interface FastifyInstance {
    tokenService: TokenService;
  }

  interface FastifyRequest {
    auth: {
      sessionId: string | null;
      userId: string | null;
    };
    authError: ApiError | null;
    authErrorState: ApiError | null;
    authState: {
      sessionId: string | null;
      userId: string | null;
    } | null;
  }
}

export const authPlugin = fp(async (app) => {
  app.decorateRequest('authState', null);
  app.decorateRequest('authErrorState', null);
  app.decorateRequest('auth', {
    getter(this: FastifyRequest) {
      return this.authState ?? { sessionId: null, userId: null };
    },
    setter(this: FastifyRequest, value: FastifyRequest['auth']) {
      this.authState = value;
    },
  });
  app.decorateRequest('authError', {
    getter(this: FastifyRequest) {
      return this.authErrorState;
    },
    setter(this: FastifyRequest, value: FastifyRequest['authError']) {
      this.authErrorState = value;
    },
  });
  app.addHook('onRequest', async (request) => {
    request.auth = { sessionId: null, userId: null };
    request.authError = null;

    const authorization = request.headers.authorization;
    if (!authorization) {
      return;
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      request.authError = new ApiError(401, 'UNAUTHORIZED', 'Authorization header must use Bearer token.');
      return;
    }

    const verified = await app.tokenService.verifyAccessToken(token);
    if (!verified.ok) {
      request.authError = new ApiError(401, verified.code, 'Access token is invalid or expired.');
      return;
    }

    const session = await app.dataAccess.authSessions.findById(verified.value.sessionId);
    if (!session || session.revokedAt || session.userId !== verified.value.userId) {
      request.authError = new ApiError(401, 'TOKEN_INVALID', 'Access token session is no longer active.');
      return;
    }

    request.auth = verified.value;
  });
});
