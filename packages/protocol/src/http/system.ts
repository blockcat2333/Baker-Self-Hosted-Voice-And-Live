import { z } from 'zod';

import { AdminCreateUserRequestSchema, AuthUserSchema } from './auth';
import { ChannelSummarySchema } from './guild';
import { MediaTransportModeSchema } from '../media/signaling';

export const ServiceNameSchema = z.enum([
  'api',
  'gateway',
  'media',
  'web',
  'desktop',
]);

export const HealthResponseSchema = z.object({
  service: ServiceNameSchema,
  status: z.enum(['ok']),
  timestamp: z.string().datetime(),
  version: z.string().min(1),
});

export const ServiceManifestItemSchema = z.object({
  description: z.string().min(1),
  name: ServiceNameSchema,
  url: z.string().min(1),
});

export const ServiceManifestSchema = z.object({
  generatedAt: z.string().datetime(),
  services: z.array(ServiceManifestItemSchema),
});

export const PublicServerConfigSchema = z.object({
  allowPublicRegistration: z.boolean(),
  appPort: z.number().int().min(1).max(65535),
  mediaMode: MediaTransportModeSchema.default('p2p'),
  serverName: z.string().min(1).max(100),
  webEnabled: z.boolean(),
  webPort: z.number().int().min(1).max(65535),
});

export const AdminVerifyPasswordRequestSchema = z.object({
  password: z.string().min(1).max(128),
});

export const AdminVerifyPasswordResponseSchema = z.object({
  ok: z.literal(true),
});

export const AdminDeleteChannelResponseSchema = z.object({
  ok: z.literal(true),
});

export const AdminServerSettingsSchema = PublicServerConfigSchema;

export const AdminUpdateVersionSchema = z.object({
  digest: z.string().nullable(),
  image: z.string().min(1),
  isLatest: z.boolean(),
  publishedAt: z.string().datetime().nullable(),
  releaseNotes: z.string().nullable(),
  releaseUrl: z.string().url().nullable(),
  tag: z.string().min(1),
});

export const AdminUpdateVersionsResponseSchema = z.object({
  currentImage: z.string().nullable(),
  currentVersion: z.string().min(1),
  dockerEnabled: z.boolean(),
  dockerStatus: z.string().nullable(),
  repository: z.string().min(1),
  versions: z.array(AdminUpdateVersionSchema),
});

function isHttpProxyUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const AdminUpdateProxySettingsSchema = z.object({
  enabled: z.boolean(),
  proxyUrl: z.string().max(2048),
  updatedAt: z.string().datetime(),
});

export const AdminUpdateProxySettingsRequestSchema = z
  .object({
    enabled: z.boolean(),
    proxyUrl: z.string().trim().max(2048),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && !value.proxyUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Proxy URL is required when update proxy is enabled.',
        path: ['proxyUrl'],
      });
      return;
    }

    if (value.proxyUrl && !isHttpProxyUrl(value.proxyUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Proxy URL must use http:// or https://.',
        path: ['proxyUrl'],
      });
    }
  });

export const AdminApplyUpdateRequestSchema = z.object({
  tag: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.-]+$/),
});

