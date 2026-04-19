import { z } from 'zod';

export const ChannelTypeSchema = z.enum(['text', 'voice']);
export const VoiceQualitySchema = z.enum(['high', 'standard']);

export const GuildSummarySchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  ownerUserId: z.string().uuid(),
});

export const ChannelSummarySchema = z.object({
  guildId: z.string().uuid(),
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  position: z.number().int().nonnegative(),
  topic: z.string().nullable(),
  type: ChannelTypeSchema,
  voiceQuality: VoiceQualitySchema,
});

export const GuildListResponseSchema = z.array(GuildSummarySchema);
export const ChannelListResponseSchema = z.array(ChannelSummarySchema);

export type ChannelSummary = z.infer<typeof ChannelSummarySchema>;
export type ChannelType = z.infer<typeof ChannelTypeSchema>;
export type GuildSummary = z.infer<typeof GuildSummarySchema>;
export type VoiceQuality = z.infer<typeof VoiceQualitySchema>;
