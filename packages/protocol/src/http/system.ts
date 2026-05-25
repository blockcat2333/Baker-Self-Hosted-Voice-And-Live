import { z } from 'zod';

import { AdminCreateUserRequestSchema, AuthUserSchema } from './auth';
import { ChannelSummarySchema } from './guild';
import { MediaTransportModeSchema } from '../media/signaling';

export const ServiceNameSchema = z.enum(['api', 'gateway', 'media', 'web', 'desktop']);

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

export const AdminApplyUpdateRequestSchema = z.object({
  tag: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.-]+$/),
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
export type AdminVerifyPasswordRequest = z.infer<typeof AdminVerifyPasswordRequestSchema>;
export type AdminVerifyPasswordResponse = z.infer<typeof AdminVerifyPasswordResponseSchema>;
export type AdminDeleteChannelResponse = z.infer<typeof AdminDeleteChannelResponseSchema>;
export type AdminServerSettings = z.infer<typeof AdminServerSettingsSchema>;
export type AdminUpdateVersion = z.infer<typeof AdminUpdateVersionSchema>;
export type AdminUpdateVersionsResponse = z.infer<typeof AdminUpdateVersionsResponseSchema>;
export type AdminApplyUpdateRequest = z.infer<typeof AdminApplyUpdateRequestSchema>;
export type AdminUpdateJobStatus = z.infer<typeof AdminUpdateJobStatusSchema>;
export type AdminDeploymentSettings = z.infer<typeof AdminDeploymentSettingsSchema>;
export type AdminUpdateDeploymentSettingsRequest = z.infer<typeof AdminUpdateDeploymentSettingsRequestSchema>;
export type AdminWorkspaceState = z.infer<typeof AdminWorkspaceStateSchema>;
export type AdminUpdateSettingsRequest = z.infer<typeof AdminUpdateSettingsRequestSchema>;
export type AdminCreateChannelRequest = z.infer<typeof AdminCreateChannelRequestSchema>;
export type AdminUpdateChannelRequest = z.infer<typeof AdminUpdateChannelRequestSchema>;
export type AdminCreateUserResponse = z.infer<typeof AdminCreateUserResponseSchema>;