export const AdminUpdateJobStatusSchema = z.object({
  completedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  jobId: z.string().nullable(),
  message: z.string().min(1),
  phase: z.string().min(1),
  startedAt: z.string().datetime().nullable(),
  status: z.enum(['idle', 'running', 'succeeded', 'failed']),
  targetImage: z.string().nullable(),
  targetTag: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const AdminRuntimeManagedServiceNameSchema = z.enum([
  'postgres',
  'redis',
  'media',
  'api',
  'gateway',
  'caddy',
  'turn',
]);

export const AdminRuntimeOverallStatusSchema = z.enum([
  'healthy',
  'degraded',
  'repairing',
  'unknown',
]);
export const AdminRuntimeServiceStatusSchema = z.enum([
  'healthy',
  'degraded',
  'stopped',
  'disabled',
  'repairing',
  'unknown',
]);

export const AdminRuntimeProbeSchema = z.object({
  checked: z.boolean(),
  error: z.string().nullable(),
  ok: z.boolean().nullable(),
  responseTimeMs: z.number().int().nonnegative().nullable(),
});

export const AdminRuntimeSupervisorStatusSchema = z.object({
  available: z.boolean(),
  detail: z.string().nullable(),
  state: z.string().nullable(),
});

export const AdminRuntimeServiceHealthSchema = z.object({
  label: z.string().min(1),
  message: z.string().min(1),
  name: AdminRuntimeManagedServiceNameSchema,
  probe: AdminRuntimeProbeSchema,
  required: z.boolean(),
  status: AdminRuntimeServiceStatusSchema,
  supervisor: AdminRuntimeSupervisorStatusSchema,
});

export const AdminRuntimeRepairActionSchema = z.object({
  action: z.string().min(1),
  finishedAt: z.string().datetime(),
  message: z.string().min(1),
  service: AdminRuntimeManagedServiceNameSchema,
  startedAt: z.string().datetime(),
  status: z.enum(['succeeded', 'failed', 'skipped']),
});

export const AdminRuntimeRepairResultSchema = z.object({
  actions: z.array(AdminRuntimeRepairActionSchema),
  completedAt: z.string().datetime(),
  containerRepairStarted: z.boolean(),
  message: z.string().min(1),
  startedAt: z.string().datetime(),
  status: z.enum(['succeeded', 'failed', 'partial', 'skipped']),
  trigger: z.enum(['manual', 'self']),
});

export const AdminRuntimeHealthSchema = z.object({
  checkedAt: z.string().datetime(),
  dockerEnabled: z.boolean(),
  dockerStatus: z.string().nullable(),
  lastRepair: AdminRuntimeRepairResultSchema.nullable(),
  overallStatus: AdminRuntimeOverallStatusSchema,
  repairInProgress: z.boolean(),
  services: z.array(AdminRuntimeServiceHealthSchema),
  supervisorAvailable: z.boolean(),
});

export const AdminRuntimeRepairRequestSchema = z.object({
  allowContainerRepair: z.boolean().optional(),
});

export const AdminRuntimeSelfRepairSettingsSchema = z.object({
  allowContainerRepair: z.boolean(),
  enabled: z.boolean(),
  intervalSeconds: z.number().int().min(30).max(86_400),
  updatedAt: z.string().datetime(),
});

export const AdminUpdateRuntimeSelfRepairSettingsRequestSchema = z.object({
  allowContainerRepair: z.boolean().optional(),
  enabled: z.boolean().optional(),
  intervalSeconds: z.number().int().min(30).max(86_400).optional(),
});

export const AdminRuntimePublicIpSettingsSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.number().int().min(60).max(86_400),
  lastAppliedAt: z.string().datetime().nullable(),
  lastAppliedIp: z.string().nullable(),
  lastCheckedAt: z.string().datetime().nullable(),
  lastDetectedIp: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export const AdminUpdateRuntimePublicIpSettingsRequestSchema = z.object({
  enabled: z.boolean().optional(),
  intervalSeconds: z.number().int().min(60).max(86_400).optional(),
});

export const AdminRuntimePublicIpCheckResultSchema = z.object({
  applied: z.boolean(),
  changed: z.boolean(),
  restartedServices: z.array(AdminRuntimeManagedServiceNameSchema),
  settings: AdminRuntimePublicIpSettingsSchema,
});

export const AdminDeploymentSettingsSchema = z.object({
  adminHostPort: z.number().int().min(1).max(65535),
  allowedHosts: z.string(),
  currentContainerName: z.string().nullable(),
  currentImage: z.string().nullable(),
  dockerEnabled: z.boolean(),
  dockerStatus: z.string().nullable(),
  pendingApply: z.boolean(),
  sfuAnnouncedIp: z.string(),
  sfuEnableTcp: z.boolean(),
  sfuRtcMaxPort: z.number().int().min(1).max(65535),
  sfuRtcMinPort: z.number().int().min(1).max(65535),
  stunUrls: z.string(),
  turnEnabled: z.boolean(),
  turnExternalIp: z.string(),
  turnMaxPort: z.number().int().min(1).max(65535),
  turnMinPort: z.number().int().min(1).max(65535),
  turnPasswordConfigured: z.boolean(),
  turnPort: z.number().int().min(1).max(65535),
  turnRealm: z.string(),
  turnUrls: z.string(),
  turnUsername: z.string(),
  webHostPort: z.number().int().min(1).max(65535),
});

export const AdminUpdateDeploymentSettingsRequestSchema = z.object({
  adminHostPort: z.number().int().min(1).max(65535).optional(),
  allowedHosts: z.string().max(1000).optional(),
  sfuAnnouncedIp: z.string().max(255).optional(),
  sfuEnableTcp: z.boolean().optional(),
  sfuRtcMaxPort: z.number().int().min(1).max(65535).optional(),
  sfuRtcMinPort: z.number().int().min(1).max(65535).optional(),
  stunUrls: z.string().max(2000).optional(),
  turnEnabled: z.boolean().optional(),
  turnExternalIp: z.string().max(255).optional(),
  turnMaxPort: z.number().int().min(1).max(65535).optional(),
  turnMinPort: z.number().int().min(1).max(65535).optional(),
  turnPassword: z.string().max(256).optional(),
  turnPort: z.number().int().min(1).max(65535).optional(),
  turnRealm: z.string().max(255).optional(),
  turnUrls: z.string().max(2000).optional(),
  turnUsername: z.string().max(255).optional(),
  webHostPort: z.number().int().min(1).max(65535).optional(),
});

export const AdminWorkspaceStateSchema = z.object({
  channels: z.array(ChannelSummarySchema),
  guildId: z.string().uuid().nullable(),
  serverName: z.string().min(1).max(100),
});

export const AdminUpdateSettingsRequestSchema = z.object({
  adminPassword: z.string().min(1).max(128).optional(),
  allowPublicRegistration: z.boolean().optional(),
  appPort: z.number().int().min(1).max(65535).optional(),
  mediaMode: MediaTransportModeSchema.optional(),
  serverName: z.string().min(1).max(100).optional(),
  webEnabled: z.boolean().optional(),
  webPort: z.number().int().min(1).max(65535).optional(),
});

export const AdminCreateChannelRequestSchema = z.object({
  name: z.string().min(1).max(100),
  type: ChannelSummarySchema.shape.type,
  voiceQuality: ChannelSummarySchema.shape.voiceQuality.optional(),
});

export const AdminUpdateChannelRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  voiceQuality: ChannelSummarySchema.shape.voiceQuality.optional(),
});

