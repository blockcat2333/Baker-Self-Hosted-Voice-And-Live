import { createHmac, randomBytes } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

import type { AppEnv } from '@baker/shared';

export interface AccessTokenClaims {
  sessionId: string;
  userId: string;
}

export type VerifyAccessTokenResult =
  | { ok: true; value: AccessTokenClaims }
  | { code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID'; ok: false };

export interface TokenService {
  readonly accessTokenTtlSeconds: number;
  generateRefreshToken(): string;
  hashRefreshToken(token: string): string;
  signAccessToken(claims: AccessTokenClaims): Promise<string>;
  verifyAccessToken(token: string): Promise<VerifyAccessTokenResult>;
}

interface AccessTokenPayload extends JWTPayload {
  sid: string;
  type: 'access';
}

const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;

export function createTokenService(env: Pick<AppEnv, 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'>): TokenService {
  const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

  return {
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    generateRefreshToken() {
      return randomBytes(32).toString('base64url');
    },
    hashRefreshToken(token: string) {
      return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
    },
    async signAccessToken(claims: AccessTokenClaims) {
      return new SignJWT({
        sid: claims.sessionId,
        type: 'access',
      } satisfies AccessTokenPayload)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.userId)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(accessSecret);
    },
    async verifyAccessToken(token: string) {
      try {
        const { payload } = await jwtVerify(token, accessSecret);

        if (payload.type !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
          return { code: 'TOKEN_INVALID', ok: false } as const;
        }

        return {
          ok: true,
          value: {
            sessionId: payload.sid,
            userId: payload.sub,
          },
        } as const;
      } catch (error) {
        if (error instanceof Error && error.name === 'JWTExpired') {
          return { code: 'TOKEN_EXPIRED', ok: false } as const;
        }

        return { code: 'TOKEN_INVALID', ok: false } as const;
      }
    },
  };
}
