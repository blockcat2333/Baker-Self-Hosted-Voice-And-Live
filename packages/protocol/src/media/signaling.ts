import { z } from 'zod';

const JsonObjectSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
);

export const MediaTransportModeSchema = z.enum(['p2p', 'sfu']);

export const MediaSignalTypeSchema = z.enum(['answer', 'end', 'ice_candidate', 'offer', 'restart_ice']);

export const SessionModeSchema = z.enum(['music_listen', 'music_publish', 'stream_publish', 'stream_watch', 'voice']);

export const MediaSessionDescriptorSchema = z.object({
  channelId: z.string().uuid(),
  mediaRegionId: z.string().min(1).optional(),
  mode: SessionModeSchema,
  sessionId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
  transportMode: MediaTransportModeSchema.default('p2p'),
  userId: z.string().uuid(),
});

export const IceCandidatePayloadSchema = z.object({
  candidate: z.string().min(1),
  sdpMLineIndex: z.number().int().nonnegative().nullable(),
  sdpMid: z.string().nullable(),
});

export const MediaSignalPayloadSchema = z.object({
  candidate: IceCandidatePayloadSchema.optional(),
  sdp: z.string().optional(),
  session: MediaSessionDescriptorSchema,
  type: MediaSignalTypeSchema,
});

export const MediaCapabilitiesSchema = z.object({
  deviceSwitch: z.boolean(),
  metrics: z.boolean(),
  simulcast: z.boolean(),
  speakerSelection: z.boolean(),
  sfu: z.object({
    available: z.boolean(),
    configured: z.boolean(),
    requiredAnnouncedIp: z.boolean(),
  }).optional(),
});

/**
 * RTCIceServer-compatible shape. Both `urls` forms (string or string[]) are
 * valid per the WebRTC spec; we accept both.
 */
export const IceServerSchema = z.object({
  credential: z.string().optional(),
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
});

/**
 * Response from POST /v1/internal/media/sessions.
 * Carries only the session-level data; the gateway appends participants
 * and channelId before sending the voice.join ack to the client.
 */
export const MediaSessionResponseSchema = z.object({
  iceServers: z.array(IceServerSchema),
  sessionId: z.string().uuid(),
  sfu: z.object({
    producers: z.array(z.object({
      channelId: z.string().uuid(),
      id: z.string().min(1),
      kind: z.enum(['audio', 'video']),
      sessionId: z.string().uuid(),
      source: z.enum(['music', 'stream', 'voice']),
      streamId: z.string().uuid().optional(),
      userId: z.string().uuid(),
    })),
    routerRtpCapabilities: JsonObjectSchema,
  }).optional(),
});

/**
 * Data shape for media.signal.* commands sent by the client.
 * targetUserId tells the gateway which connection to relay to.
 */
export const MediaSignalCommandDataSchema = z.object({
  signal: MediaSignalPayloadSchema,
  targetUserId: z.string().uuid(),
});

/**
 * Event data sent by the gateway to the relay target.
 * fromUserId identifies the sender so the receiver can address its reply.
 */
export const MediaSignalRelayEventDataSchema = z.object({
  fromUserId: z.string().uuid(),
  signal: MediaSignalPayloadSchema,
});

export const SfuTransportDirectionSchema = z.enum(['recv', 'send']);

export const SfuProducerSourceSchema = z.enum(['music', 'stream', 'voice']);

export const SfuProducerSchema = z.object({
  channelId: z.string().uuid(),
  id: z.string().min(1),
  kind: z.enum(['audio', 'video']),
  sessionId: z.string().uuid(),
  source: SfuProducerSourceSchema,
  streamId: z.string().uuid().optional(),
  userId: z.string().uuid(),
});

export const SfuSessionInfoSchema = z.object({
  producers: z.array(SfuProducerSchema),
  routerRtpCapabilities: JsonObjectSchema,
});

export const SfuSessionDescriptorSchema = z.object({
  channelId: z.string().uuid(),
  mode: SessionModeSchema,
  sessionId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
});