export const AdminCreateUserResponseSchema = AuthUserSchema;
export const AdminCreateUserPayloadSchema = AdminCreateUserRequestSchema;

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ServiceManifest = z.infer<typeof ServiceManifestSchema>;
export type ServiceName = z.infer<typeof ServiceNameSchema>;
export type PublicServerConfig = z.infer<typeof PublicServerConfigSchema>;
export type AdminVerifyPasswordRequest = z.infer<
  typeof AdminVerifyPasswordRequestSchema
>;
export type AdminVerifyPasswordResponse = z.infer<
  typeof AdminVerifyPasswordResponseSchema
>;
export type AdminDeleteChannelResponse = z.infer<
  typeof AdminDeleteChannelResponseSchema
>;
export type AdminServerSettings = z.infer<typeof AdminServerSettingsSchema>;
export type AdminUpdateVersion = z.infer<typeof AdminUpdateVersionSchema>;
export type AdminUpdateVersionsResponse = z.infer<
  typeof AdminUpdateVersionsResponseSchema
>;
export type AdminUpdateProxySettings = z.infer<
  typeof AdminUpdateProxySettingsSchema
>;
export type AdminUpdateProxySettingsRequest = z.infer<
  typeof AdminUpdateProxySettingsRequestSchema
>;
export type AdminApplyUpdateRequest = z.infer<
  typeof AdminApplyUpdateRequestSchema
>;
export type AdminUpdateJobStatus = z.infer<typeof AdminUpdateJobStatusSchema>;
export type AdminRuntimeManagedServiceName = z.infer<
  typeof AdminRuntimeManagedServiceNameSchema
>;
export type AdminRuntimeOverallStatus = z.infer<
  typeof AdminRuntimeOverallStatusSchema
>;
export type AdminRuntimeServiceStatus = z.infer<
  typeof AdminRuntimeServiceStatusSchema
>;
export type AdminRuntimeProbe = z.infer<typeof AdminRuntimeProbeSchema>;
export type AdminRuntimeSupervisorStatus = z.infer<
  typeof AdminRuntimeSupervisorStatusSchema
>;
export type AdminRuntimeServiceHealth = z.infer<
  typeof AdminRuntimeServiceHealthSchema
>;
export type AdminRuntimeRepairAction = z.infer<
  typeof AdminRuntimeRepairActionSchema
>;
export type AdminRuntimeRepairResult = z.infer<
  typeof AdminRuntimeRepairResultSchema
>;
export type AdminRuntimeHealth = z.infer<typeof AdminRuntimeHealthSchema>;
export type AdminRuntimeRepairRequest = z.infer<
  typeof AdminRuntimeRepairRequestSchema
>;
export type AdminRuntimeSelfRepairSettings = z.infer<
  typeof AdminRuntimeSelfRepairSettingsSchema
>;
export type AdminUpdateRuntimeSelfRepairSettingsRequest = z.infer<
  typeof AdminUpdateRuntimeSelfRepairSettingsRequestSchema
>;
export type AdminRuntimePublicIpSettings = z.infer<
  typeof AdminRuntimePublicIpSettingsSchema
>;
export type AdminUpdateRuntimePublicIpSettingsRequest = z.infer<
  typeof AdminUpdateRuntimePublicIpSettingsRequestSchema
>;
export type AdminRuntimePublicIpCheckResult = z.infer<
  typeof AdminRuntimePublicIpCheckResultSchema
>;
export type AdminDeploymentSettings = z.infer<
  typeof AdminDeploymentSettingsSchema
>;
export type AdminUpdateDeploymentSettingsRequest = z.infer<
  typeof AdminUpdateDeploymentSettingsRequestSchema
>;
export type AdminWorkspaceState = z.infer<typeof AdminWorkspaceStateSchema>;
export type AdminUpdateSettingsRequest = z.infer<
  typeof AdminUpdateSettingsRequestSchema
>;
export type AdminCreateChannelRequest = z.infer<
  typeof AdminCreateChannelRequestSchema
>;
export type AdminUpdateChannelRequest = z.infer<
  typeof AdminUpdateChannelRequestSchema
>;
export type AdminCreateUserResponse = z.infer<
  typeof AdminCreateUserResponseSchema
>;
