/**
 * JWT access token verifier for the gateway.
 *
 * Mirrors the verification logic in apps/api/src/lib/token-service.ts but
 * does NOT import from apps/api — both services read the same JWT_ACCESS_SECRET
 * from the environment. This keeps the service boundary clean.
 */

import { jwtVerify } from 'jose';

import type { AppEnv } from '@baker/shared';

export interface AccessTokenClaims {
  sessionId: string;
  userId: string;
}

export type VerifyAccessTokenResult =
  | { ok: true; value: AccessTokenClaims }
  | { code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID'; ok: false };

export function createTokenVerifier(env: Pick<AppEnv, 'JWT_ACCESS_SECRET'>) {
  const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

  return async function verifyAccessToken(token: string): Promise<VerifyAccessTokenResult> {
    try {
      const { payload } = await jwtVerify(token, accessSecret);

      if (payload['type'] !== 'access' || typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') {
        return { code: 'TOKEN_INVALID', ok: false };
      }

      return {
        ok: true,
        value: {
          sessionId: payload['sid'] as string,
          userId: payload.sub,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'JWTExpired') {
        return { code: 'TOKEN_EXPIRED', ok: false };
      }
      return { code: 'TOKEN_INVALID', ok: false };
    }
  };
}

export type TokenVerifier = ReturnType<typeof createTokenVerifier>;
