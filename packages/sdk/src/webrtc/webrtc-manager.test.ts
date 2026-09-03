import { afterEach, describe, expect, it, vi } from 'vitest';

import { summarizeVideoReceiveStats, WebRtcManager } from './webrtc-manager';

function statsReport(records: Array<Record<string, unknown>>): RTCStatsReport {
  const map = new Map(records.map((record) => [String(record.id), record]));
  return map as unknown as RTCStatsReport;
}

describe('video receive stats', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('combines inbound RTP, track, and codec reports', () => {
    const result = summarizeVideoReceiveStats([
      statsReport([
        {
          bytesReceived: 800_000,
          codecId: 'codec-1',
          framesDecoded: 120,
          id: 'inbound-1',
          jitter: 0.012,
          kind: 'video',
          packetsLost: 3,
          packetsReceived: 997,
          timestamp: 2_000,
          type: 'inbound-rtp',
          decoderImplementation: 'ExternalDecoder',
          powerEfficientDecoder: true,
        },
        {
          frameHeight: 1080,
          frameWidth: 1920,
          framesDropped: 4,
          framesPerSecond: 59.8,
          id: 'track-1',
          kind: 'video',
          type: 'track',
        },
        { id: 'codec-1', mimeType: 'video/H264', type: 'codec' },
        { id: 'transport-1', selectedCandidatePairId: 'pair-1', type: 'transport' },
        {
          availableIncomingBitrate: 5_000_000,
          id: 'pair-1',
          localCandidateId: 'local-1',
          remoteCandidateId: 'remote-1',
          state: 'succeeded',
          type: 'candidate-pair',
        },
        { candidateType: 'relay', id: 'local-1', protocol: 'udp', type: 'local-candidate' },
        { candidateType: 'srflx', id: 'remote-1', type: 'remote-candidate' },
      ]),
    ]);

    expect(result).toEqual({
      availableIncomingBitrateKbps: 5000,
      bytesReceived: 800_000,
      codec: 'H264',
      decoderAcceleration: 'hardware',
      decoderImplementation: 'ExternalDecoder',
      frameHeight: 1080,
      frameWidth: 1920,
      framesDecoded: 120,
      framesDropped: 4,
      framesReceived: null,
      framesPerSecond: 59.8,
      freezeCount: null,
      jitterBufferDelayMs: null,
      jitterMs: 12,
      keyFramesDecoded: null,
      localCandidateType: 'relay',
      nackCount: null,
      packetsLost: 3,
      packetsReceived: 997,
      pliCount: null,
      remoteCandidateType: 'srflx',
      timestampMs: 2_000,
      totalDecodeTimeMs: null,
      totalFreezesDurationMs: null,
      transportProtocol: 'udp',
    });
  });

  it('applies the selected codec, bitrate, frame rate, and balanced degradation to a sender', async () => {
    const setCodecPreferences = vi.fn();
    const setParameters = vi.fn().mockResolvedValue(undefined);
    const track = { id: 'video-1', kind: 'video' } as MediaStreamTrack;
    const sender = {
      getParameters: () => ({ encodings: [{}] }),
      setParameters,
      track,
    } as unknown as RTCRtpSender;
    const pc = {
      addTrack: vi.fn(),
      close: vi.fn(),
      connectionState: 'new',
      createOffer: vi.fn().mockResolvedValue({
        sdp: 'm=video 9 UDP/TLS/RTP/SAVPF 102\r\na=rtpmap:102 H264/90000\r\n',
        type: 'offer',
      }),
      getReceivers: () => [],
      getSenders: () => [sender],
      getTransceivers: () => [{ sender, setCodecPreferences }],
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
    } as unknown as RTCPeerConnection;
    vi.stubGlobal('RTCRtpSender', {
      getCapabilities: () => ({
        codecs: [{ mimeType: 'video/VP8' }, { mimeType: 'video/H264' }],
      }),
    });
    const manager = new WebRtcManager(
      {
        onLocalIceCandidate: vi.fn(),
        onPeerConnectionStateChange: vi.fn(),
        onRemoteTrack: vi.fn(),
      },
      () => pc,
    );

    await manager.createOffer(
      'peer-1',
      { getTracks: () => [track] } as unknown as MediaStream,
      [],
      {
        degradationPreference: 'balanced',
        maxVideoBitrateKbps: 6_000,
        maxVideoFramerate: 60,
        preferredVideoCodec: 'h264',
      },
    );

    expect(setCodecPreferences).toHaveBeenCalledWith([
      expect.objectContaining({ mimeType: 'video/H264' }),
    ]);
    expect(setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
      degradationPreference: 'balanced',
        encodings: [
          expect.objectContaining({ maxBitrate: 6_000_000, maxFramerate: 60 }),
        ],
      }),
    );
  });
});
