/**
 * WebRtcManager manages per-peer RTCPeerConnections for a voice session.
 *
 * One entry per remote userId. The manager does not open or close connections
 * on its own — callers drive the offer/answer/ICE flow and call closeAll()
 * on teardown.
 *
 * All RTCPeerConnection construction is done through the `createPeerConnection`
 * factory so tests can inject stubs without touching global RTCPeerConnection.
 */

import type { IceServer } from '@baker/protocol';
import { configureAudioReceiver, summarizeAudioReceiveStats, updateAudioPlayout, type AudioPlayoutHealth } from './audio-playout';

export interface WebRtcManagerCallbacks {
  /**
   * Called when the local ICE agent produces a candidate that should be
   * relayed to the remote peer via the signaling channel.
   */
  onLocalIceCandidate(targetUserId: string, candidate: RTCIceCandidate): void;
  /**
   * Called when a remote track arrives. `streams` contains the MediaStream(s)
   * the track belongs to.
   */
  onRemoteTrack(fromUserId: string, track: MediaStreamTrack, streams: readonly MediaStream[]): void;
  /**
   * Called when a peer connection's overall connection state changes.
   * State is one of: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'.
   */
  onPeerConnectionStateChange(userId: string, state: RTCPeerConnectionState): void;
}

export type PeerConnectionFactory = (iceServers: RTCIceServer[]) => RTCPeerConnection;
export interface CreateOfferOptions {
  degradationPreference?: RTCDegradationPreference;
  maxVideoBitrateKbps?: number;
  maxVideoFramerate?: number;
  preferredVideoCodec?: VideoCodecPreference;
}

function defaultFactory(iceServers: RTCIceServer[]): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers });
}

export type PeerNetworkSample = {
  rttMs: number | null;
  packetsLost: number | null;
  packetsReceived: number | null;
};

export type LocalOutboundNetworkSample = {
  packetsLost: number | null;
  packetsSent: number | null;
  feedbackTimestampMs?: number | null;
};

export type PeerVideoReceiveSample = {
  availableIncomingBitrateKbps: number | null;
  bytesReceived: number | null;
  codec: string | null;
  decoderAcceleration: 'hardware' | 'software' | 'unknown';
  decoderImplementation: string | null;
  frameHeight: number | null;
  frameWidth: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  framesReceived: number | null;
  framesPerSecond: number | null;
  freezeCount: number | null;
  jitterMs: number | null;
  jitterBufferDelayMs: number | null;
  keyFramesDecoded: number | null;
  nackCount: number | null;
  packetsLost: number | null;
  packetsReceived: number | null;
  pliCount: number | null;
  timestampMs: number | null;
  totalDecodeTimeMs: number | null;
  totalFreezesDurationMs: number | null;
  transportProtocol: 'tcp' | 'udp' | 'unknown' | null;
  localCandidateType: 'host' | 'prflx' | 'relay' | 'srflx' | 'unknown' | null;
  remoteCandidateType: 'host' | 'prflx' | 'relay' | 'srflx' | 'unknown' | null;
};

export type VideoCodecPreference = 'default' | 'h264' | 'vp8' | 'vp9' | 'av1';

type CodecCapabilityLike = {
  mimeType?: string;
} & Record<string, unknown>;

export type AggregatePeerVideoSendSample = {
  activePeerCount: number;
  availableOutgoingBitrateKbps: number | null;
  bytesSent: number | null;
  codec: string | null;
  encoderAcceleration: 'hardware' | 'software' | 'unknown';
  encoderImplementation: string | null;
  frameHeight: number | null;
  frameWidth: number | null;
  framesEncoded: number | null;
  framesPerSecond: number | null;
  packetsSent: number | null;
  packetsLost: number | null;
  qualityLimitationReason: 'bandwidth' | 'cpu' | 'none' | 'other';
  retransmittedPacketsSent: number | null;
  roundTripTimeMs: number | null;
  targetBitrateKbps: number | null;
  timestampMs: number | null;
  totalEncodeTimeMs: number | null;
  transportProtocol: 'tcp' | 'udp' | 'unknown' | null;
  localCandidateType: 'host' | 'prflx' | 'relay' | 'srflx' | 'unknown' | null;
  remoteCandidateType: 'host' | 'prflx' | 'relay' | 'srflx' | 'unknown' | null;
};

