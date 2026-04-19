import { z } from 'zod';

export const MediaSignalTypeSchema = z.enum(['answer', 'end', 'ice_candidate', 'offer', 'restart_ice']);

export const SessionModeSchema = z.enum(['stream_publish', 'stream_watch', 'voice']);

export const MediaSessionDescriptorSchema = z.object({
  channelId: z.string().uuid(),
  mode: SessionModeSchema,
  sessionId: z.string().uuid(),
  streamId: z.string().uuid().optional(),
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

export type IceServer = z.infer<typeof IceServerSchema>;
export type MediaCapabilities = z.infer<typeof MediaCapabilitiesSchema>;
export type MediaSessionDescriptor = z.infer<typeof MediaSessionDescriptorSchema>;
export type MediaSessionResponse = z.infer<typeof MediaSessionResponseSchema>;
export type MediaSignalCommandData = z.infer<typeof MediaSignalCommandDataSchema>;
export type MediaSignalPayload = z.infer<typeof MediaSignalPayloadSchema>;
export type MediaSignalRelayEventData = z.infer<typeof MediaSignalRelayEventDataSchema>;
export type SessionMode = z.infer<typeof SessionModeSchema>;
