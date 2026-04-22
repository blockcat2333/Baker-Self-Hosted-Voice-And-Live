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
};

export type PeerVideoReceiveSample = {
  bytesReceived: number | null;
  codec: string | null;
  frameHeight: number | null;
  frameWidth: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  framesPerSecond: number | null;
  jitterMs: number | null;
  packetsLost: number | null;
  packetsReceived: number | null;
  timestampMs: number | null;
};

export type VideoCodecPreference = 'default' | 'h264' | 'vp8' | 'vp9' | 'av1';

type CodecCapabilityLike = {
  mimeType?: string;
} & Record<string, unknown>;

export type AggregatePeerVideoSendSample = {
  activePeerCount: number;
  bytesSent: number | null;
  codec: string | null;
  frameHeight: number | null;
  frameWidth: number | null;
  framesEncoded: number | null;
  framesPerSecond: number | null;
  packetsSent: number | null;
  qualityLimitationReason: 'bandwidth' | 'cpu' | 'none' | 'other';
  timestampMs: number | null;
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
  return slashIndex >= 0 ? mimeType.slice(slashIndex + 1).toUpperCase() : mimeType.toUpperCase();
}

function codecMimeTypeMatches(mimeType: string | null, preferredCodec: VideoCodecPreference): boolean {
  if (!mimeType || preferredCodec === 'default') {
    return false;
  }

  return mimeType.toLowerCase() === `video/${preferredCodec}`;
}

