import { z } from 'zod';

const DEFAULT_ADMIN_PANEL_PASSWORD = 'admin';
const DEFAULT_JWT_ACCESS_SECRET = 'replace-me-for-local-access';
const DEFAULT_JWT_REFRESH_SECRET = 'replace-me-for-local-refresh';
const DEFAULT_MEDIA_INTERNAL_SECRET = 'replace-me-for-local-media-internal-secret';

const AppEnvSchema = z.object({
  ADMIN_PANEL_PASSWORD: z.string().min(1).default(DEFAULT_ADMIN_PANEL_PASSWORD),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1).default('postgres://baker:baker@127.0.0.1:5432/baker'),
  DESKTOP_DEV_SERVER_URL: z.string().url().default('http://localhost:5174'),
  GATEWAY_HOST: z.string().default('0.0.0.0'),
  GATEWAY_PORT: z.coerce.number().int().positive().default(3002),
  JWT_ACCESS_SECRET: z.string().min(16).default(DEFAULT_JWT_ACCESS_SECRET),
  JWT_REFRESH_SECRET: z.string().min(16).default(DEFAULT_JWT_REFRESH_SECRET),
  MEDIA_HOST: z.string().default('0.0.0.0'),
  // Intentionally optional so we can derive a correct default from MEDIA_PORT.
  // When MEDIA_PORT is overridden (e.g. due to Windows excluded port ranges),
  // keeping MEDIA_INTERNAL_URL pinned to 3003 will break gateway -> media calls.
  MEDIA_INTERNAL_URL: z.string().url().optional(),
  MEDIA_INTERNAL_SECRET: z.string().min(16).default(DEFAULT_MEDIA_INTERNAL_SECRET),
  MEDIA_PORT: z.coerce.number().int().positive().default(3003),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  // Multiple STUN endpoints improve reliability across regions/networks (some are blocked).
  STUN_URLS: z.string().default('stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302'),
  TURN_PASSWORD: z.string().default(''),
  TURN_URLS: z.string().default(''),
  TURN_USERNAME: z.string().default(''),
  WEB_PORT: z.coerce.number().int().positive().default(80),
});

type ParsedAppEnv = z.infer<typeof AppEnvSchema>;

export type AppEnv = Omit<ParsedAppEnv, 'MEDIA_INTERNAL_URL'> & {
  MEDIA_INTERNAL_URL: string;
};
export type NodeServiceName = 'api' | 'gateway' | 'media';

export function parseAppEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = AppEnvSchema.parse(source);

  if (parsed.NODE_ENV === 'production') {
    const insecureDefaults = [
      parsed.ADMIN_PANEL_PASSWORD === DEFAULT_ADMIN_PANEL_PASSWORD ? 'ADMIN_PANEL_PASSWORD' : null,
      parsed.JWT_ACCESS_SECRET === DEFAULT_JWT_ACCESS_SECRET ? 'JWT_ACCESS_SECRET' : null,
      parsed.JWT_REFRESH_SECRET === DEFAULT_JWT_REFRESH_SECRET ? 'JWT_REFRESH_SECRET' : null,
      parsed.MEDIA_INTERNAL_SECRET === DEFAULT_MEDIA_INTERNAL_SECRET ? 'MEDIA_INTERNAL_SECRET' : null,
    ].filter((value): value is string => value !== null);

    if (insecureDefaults.length > 0) {
      throw new Error(
        `Refusing to start with insecure default secrets in production: ${insecureDefaults.join(', ')}.`,
      );
    }
  }

  // Default internal media URL to loopback + the resolved MEDIA_PORT.
  // This keeps gateway -> media calls working even when only MEDIA_PORT is set.
  const mediaInternalUrl = parsed.MEDIA_INTERNAL_URL ?? `http://127.0.0.1:${parsed.MEDIA_PORT}`;

  return {
    ...parsed,
    MEDIA_INTERNAL_URL: mediaInternalUrl,
  };
}

export function getServiceBinding(env: AppEnv, service: NodeServiceName) {
  switch (service) {
    case 'api':
      return { host: env.API_HOST, port: env.API_PORT };
    case 'gateway':
      return { host: env.GATEWAY_HOST, port: env.GATEWAY_PORT };
    case 'media':
      return { host: env.MEDIA_HOST, port: env.MEDIA_PORT };
    default: {
      const _exhaustive: never = service;
      return _exhaustive;
    }
  }
}

export function parseIceServerUrls(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getIceConfig(env: AppEnv) {
  return {
    stunUrls: parseIceServerUrls(env.STUN_URLS),
    turnPassword: env.TURN_PASSWORD,
    turnUrls: parseIceServerUrls(env.TURN_URLS),
    turnUsername: env.TURN_USERNAME,
  };
}