function readNumberField(record: RTCStats, key: string): number | null {
  const value = (record as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringField(record: RTCStats, key: string): string | null {
  const value = (record as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function readCodecLabel(record: RTCStats | null): string | null {
  if (!record) {
    return null;
  }

  const mimeType = readStringField(record, 'mimeType');
  if (!mimeType) {
    return null;
  }

  const slashIndex = mimeType.indexOf('/');
  return slashIndex >= 0
    ? mimeType.slice(slashIndex + 1).toUpperCase()
    : mimeType.toUpperCase();
}

function readBooleanField(record: RTCStats, key: string): boolean | null {
  const value = (record as unknown as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

type CandidateType = 'host' | 'prflx' | 'relay' | 'srflx' | 'unknown';
type TransportProtocol = 'tcp' | 'udp' | 'unknown';

function normalizeCandidateType(value: string | null): CandidateType | null {
  return value === 'host' || value === 'prflx' || value === 'relay' || value === 'srflx'
    ? value
    : value
      ? 'unknown'
      : null;
}

function normalizeTransportProtocol(value: string | null): TransportProtocol | null {
  return value === 'tcp' || value === 'udp' ? value : value ? 'unknown' : null;
}

function readSelectedNetworkPath(stats: RTCStats[]) {
  const transport = stats.find((stat) => stat.type === 'transport') ?? null;
  const selectedPairId = transport ? readStringField(transport, 'selectedCandidatePairId') : null;
  const pair =
    (selectedPairId ? stats.find((stat) => stat.id === selectedPairId) : null) ??
    stats.find(
      (stat) =>
        stat.type === 'candidate-pair' &&
        (readBooleanField(stat, 'selected') === true ||
          (readBooleanField(stat, 'nominated') === true && readStringField(stat, 'state') === 'succeeded')),
    ) ??
    null;
  const localCandidateId = pair ? readStringField(pair, 'localCandidateId') : null;
  const remoteCandidateId = pair ? readStringField(pair, 'remoteCandidateId') : null;
  const localCandidate = localCandidateId ? stats.find((stat) => stat.id === localCandidateId) ?? null : null;
  const remoteCandidate = remoteCandidateId ? stats.find((stat) => stat.id === remoteCandidateId) ?? null : null;
  return {
    availableIncomingBitrateKbps:
      pair && readNumberField(pair, 'availableIncomingBitrate') !== null
        ? Math.round((readNumberField(pair, 'availableIncomingBitrate') ?? 0) / 1000)
        : null,
    availableOutgoingBitrateKbps:
      pair && readNumberField(pair, 'availableOutgoingBitrate') !== null
        ? Math.round((readNumberField(pair, 'availableOutgoingBitrate') ?? 0) / 1000)
        : null,
    localCandidateType: normalizeCandidateType(localCandidate ? readStringField(localCandidate, 'candidateType') : null),
    remoteCandidateType: normalizeCandidateType(remoteCandidate ? readStringField(remoteCandidate, 'candidateType') : null),
    transportProtocol: normalizeTransportProtocol(
      (localCandidate ? readStringField(localCandidate, 'protocol') : null) ??
      (pair ? readStringField(pair, 'protocol') : null),
    ),
  };
}

export function summarizeVideoReceiveStats(
  reports: Iterable<RTCStatsReport>,
): PeerVideoReceiveSample | null {
  for (const report of reports) {
    const stats: RTCStats[] = [];
    report.forEach((stat) => stats.push(stat));

    const inboundVideo =
      stats.find((stat) => {
      if (stat.type !== 'inbound-rtp') return false;
        return (
          (readStringField(stat, 'kind') ??
            readStringField(stat, 'mediaType')) === 'video'
        );
    }) ?? null;
    const trackVideo =
      stats.find((stat) => {
      if ((stat.type as string) !== 'track') return false;
        return (
          (readStringField(stat, 'kind') ??
            readStringField(stat, 'mediaType')) === 'video'
        );
    }) ?? null;
    const primary = inboundVideo ?? trackVideo;
    if (!primary) continue;

    const codecId = readStringField(primary, 'codecId');
    const codecStat = codecId
      ? (stats.find((stat) => stat.id === codecId) ?? null)
      : null;
    const dimensions = trackVideo ?? inboundVideo ?? primary;
    const jitter = readNumberField(primary, 'jitter');
    const jitterBufferDelay = readNumberField(primary, 'jitterBufferDelay');
    const jitterBufferEmittedCount = readNumberField(
      primary,
      'jitterBufferEmittedCount',
    );
    const networkPath = readSelectedNetworkPath(stats);

    return {
      availableIncomingBitrateKbps: networkPath.availableIncomingBitrateKbps,
      bytesReceived: readNumberField(primary, 'bytesReceived'),
      codec: readCodecLabel(codecStat) ?? readCodecLabel(primary),
      decoderAcceleration:
        readBooleanField(primary, 'powerEfficientDecoder') === true
          ? 'hardware'
          : readBooleanField(primary, 'powerEfficientDecoder') === false
            ? 'software'
            : 'unknown',
      decoderImplementation: readStringField(primary, 'decoderImplementation'),
      frameHeight: readNumberField(dimensions, 'frameHeight'),
      frameWidth: readNumberField(dimensions, 'frameWidth'),
      framesDecoded: readNumberField(primary, 'framesDecoded'),
      framesDropped:
        readNumberField(dimensions, 'framesDropped') ??
        readNumberField(primary, 'framesDropped'),
      framesReceived: readNumberField(primary, 'framesReceived'),
      framesPerSecond:
        readNumberField(dimensions, 'framesPerSecond') ??
        readNumberField(primary, 'framesPerSecond'),
      freezeCount: readNumberField(primary, 'freezeCount'),
      jitterMs: jitter === null ? null : Math.round(jitter * 1000),
      jitterBufferDelayMs:
        jitterBufferDelay === null || !jitterBufferEmittedCount
          ? null
          : Math.round((jitterBufferDelay / jitterBufferEmittedCount) * 1000),
      keyFramesDecoded: readNumberField(primary, 'keyFramesDecoded'),
      nackCount: readNumberField(primary, 'nackCount'),
      packetsLost: readNumberField(primary, 'packetsLost'),
      packetsReceived: readNumberField(primary, 'packetsReceived'),
      pliCount: readNumberField(primary, 'pliCount'),
      timestampMs: Number.isFinite(primary.timestamp)
        ? Math.round(primary.timestamp)
        : null,
      totalDecodeTimeMs:
        readNumberField(primary, 'totalDecodeTime') === null
          ? null
          : Math.round(
              (readNumberField(primary, 'totalDecodeTime') ?? 0) * 1000,
            ),
      totalFreezesDurationMs:
        readNumberField(primary, 'totalFreezesDuration') === null
          ? null
          : Math.round(
              (readNumberField(primary, 'totalFreezesDuration') ?? 0) * 1000,
            ),
      transportProtocol: networkPath.transportProtocol,
      localCandidateType: networkPath.localCandidateType,
      remoteCandidateType: networkPath.remoteCandidateType,
    };
  }

  return null;
}

export function summarizeAggregateVideoSendStats(
  reports: Iterable<RTCStatsReport>,
): AggregatePeerVideoSendSample | null {
  let activePeerCount = 0;
  let totalBytesSent = 0;
  let totalFramesEncoded = 0;
  let totalPacketsSent = 0;
  let totalFramesPerSecond = 0;
  let codec: string | null = null;
  let frameRateSampleCount = 0;
  let maxFrameWidth: number | null = null;
  let maxFrameHeight: number | null = null;
  let latestTimestampMs: number | null = null;
  let hasBytesSent = false;
  let hasFramesEncoded = false;
  let hasPacketsSent = false;
  let totalPacketsLost = 0;
  let totalRetransmittedPacketsSent = 0;
  let hasPacketsLost = false;
  let hasRetransmittedPacketsSent = false;
  let maxRoundTripTimeMs: number | null = null;
  let minAvailableOutgoingBitrateKbps: number | null = null;
  let totalTargetBitrateKbps = 0;
  let totalEncodeTimeMs = 0;
  let hasTargetBitrate = false;
  let hasTotalEncodeTime = false;
  let encoderImplementation: string | null = null;
  let transportProtocol: TransportProtocol | null = null;
  let localCandidateType: CandidateType | null = null;
  let remoteCandidateType: CandidateType | null = null;
  const limitationReasons = new Set<string>();
  const encoderAccelerations = new Set<'hardware' | 'software'>();

  for (const report of reports) {
    const stats: RTCStats[] = [];
    report.forEach((stat) => {
      stats.push(stat);
    });

    let outboundVideo: RTCStats | null = null;
    let trackVideo: RTCStats | null = null;

    for (const stat of stats) {
      if (stat.type !== 'outbound-rtp') continue;
      const kind = readStringField(stat, 'kind') ?? readStringField(stat, 'mediaType');
      if (kind === 'video') {
        outboundVideo = stat;
        break;
      }
    }

    for (const stat of stats) {
      if ((stat.type as string) !== 'track') continue;
      const kind = readStringField(stat, 'kind') ?? readStringField(stat, 'mediaType');
      if (kind === 'video') {
        trackVideo = stat;
        break;
      }
    }

    if (!outboundVideo && !trackVideo) {
      continue;
    }

    activePeerCount += 1;
    const primaryVideoStat = outboundVideo ?? trackVideo;
    if (!primaryVideoStat) {
      continue;
    }

    const codecId = readStringField(primaryVideoStat, 'codecId');
    const codecStat = codecId ? stats.find((stat) => stat.id === codecId) ?? null : null;
    codec ??= readCodecLabel(codecStat);
    encoderImplementation ??= readStringField(primaryVideoStat, 'encoderImplementation');

    const networkPath = readSelectedNetworkPath(stats);
    if (networkPath.availableOutgoingBitrateKbps !== null) {
      minAvailableOutgoingBitrateKbps =
        minAvailableOutgoingBitrateKbps === null
          ? networkPath.availableOutgoingBitrateKbps
          : Math.min(minAvailableOutgoingBitrateKbps, networkPath.availableOutgoingBitrateKbps);
    }
    transportProtocol ??= networkPath.transportProtocol;
    localCandidateType ??= networkPath.localCandidateType;
    remoteCandidateType ??= networkPath.remoteCandidateType;

    const targetBitrate = readNumberField(primaryVideoStat, 'targetBitrate');
    if (targetBitrate !== null) {
      totalTargetBitrateKbps += targetBitrate / 1000;
      hasTargetBitrate = true;
    }
    const totalEncodeTime = readNumberField(primaryVideoStat, 'totalEncodeTime');
    if (totalEncodeTime !== null) {
      totalEncodeTimeMs += totalEncodeTime * 1000;
      hasTotalEncodeTime = true;
    }

    const bytesSent = readNumberField(primaryVideoStat, 'bytesSent');
    if (bytesSent !== null) {
      totalBytesSent += bytesSent;
      hasBytesSent = true;
    }

    const framesEncoded = readNumberField(primaryVideoStat, 'framesEncoded');
    if (framesEncoded !== null) {
      totalFramesEncoded += framesEncoded;
      hasFramesEncoded = true;
    }

    const packetsSent = readNumberField(primaryVideoStat, 'packetsSent');
    if (packetsSent !== null) {
      totalPacketsSent += packetsSent;
      hasPacketsSent = true;
    }

    const framesPerSecond = readNumberField(
      trackVideo ?? outboundVideo!,
      'framesPerSecond',
    );
    if (framesPerSecond !== null) {
      totalFramesPerSecond += framesPerSecond;
      frameRateSampleCount += 1;
    }

    const frameWidth = readNumberField(
      trackVideo ?? outboundVideo!,
      'frameWidth',
    );
    if (frameWidth !== null) {
      maxFrameWidth =
        maxFrameWidth === null
          ? frameWidth
          : Math.max(maxFrameWidth, frameWidth);
    }

    const frameHeight = readNumberField(
      trackVideo ?? outboundVideo!,
      'frameHeight',
    );
    if (frameHeight !== null) {
      maxFrameHeight =
        maxFrameHeight === null
          ? frameHeight
          : Math.max(maxFrameHeight, frameHeight);
    }

    const qualityLimitationReason = readStringField(
      primaryVideoStat,
      'qualityLimitationReason',
    );
    if (qualityLimitationReason) {
      limitationReasons.add(qualityLimitationReason);
    }
    const powerEfficientEncoder = readBooleanField(
      primaryVideoStat,
      'powerEfficientEncoder',
    );
    if (powerEfficientEncoder !== null)
      encoderAccelerations.add(powerEfficientEncoder ? 'hardware' : 'software');

    const retransmittedPacketsSent = readNumberField(
      primaryVideoStat,
      'retransmittedPacketsSent',
    );
    if (retransmittedPacketsSent !== null) {
      totalRetransmittedPacketsSent += retransmittedPacketsSent;
      hasRetransmittedPacketsSent = true;
    }
    const remoteInbound = stats.find(
      (stat) =>
        stat.type === 'remote-inbound-rtp' &&
        (readStringField(stat, 'kind') ??
          readStringField(stat, 'mediaType')) === 'video',
    );
    if (remoteInbound) {
      const packetsLost = readNumberField(remoteInbound, 'packetsLost');
      if (packetsLost !== null) {
        totalPacketsLost += packetsLost;
        hasPacketsLost = true;
      }
      const roundTripTime = readNumberField(remoteInbound, 'roundTripTime');
      if (roundTripTime !== null) {
        maxRoundTripTimeMs = Math.max(
          maxRoundTripTimeMs ?? 0,
          Math.round(roundTripTime * 1000),
        );
      }
    }

    if (Number.isFinite(primaryVideoStat.timestamp)) {
      latestTimestampMs =
        latestTimestampMs === null
        ? Math.round(primaryVideoStat.timestamp)
        : Math.max(latestTimestampMs, Math.round(primaryVideoStat.timestamp));
    }
  }

  if (activePeerCount === 0) {
    return null;
  }

  let qualityLimitationReason: AggregatePeerVideoSendSample['qualityLimitationReason'] = 'none';
  if (limitationReasons.has('cpu')) {
    qualityLimitationReason = 'cpu';
  } else if (limitationReasons.has('bandwidth')) {
    qualityLimitationReason = 'bandwidth';
  } else if ([...limitationReasons].some((reason) => reason !== 'none')) {
    qualityLimitationReason = 'other';
  }

  return {
    activePeerCount,
    availableOutgoingBitrateKbps: minAvailableOutgoingBitrateKbps,
    bytesSent: hasBytesSent ? totalBytesSent : null,
    codec,
    encoderAcceleration:
      encoderAccelerations.size === 1
        ? [...encoderAccelerations][0]!
        : 'unknown',
    encoderImplementation,
    frameHeight: maxFrameHeight,
    frameWidth: maxFrameWidth,
    framesEncoded: hasFramesEncoded ? totalFramesEncoded : null,
    framesPerSecond:
      frameRateSampleCount > 0
        ? totalFramesPerSecond / frameRateSampleCount
        : null,
    packetsSent: hasPacketsSent ? totalPacketsSent : null,
    packetsLost: hasPacketsLost ? totalPacketsLost : null,
    qualityLimitationReason,
    retransmittedPacketsSent: hasRetransmittedPacketsSent
      ? totalRetransmittedPacketsSent
      : null,
    roundTripTimeMs: maxRoundTripTimeMs,
    targetBitrateKbps: hasTargetBitrate ? Math.round(totalTargetBitrateKbps) : null,
    timestampMs: latestTimestampMs,
    totalEncodeTimeMs: hasTotalEncodeTime ? Math.round(totalEncodeTimeMs) : null,
    transportProtocol,
    localCandidateType,
    remoteCandidateType,
  };
}

export function summarizeLocalOutboundAudioNetworkStats(
  reports: Iterable<RTCStatsReport>,
): LocalOutboundNetworkSample | null {
  let totalPacketsSent = 0;
  let totalPacketsLost = 0;
  let hasPacketsSent = false;
  let hasPacketsLost = false;
  let feedbackTimestampMs: number | null = null;
  let missingFeedback = false;

  for (const report of reports) {
    const stats: RTCStats[] = [];
    report.forEach((stat) => {
      stats.push(stat);
    });

    const outboundAudioIds = new Set<string>();
    const feedbackAudioIds = new Set<string>();
    for (const stat of stats) {
      if (stat.type !== 'outbound-rtp') continue;
      const kind = readStringField(stat, 'kind') ?? readStringField(stat, 'mediaType');
      if (kind !== 'audio') continue;
      outboundAudioIds.add(stat.id);

      const sent = readNumberField(stat, 'packetsSent');
      if (sent !== null) {
        totalPacketsSent += sent;
        hasPacketsSent = true;
      }
    }

    for (const stat of stats) {
      if (stat.type !== 'remote-inbound-rtp') continue;
      const localId = readStringField(stat, 'localId');
      if (!localId || !outboundAudioIds.has(localId)) {
        continue;
      }

      const lost = readNumberField(stat, 'packetsLost');
      if (lost !== null) {
        totalPacketsLost += lost;
        hasPacketsLost = true;
        feedbackAudioIds.add(localId);
        if (Number.isFinite(stat.timestamp)) feedbackTimestampMs = Math.max(feedbackTimestampMs ?? 0, stat.timestamp);
      }
    }
    if ([...outboundAudioIds].some((id) => !feedbackAudioIds.has(id))) missingFeedback = true;
  }

  if (!hasPacketsSent && !hasPacketsLost) {
    return null;
  }

  return {
    packetsLost: hasPacketsLost && !missingFeedback ? totalPacketsLost : null,
    packetsSent: hasPacketsSent ? totalPacketsSent : null,
    feedbackTimestampMs,
  };
}

function codecMimeTypeMatches(mimeType: string | null, preferredCodec: VideoCodecPreference): boolean {
  if (!mimeType || preferredCodec === 'default') {
    return false;
  }

  return mimeType.toLowerCase() === `video/${preferredCodec}`;
}

const PRIMARY_VIDEO_CODEC_NAMES = new Set(['av1', 'h264', 'vp8', 'vp9']);

export function selectStrictVideoCodecs(
  codecs: CodecCapabilityLike[],
  preferredCodec: VideoCodecPreference,
): CodecCapabilityLike[] {
  if (preferredCodec === 'default' || codecs.length === 0) {
    return codecs;
  }

  const selected = codecs.filter((codec) =>
    codecMimeTypeMatches(codec.mimeType ?? null, preferredCodec),
  );
  if (selected.length === 0) {
    throw new Error(
      `Selected video codec ${preferredCodec.toUpperCase()} is not supported by this browser.`,
    );
  }
  const auxiliaries = codecs.filter((codec) => {
    const mimeType = codec.mimeType?.toLowerCase() ?? '';
    return (
      mimeType.startsWith('video/') &&
      !PRIMARY_VIDEO_CODEC_NAMES.has(mimeType.slice(6))
    );
  });
  return [...selected, ...auxiliaries];
}

function assertOfferUsesCodec(
  sdp: string | undefined,
  preferredCodec: VideoCodecPreference,
): void {
  if (!sdp || preferredCodec === 'default') return;
  const primaryCodecs = [
    ...sdp.matchAll(/^a=rtpmap:\d+\s+(AV1|H264|VP8|VP9)\/\d+/gim),
  ]
    .map((match) => match[1]?.toLowerCase())
    .filter((codec): codec is string => Boolean(codec));
  if (
    primaryCodecs.length === 0 ||
    primaryCodecs.some((codec) => codec !== preferredCodec)
  ) {
    throw new Error(
      `Selected video codec ${preferredCodec.toUpperCase()} could not be negotiated exactly; ` +
        'the stream was not started and no fallback codec was used.',
    );
  }
}

export class WebRtcManager {
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly callbacks: WebRtcManagerCallbacks;
  private readonly factory: PeerConnectionFactory;

  constructor(callbacks: WebRtcManagerCallbacks, factory: PeerConnectionFactory = defaultFactory) {
    this.callbacks = callbacks;
    this.factory = factory;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private toRtcIceServers(servers: IceServer[]): RTCIceServer[] {
    return servers.map((s) => ({
      credential: s.credential,
      urls: s.urls,
      username: s.username,
    }));
  }

  private wireConnection(userId: string, pc: RTCPeerConnection): void {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.callbacks.onLocalIceCandidate(userId, event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (event.receiver) configureAudioReceiver(event.receiver);
      this.callbacks.onRemoteTrack(userId, event.track, event.streams);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        for (const receiver of pc.getReceivers()) {
          configureAudioReceiver(receiver);
          const track = receiver.track;
          if (!track) continue;
          this.callbacks.onRemoteTrack(userId, track, []);
        }
      }
      this.callbacks.onPeerConnectionStateChange(userId, pc.connectionState);
    };
  }

  private addTracksIfMissing(pc: RTCPeerConnection, stream: MediaStream) {
    const existingTrackIds = new Set(pc.getSenders().map((sender) => sender.track?.id).filter(Boolean) as string[]);
    for (const track of stream.getTracks()) {
      if (existingTrackIds.has(track.id)) {
        continue;
      }
      pc.addTrack(track, stream);
      existingTrackIds.add(track.id);
    }
  }

  private applyVideoCodecPreferences(
    pc: RTCPeerConnection,
    preferredCodec: VideoCodecPreference | undefined,
  ): void {
    if (!preferredCodec || preferredCodec === 'default') {
      return;
    }

    if (
      typeof RTCRtpSender === 'undefined' ||
      typeof RTCRtpSender.getCapabilities !== 'function'
    ) {
      throw new Error(
        `Selected video codec ${preferredCodec.toUpperCase()} cannot be enforced by this browser.`,
      );
    }

    const capabilities = RTCRtpSender.getCapabilities('video');
    const codecs = capabilities?.codecs as CodecCapabilityLike[] | undefined;
    if (!codecs || codecs.length === 0) {
      throw new Error(
        `Selected video codec ${preferredCodec.toUpperCase()} is not supported by this browser.`,
      );
    }

    const strictCodecs = selectStrictVideoCodecs(codecs, preferredCodec);
    let applied = false;

    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender.track?.kind !== 'video') {
        continue;
      }
      if (typeof transceiver.setCodecPreferences !== 'function') {
        throw new Error(
          `Selected video codec ${preferredCodec.toUpperCase()} cannot be enforced by this browser.`,
        );
      }
      transceiver.setCodecPreferences(
        strictCodecs as unknown as Parameters<
          typeof transceiver.setCodecPreferences
        >[0],
      );
      applied = true;
    }
    if (!applied) {
      throw new Error(
        `Selected video codec ${preferredCodec.toUpperCase()} cannot be applied to this stream.`,
      );
    }
  }

  private async applyVideoSenderParameters(
    pc: RTCPeerConnection,
    options: Pick<CreateOfferOptions, 'degradationPreference' | 'maxVideoBitrateKbps' | 'maxVideoFramerate'>,
  ): Promise<void> {
    const hasBitrate = Number.isFinite(options.maxVideoBitrateKbps) && (options.maxVideoBitrateKbps ?? 0) > 0;
    const hasFramerate = Number.isFinite(options.maxVideoFramerate) && (options.maxVideoFramerate ?? 0) > 0;
    const hasDegradationPreference = typeof options.degradationPreference === 'string';
    if (!hasBitrate && !hasFramerate && !hasDegradationPreference) {
      return;
    }

    const targetBps = hasBitrate ? Math.round((options.maxVideoBitrateKbps ?? 0) * 1000) : null;
    const targetFps = hasFramerate ? Math.round(options.maxVideoFramerate ?? 0) : null;
    const videoSenders = pc.getSenders().filter((sender) => sender.track?.kind === 'video');

    for (const sender of videoSenders) {
      if (typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') {
        continue;
      }

      try {
        const current = sender.getParameters();
        const currentEncodings = current.encodings && current.encodings.length > 0 ? current.encodings : [{}];
        const nextEncodings = currentEncodings.map((encoding) => ({
          ...encoding,
          ...(targetBps ? { maxBitrate: targetBps } : {}),
          ...(targetFps ? { maxFramerate: targetFps } : {}),
        }));
        await sender.setParameters({
          ...current,
          ...(hasDegradationPreference ? { degradationPreference: options.degradationPreference } : {}),
          encodings: nextEncodings,
        });
      } catch {
        // Best-effort only: some browsers reject sender parameter changes before negotiation.
      }
    }
  }

  private getOrCreate(userId: string, iceServers: RTCIceServer[]): RTCPeerConnection {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const pc = this.factory(iceServers);
    this.peers.set(userId, pc);
    this.wireConnection(userId, pc);
    return pc;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Add local tracks to all existing (and future) peer connections.
   * Call once after getUserMedia, before joining.
   * For connections created after this call, tracks must be added via
   * addLocalTracks when the peer is created.
   */
  addLocalTracksToPeer(userId: string, stream: MediaStream, iceServers: IceServer[]): void {
    const rtcServers = this.toRtcIceServers(iceServers);
    const pc = this.getOrCreate(userId, rtcServers);
    this.addTracksIfMissing(pc, stream);
  }

  /**
   * Create an offer for a remote peer and return the local SDP.
   * Adds local tracks from `stream` before creating the offer.
   */
  async createOffer(
    targetUserId: string,
    stream: MediaStream,
    iceServers: IceServer[],
    options?: CreateOfferOptions,
  ): Promise<RTCSessionDescriptionInit> {
    const rtcServers = this.toRtcIceServers(iceServers);
    const pc = this.getOrCreate(targetUserId, rtcServers);
    this.addTracksIfMissing(pc, stream);
    if (options?.preferredVideoCodec) {
      this.applyVideoCodecPreferences(pc, options.preferredVideoCodec);
    }

    if (options?.maxVideoBitrateKbps || options?.maxVideoFramerate || options?.degradationPreference) {
      await this.applyVideoSenderParameters(pc, options);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    assertOfferUsesCodec(
      pc.localDescription?.sdp ?? offer.sdp,
      options?.preferredVideoCodec ?? 'default',
    );
    return offer;
  }

  /**
   * Handle an incoming offer from a remote peer.
   * Creates the peer connection, sets the remote description, and returns the
   * local answer SDP. Adds local tracks from `stream` before answering.
   */
  async handleOffer(
    fromUserId: string,
    offer: RTCSessionDescriptionInit,
    stream: MediaStream,
    iceServers: IceServer[],
  ): Promise<RTCSessionDescriptionInit> {
    const rtcServers = this.toRtcIceServers(iceServers);
    const pc = this.getOrCreate(fromUserId, rtcServers);
    this.addTracksIfMissing(pc, stream);

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * Handle an incoming offer for a recv-only peer.
   * Creates recv-only transceivers before answering so the remote sender can
   * attach media without the local side providing tracks.
   */
  async handleRecvOnlyOffer(
    fromUserId: string,
    offer: RTCSessionDescriptionInit,
    iceServers: IceServer[],
    kinds: Array<'audio' | 'video'> = ['audio', 'video'],
  ): Promise<RTCSessionDescriptionInit> {
    const rtcServers = this.toRtcIceServers(iceServers);
    const pc = this.getOrCreate(fromUserId, rtcServers);

    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    if (pc.getTransceivers().length === 0) {
      for (const kind of kinds) {
        pc.addTransceiver(kind, { direction: 'recvonly' });
      }
    }

    // Some Chromium flows can end up with live receivers before `ontrack`
    // dispatch becomes observable in app code. Backfill receiver tracks so
    // callers always get an attachable remote stream entry.
    for (const receiver of pc.getReceivers()) {
      const track = receiver.track;
      if (!track) {
        continue;
      }

      this.callbacks.onRemoteTrack(fromUserId, track, []);
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * Handle an incoming answer from a remote peer.
   */
  async handleAnswer(fromUserId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(fromUserId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Add a remote ICE candidate for a peer.
   */
  async addIceCandidate(fromUserId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(fromUserId);
    if (!pc) return;
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * Restart ICE for a peer (called when the remote signals a restart).
   */
  async restartIce(targetUserId: string): Promise<RTCSessionDescriptionInit | null> {
    const pc = this.peers.get(targetUserId);
    if (!pc) return null;
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    return offer;
  }

  async replaceOutgoingVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    for (const pc of this.peers.values()) {
      const videoSenders = pc.getSenders().filter((sender) => sender.track?.kind === 'video');
      for (const sender of videoSenders) {
        await sender.replaceTrack(track);
      }
    }
  }

  async replaceOutgoingAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    for (const pc of this.peers.values()) {
      const audioSenders = pc.getSenders().filter((sender) => sender.track?.kind === 'audio');
      for (const sender of audioSenders) {
        await sender.replaceTrack(track);
      }
    }
  }

  /**
   * Close and remove the connection to a specific peer.
   */
  closePeer(userId: string): void {
    const pc = this.peers.get(userId);
    if (!pc) return;
    pc.close();
    this.peers.delete(userId);
  }

  /**
   * Close all peer connections. Called on voice leave or cleanup.
   */
  closeAll(): void {
    for (const [userId, pc] of this.peers) {
      pc.close();
      this.peers.delete(userId);
    }
  }

  /**
   * Returns the set of user IDs that have an active peer connection.
   */
  getPeerIds(): string[] {
    return [...this.peers.keys()];
  }

  /**
   * Returns currently known remote receiver tracks for a peer.
   * Useful as a fallback when browser `ontrack` timing is inconsistent.
   */
  getRemoteTracks(userId: string): MediaStreamTrack[] {
    const pc = this.peers.get(userId);
    if (!pc) return [];
    return pc
      .getReceivers()
      .map((receiver) => receiver.track)
      .filter((track): track is MediaStreamTrack => !!track);
  }

  /**
   * Best-effort network stats for a peer connection.
   *
   * - RTT is derived from the selected ICE candidate pair `currentRoundTripTime` when available.
   * - Packet counters are derived from inbound audio RTP stats when available.
   */
  async getPeerNetworkSample(userId: string): Promise<PeerNetworkSample | null> {
    const pc = this.peers.get(userId);
    if (!pc || typeof pc.getStats !== 'function') return null;

    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return null;
    }

    const stats: RTCStats[] = [];
    report.forEach((stat) => {
      stats.push(stat);
    });

    let selectedCandidatePairId: string | null = null;
    for (const stat of stats) {
      if (stat.type !== 'transport') continue;
      const id = readStringField(stat, 'selectedCandidatePairId');
      if (id) {
        selectedCandidatePairId = id;
        break;
      }
    }

    let rttMs: number | null = null;
    for (const stat of stats) {
      if (stat.type !== 'candidate-pair') continue;
      const isSelected = (stat as unknown as Record<string, unknown>)['selected'] === true;
      if (!isSelected && selectedCandidatePairId && stat.id !== selectedCandidatePairId) continue;
      const rttSeconds = readNumberField(stat, 'currentRoundTripTime');
      if (rttSeconds !== null) {
        rttMs = Math.round(rttSeconds * 1000);
        break;
      }
    }

    let packetsReceived: number | null = null;
    let packetsLost: number | null = null;
    for (const stat of stats) {
      if (stat.type !== 'inbound-rtp') continue;
      const kind = readStringField(stat, 'kind') ?? readStringField(stat, 'mediaType');
      if (kind !== 'audio') continue;

      const received = readNumberField(stat, 'packetsReceived');
      const lost = readNumberField(stat, 'packetsLost');
      if (received !== null || lost !== null) {
        packetsReceived = received ?? packetsReceived;
        packetsLost = lost ?? packetsLost;
      }
    }

    return { rttMs, packetsLost, packetsReceived };
  }

  async getPeerAudioPlayoutHealth(userId: string): Promise<AudioPlayoutHealth | null> {
    const pc = this.peers.get(userId);
    if (!pc) return null;
    const receiver = pc.getReceivers().find((entry) => entry.track?.kind === 'audio');
    if (!receiver || typeof receiver.getStats !== 'function') return null;
    try {
      const sample = summarizeAudioReceiveStats(await receiver.getStats());
      return sample ? updateAudioPlayout(receiver, sample) : null;
    } catch {
      return null;
    }
  }

  /**
   * Best-effort local outbound audio counters aggregated across active peers.
   *
   * - packetsSent comes from outbound-rtp (audio)
   * - packetsLost comes from remote-inbound-rtp (audio) linked by localId
   */
  async getLocalOutboundNetworkSample(): Promise<LocalOutboundNetworkSample | null> {
    const pcs = [...this.peers.values()];
    if (pcs.length === 0) {
      return null;
    }

    const reports: RTCStatsReport[] = [];

    for (const pc of pcs) {
      if (typeof pc.getStats !== 'function') {
        continue;
      }

      try {
        reports.push(await pc.getStats());
      } catch {
        continue;
      }
    }

    return summarizeLocalOutboundAudioNetworkStats(reports);
  }

  /**
   * Best-effort inbound video sample for a peer connection.
   *
   * This is intentionally lightweight and favors fields that Chromium exposes
   * consistently enough for a compact viewer diagnostics panel.
   */
  async getPeerVideoReceiveSample(userId: string): Promise<PeerVideoReceiveSample | null> {
    const pc = this.peers.get(userId);
    if (!pc || typeof pc.getStats !== 'function') return null;

    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return null;
    }

    return summarizeVideoReceiveStats([report]);
  }

  /**
   * Best-effort aggregate outbound video sample across active peers.
   *
   * This is aimed at broadcaster-side diagnostics, so it prefers compact
   * summary fields that can distinguish CPU-vs-bandwidth pressure.
   */
  async getAggregatePeerVideoSendSample(): Promise<AggregatePeerVideoSendSample | null> {
    const pcs = [...this.peers.values()];
    if (pcs.length === 0) {
      return null;
    }

    const reports: RTCStatsReport[] = [];

    for (const pc of pcs) {
      if (typeof pc.getStats !== 'function') {
        continue;
      }

      try {
        reports.push(await pc.getStats());
      } catch {
        continue;
      }
    }

    return summarizeAggregateVideoSendStats(reports);
  }
}
