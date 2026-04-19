import { z } from 'zod';

import { AdminCreateUserRequestSchema, AuthUserSchema } from './auth';
import { ChannelSummarySchema } from './guild';

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

export const AdminServerSettingsSchema = PublicServerConfigSchema;

export const AdminWorkspaceStateSchema = z.object({
  channels: z.array(ChannelSummarySchema),
  guildId: z.string().uuid().nullable(),
  serverName: z.string().min(1).max(100),
});

export const AdminUpdateSettingsRequestSchema = z.object({
  adminPassword: z.string().min(1).max(128).optional(),
  allowPublicRegistration: z.boolean().optional(),
  appPort: z.number().int().min(1).max(65535).optional(),
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
export type AdminServerSettings = z.infer<typeof AdminServerSettingsSchema>;
export type AdminWorkspaceState = z.infer<typeof AdminWorkspaceStateSchema>;
export type AdminUpdateSettingsRequest = z.infer<typeof AdminUpdateSettingsRequestSchema>;
export type AdminCreateChannelRequest = z.infer<typeof AdminCreateChannelRequestSchema>;
export type AdminUpdateChannelRequest = z.infer<typeof AdminUpdateChannelRequestSchema>;
export type AdminCreateUserResponse = z.infer<typeof AdminCreateUserResponseSchema>;