export const MediaSfuCreateTransportCommandDataSchema = SfuSessionDescriptorSchema.extend({
  direction: SfuTransportDirectionSchema,
});

export const MediaSfuCreateTransportAckDataSchema = z.object({
  direction: SfuTransportDirectionSchema,
  transportOptions: z.object({
    dtlsParameters: JsonObjectSchema,
    iceCandidates: z.array(JsonObjectSchema),
    iceParameters: JsonObjectSchema,
    id: z.string().min(1),
    sctpParameters: JsonObjectSchema.optional(),
  }),
});

export const MediaSfuConnectTransportCommandDataSchema = SfuSessionDescriptorSchema.extend({
  dtlsParameters: JsonObjectSchema,
  transportId: z.string().min(1),
});

export const MediaSfuProduceCommandDataSchema = SfuSessionDescriptorSchema.extend({
  appData: JsonObjectSchema.optional(),
  kind: z.enum(['audio', 'video']),
  rtpParameters: JsonObjectSchema,
  transportId: z.string().min(1),
});

export const MediaSfuProduceAckDataSchema = z.object({
  producer: SfuProducerSchema,
  producerId: z.string().min(1),
});

export const MediaSfuConsumeCommandDataSchema = SfuSessionDescriptorSchema.extend({
  producerId: z.string().min(1),
  rtpCapabilities: JsonObjectSchema,
  transportId: z.string().min(1),
});

export const MediaSfuConsumeAckDataSchema = z.object({
  consumerId: z.string().min(1),
  id: z.string().min(1),
  kind: z.enum(['audio', 'video']),
  producerId: z.string().min(1),
  producerPaused: z.boolean(),
  rtpParameters: JsonObjectSchema,
  type: z.string().min(1),
});

export const MediaSfuResumeConsumerCommandDataSchema = SfuSessionDescriptorSchema.extend({
  consumerId: z.string().min(1),
});

export const MediaSfuCloseCommandDataSchema = SfuSessionDescriptorSchema.extend({
  consumerId: z.string().min(1).optional(),
  producerId: z.string().min(1).optional(),
  transportId: z.string().min(1).optional(),
});

export const MediaSfuProducerEventDataSchema = z.object({
  producer: SfuProducerSchema,
});

export const MediaModeUpdatedEventDataSchema = z.object({
  affectedChannelIds: z.array(z.string().uuid()),
  mediaMode: MediaTransportModeSchema,
  reason: z.enum(['admin_changed']),
});

export type IceServer = z.infer<typeof IceServerSchema>;
export type MediaCapabilities = z.infer<typeof MediaCapabilitiesSchema>;
export type MediaModeUpdatedEventData = z.infer<typeof MediaModeUpdatedEventDataSchema>;
export type MediaTransportMode = z.infer<typeof MediaTransportModeSchema>;
export type MediaSessionDescriptor = z.infer<typeof MediaSessionDescriptorSchema>;
export type MediaSessionResponse = z.infer<typeof MediaSessionResponseSchema>;
export type MediaSignalCommandData = z.infer<typeof MediaSignalCommandDataSchema>;
export type MediaSignalPayload = z.infer<typeof MediaSignalPayloadSchema>;
export type MediaSignalRelayEventData = z.infer<typeof MediaSignalRelayEventDataSchema>;
export type MediaSfuConsumeAckData = z.infer<typeof MediaSfuConsumeAckDataSchema>;
export type MediaSfuCreateTransportAckData = z.infer<typeof MediaSfuCreateTransportAckDataSchema>;
export type MediaSfuProducerEventData = z.infer<typeof MediaSfuProducerEventDataSchema>;
export type MediaSfuProduceAckData = z.infer<typeof MediaSfuProduceAckDataSchema>;
export type SessionMode = z.infer<typeof SessionModeSchema>;
export type SfuProducer = z.infer<typeof SfuProducerSchema>;
export type SfuSessionInfo = z.infer<typeof SfuSessionInfoSchema>;
