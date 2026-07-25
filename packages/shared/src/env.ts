import { z } from 'zod';

const DEFAULT_ADMIN_PANEL_PASSWORD = 'admin';
const DEFAULT_JWT_ACCESS_SECRET = 'replace-me-for-local-access';
const DEFAULT_JWT_REFRESH_SECRET = 'replace-me-for-local-refresh';
const DEFAULT_MEDIA_INTERNAL_SECRET =
  'replace-me-for-local-media-internal-secret';

const EnvBooleanSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

const AppEnvSchema = z.object({
  ADMIN_PANEL_PASSWORD: z.string().min(1).default(DEFAULT_ADMIN_PANEL_PASSWORD),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://baker:baker@127.0.0.1:5432/baker'),
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
  MEDIA_REGION_PROFILES: z.string().default(''),
  MEDIA_INTERNAL_SECRET: z
    .string()
    .min(16)
    .default(DEFAULT_MEDIA_INTERNAL_SECRET),
  MEDIA_PORT: z.coerce.number().int().positive().default(3003),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  SFU_ANNOUNCED_IP: z.string().default(''),
  SFU_ENABLE_TCP: EnvBooleanSchema.default(true),
  SFU_RTC_MAX_PORT: z.coerce.number().int().positive().default(50100),
  SFU_RTC_MIN_PORT: z.coerce.number().int().positive().default(50000),
  // Multiple STUN endpoints improve reliability across regions/networks (some are blocked).
  STUN_URLS: z
    .string()
    .default('stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302'),
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

const UrlListSchema = z.union([z.string(), z.array(z.string())]);

const MediaRegionProfileInputSchema = z.object({
  hosts: z.array(z.string().min(1)).default([]),
  id: z.string().min(1),
  sfuAnnouncedIp: z.string().default(''),
  sfuEnableTcp: EnvBooleanSchema.optional(),
  sfuRtcMaxPort: z.coerce.number().int().positive().max(65535).optional(),
  sfuRtcMinPort: z.coerce.number().int().positive().max(65535).optional(),
  stunUrls: UrlListSchema.optional(),
  turnPassword: z.string().optional(),
  turnUrls: UrlListSchema.optional(),
  turnUsername: z.string().optional(),
});

export interface MediaRegionProfile {
  hosts: string[];
  id: string;
  sfuAnnouncedIp: string;
  sfuEnableTcp: boolean;
  sfuRtcMaxPort: number;
  sfuRtcMinPort: number;
  stunUrls: string[];
  turnPassword: string;
  turnUrls: string[];
  turnUsername: string;
}

export function parseAppEnv(
  source: Record<string, string | undefined> = process.env,
): AppEnv {
  const parsed = AppEnvSchema.parse(source);

  if (parsed.NODE_ENV === 'production') {
    const insecureDefaults = [
      parsed.ADMIN_PANEL_PASSWORD === DEFAULT_ADMIN_PANEL_PASSWORD
        ? 'ADMIN_PANEL_PASSWORD'
        : null,
      parsed.JWT_ACCESS_SECRET === DEFAULT_JWT_ACCESS_SECRET
        ? 'JWT_ACCESS_SECRET'
        : null,
      parsed.JWT_REFRESH_SECRET === DEFAULT_JWT_REFRESH_SECRET
        ? 'JWT_REFRESH_SECRET'
        : null,
      parsed.MEDIA_INTERNAL_SECRET === DEFAULT_MEDIA_INTERNAL_SECRET
        ? 'MEDIA_INTERNAL_SECRET'
        : null,
    ].filter((value): value is string => value !== null);

    if (insecureDefaults.length > 0) {
      throw new Error(
        `Refusing to start with insecure default secrets in production: ${insecureDefaults.join(', ')}.`,
      );
    }
  }

  if (parsed.SFU_RTC_MIN_PORT > parsed.SFU_RTC_MAX_PORT) {
    throw new Error(
      'SFU_RTC_MIN_PORT must be less than or equal to SFU_RTC_MAX_PORT.',
    );
  }

  // Default internal media URL to loopback + the resolved MEDIA_PORT.
  // This keeps gateway -> media calls working even when only MEDIA_PORT is set.
  const mediaInternalUrl =
    parsed.MEDIA_INTERNAL_URL ?? `http://127.0.0.1:${parsed.MEDIA_PORT}`;

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

function parseUrlList(
  value: z.infer<typeof UrlListSchema> | undefined,
  fallback: string[],
) {
  if (value === undefined) {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }
  return parseIceServerUrls(value);
}

export function normalizeMediaRegionHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(
      trimmed.includes('://') ? trimmed : `https://${trimmed}`,
    );
    return url.hostname.replace(/\.$/, '');
  } catch {
    return trimmed.split('/')[0]?.split(':')[0]?.replace(/\.$/, '') ?? '';
  }
}

export function getDefaultMediaRegionProfile(env: AppEnv): MediaRegionProfile {
  const iceConfig = getIceConfig(env);
  return {
    hosts: [],
    id: 'default',
    sfuAnnouncedIp: env.SFU_ANNOUNCED_IP,
    sfuEnableTcp: env.SFU_ENABLE_TCP,
    sfuRtcMaxPort: env.SFU_RTC_MAX_PORT,
    sfuRtcMinPort: env.SFU_RTC_MIN_PORT,
    stunUrls: iceConfig.stunUrls,
    turnPassword: iceConfig.turnPassword,
    turnUrls: iceConfig.turnUrls,
    turnUsername: iceConfig.turnUsername,
  };
}

export function parseMediaRegionProfiles(env: AppEnv): MediaRegionProfile[] {
  const raw = env.MEDIA_REGION_PROFILES.trim();
  if (!raw) {
    return [];
  }

  const parsed = z.array(MediaRegionProfileInputSchema).parse(JSON.parse(raw));
  const fallback = getDefaultMediaRegionProfile(env);
  const seenIds = new Set<string>();
  const seenHosts = new Set<string>();

  return parsed.map((profile) => {
    if (seenIds.has(profile.id)) {
      throw new Error(`Duplicate media region profile id: ${profile.id}`);
    }
    seenIds.add(profile.id);

    const hosts = profile.hosts.map(normalizeMediaRegionHost).filter(Boolean);
    for (const host of hosts) {
      if (seenHosts.has(host)) {
        throw new Error(`Duplicate media region profile host: ${host}`);
      }
      seenHosts.add(host);
    }

    const sfuRtcMinPort = profile.sfuRtcMinPort ?? fallback.sfuRtcMinPort;
    const sfuRtcMaxPort = profile.sfuRtcMaxPort ?? fallback.sfuRtcMaxPort;
    if (sfuRtcMinPort > sfuRtcMaxPort) {
      throw new Error(
        `Media region profile ${profile.id} has an invalid SFU RTC port range.`,
      );
    }

    return {
      hosts,
      id: profile.id,
      sfuAnnouncedIp: profile.sfuAnnouncedIp || fallback.sfuAnnouncedIp,
      sfuEnableTcp: profile.sfuEnableTcp ?? fallback.sfuEnableTcp,
      sfuRtcMaxPort,
      sfuRtcMinPort,
      stunUrls: parseUrlList(profile.stunUrls, fallback.stunUrls),
      turnPassword: profile.turnPassword ?? fallback.turnPassword,
      turnUrls: parseUrlList(profile.turnUrls, fallback.turnUrls),
      turnUsername: profile.turnUsername ?? fallback.turnUsername,
    };
  });
}

export function resolveMediaRegionProfileById(
  profiles: MediaRegionProfile[],
  mediaRegionId: string | null | undefined,
): MediaRegionProfile | null {
  if (!mediaRegionId) {
    return null;
  }
  return profiles.find((profile) => profile.id === mediaRegionId) ?? null;
}

export function resolveMediaRegionProfileForHosts(
  profiles: MediaRegionProfile[],
  hosts: string[],
): MediaRegionProfile | null {
  const normalizedHosts = hosts.map(normalizeMediaRegionHost).filter(Boolean);

  for (const profile of profiles) {
    if (profile.hosts.some((host) => normalizedHosts.includes(host))) {
      return profile;
    }
  }

  return null;
}

export function getIceConfig(env: AppEnv) {
  return {
    stunUrls: parseIceServerUrls(env.STUN_URLS),
    turnPassword: env.TURN_PASSWORD,
    turnUrls: parseIceServerUrls(env.TURN_URLS),
    turnUsername: env.TURN_USERNAME,
  };
}