function prioritizeVideoCodecs(
  codecs: CodecCapabilityLike[],
  preferredCodec: VideoCodecPreference,
): CodecCapabilityLike[] {
  if (preferredCodec === 'default' || codecs.length === 0) {
    return codecs;
  }

  const prioritized = [...codecs].sort((left, right) => {
    const leftScore = codecMimeTypeMatches(left.mimeType ?? null, preferredCodec) ? 0 : 1;
    const rightScore = codecMimeTypeMatches(right.mimeType ?? null, preferredCodec) ? 0 : 1;
    return leftScore - rightScore;
  });

  const changed = prioritized.some((codec, index) => codec !== codecs[index]);
  return changed ? prioritized : codecs;
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
      this.callbacks.onRemoteTrack(userId, event.track, event.streams);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        for (const receiver of pc.getReceivers()) {
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

    if (typeof RTCRtpSender === 'undefined' || typeof RTCRtpSender.getCapabilities !== 'function') {
      return;
    }

    const capabilities = RTCRtpSender.getCapabilities('video');
    const codecs = capabilities?.codecs as CodecCapabilityLike[] | undefined;
    if (!codecs || codecs.length === 0) {
      return;
    }

    const prioritizedCodecs = prioritizeVideoCodecs(codecs, preferredCodec);
    if (prioritizedCodecs === codecs) {
      return;
    }

    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender.track?.kind !== 'video' || typeof transceiver.setCodecPreferences !== 'function') {
        continue;
      }

      try {
        transceiver.setCodecPreferences(
          prioritizedCodecs as unknown as Parameters<typeof transceiver.setCodecPreferences>[0],
        );
      } catch {
        // Best-effort only: older browsers may reject codec preference changes.
      }
    }
  }

  private async applyVideoSenderParameters(
    pc: RTCPeerConnection,
    options: Pick<CreateOfferOptions, 'degradationPreference' | 'maxVideoBitrateKbps'>,
  ): Promise<void> {
    const hasBitrate = Number.isFinite(options.maxVideoBitrateKbps) && (options.maxVideoBitrateKbps ?? 0) > 0;
    const hasDegradationPreference = typeof options.degradationPreference === 'string';
    if (!hasBitrate && !hasDegradationPreference) {
      return;
    }

    const targetBps = hasBitrate ? Math.round((options.maxVideoBitrateKbps ?? 0) * 1000) : null;
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

    if (options?.maxVideoBitrateKbps || options?.degradationPreference) {
      await this.applyVideoSenderParameters(pc, options);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
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

    let totalPacketsSent = 0;
    let totalPacketsLost = 0;
    let hasPacketsSent = false;
    let hasPacketsLost = false;

    for (const pc of pcs) {
      if (typeof pc.getStats !== 'function') {
        continue;
      }

      let report: RTCStatsReport;
      try {
        report = await pc.getStats();
      } catch {
        continue;
      }

      const stats: RTCStats[] = [];
      report.forEach((stat) => {
        stats.push(stat);
      });

      const outboundAudioIds = new Set<string>();
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
        const kind = readStringField(stat, 'kind') ?? readStringField(stat, 'mediaType');
        if (kind !== 'audio') continue;

        const localId = readStringField(stat, 'localId');
        if (!localId || !outboundAudioIds.has(localId)) {
          continue;
        }

        const lost = readNumberField(stat, 'packetsLost');
        if (lost !== null) {
          totalPacketsLost += lost;
          hasPacketsLost = true;
        }
      }
    }

    if (!hasPacketsSent && !hasPacketsLost) {
      return null;
    }

    return {
      packetsLost: hasPacketsLost ? totalPacketsLost : null,
      packetsSent: hasPacketsSent ? totalPacketsSent : null,
    };
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

    const stats: RTCStats[] = [];
    report.forEach((stat) => {
      stats.push(stat);
    });

    let inboundVideo: RTCStats | null = null;
    let trackVideo: RTCStats | null = null;

    for (const stat of stats) {
      if (stat.type === 'inbound-rtp') {
        const kind = readStringField(stat, 'kind') ?? readStringField(stat, 'mediaType');
        if (kind === 'video') {
          inboundVideo = stat;
          break;
        }
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

    if (!inboundVideo && !trackVideo) {
      return null;
    }

    const primaryVideoStat = inboundVideo ?? trackVideo;
    if (!primaryVideoStat) {
      return null;
    }

    const codecId = readStringField(primaryVideoStat, 'codecId');
    const codecStat = codecId ? stats.find((stat) => stat.id === codecId) ?? null : null;

    return {
      bytesReceived: readNumberField(primaryVideoStat, 'bytesReceived'),
      codec: readCodecLabel(codecStat),
      frameHeight: readNumberField(trackVideo ?? inboundVideo!, 'frameHeight'),
      frameWidth: readNumberField(trackVideo ?? inboundVideo!, 'frameWidth'),
      framesDecoded: readNumberField(primaryVideoStat, 'framesDecoded'),
      framesDropped: readNumberField(trackVideo ?? inboundVideo!, 'framesDropped'),
      framesPerSecond: readNumberField(trackVideo ?? inboundVideo!, 'framesPerSecond'),
      jitterMs:
        readNumberField(primaryVideoStat, 'jitter') !== null
          ? Math.round((readNumberField(primaryVideoStat, 'jitter') ?? 0) * 1000)
          : null,
      packetsLost: readNumberField(primaryVideoStat, 'packetsLost'),
      packetsReceived: readNumberField(primaryVideoStat, 'packetsReceived'),
      timestampMs: Number.isFinite(primaryVideoStat.timestamp)
        ? Math.round(primaryVideoStat.timestamp)
        : null,
    };
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
    const limitationReasons = new Set<string>();

    for (const pc of pcs) {
      if (typeof pc.getStats !== 'function') {
        continue;
      }

      let report: RTCStatsReport;
      try {
        report = await pc.getStats();
      } catch {
        continue;
      }

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

      const framesPerSecond = readNumberField(trackVideo ?? outboundVideo!, 'framesPerSecond');
      if (framesPerSecond !== null) {
        totalFramesPerSecond += framesPerSecond;
        frameRateSampleCount += 1;
      }

      const frameWidth = readNumberField(trackVideo ?? outboundVideo!, 'frameWidth');
      if (frameWidth !== null) {
        maxFrameWidth = maxFrameWidth === null ? frameWidth : Math.max(maxFrameWidth, frameWidth);
      }

      const frameHeight = readNumberField(trackVideo ?? outboundVideo!, 'frameHeight');
      if (frameHeight !== null) {
        maxFrameHeight = maxFrameHeight === null ? frameHeight : Math.max(maxFrameHeight, frameHeight);
      }

      const qualityLimitationReason = readStringField(primaryVideoStat, 'qualityLimitationReason');
      if (qualityLimitationReason) {
        limitationReasons.add(qualityLimitationReason);
      }

      if (Number.isFinite(primaryVideoStat.timestamp)) {
        latestTimestampMs = latestTimestampMs === null
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
      bytesSent: hasBytesSent ? totalBytesSent : null,
      codec,
      frameHeight: maxFrameHeight,
      frameWidth: maxFrameWidth,
      framesEncoded: hasFramesEncoded ? totalFramesEncoded : null,
      framesPerSecond: frameRateSampleCount > 0 ? totalFramesPerSecond / frameRateSampleCount : null,
      packetsSent: hasPacketsSent ? totalPacketsSent : null,
      qualityLimitationReason,
      timestampMs: latestTimestampMs,
    };
  }
}
