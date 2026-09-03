import type { StreamDiagnosticsGetAckData } from '@baker/protocol';

import type { WatchedStreamVideoStats } from './stream-store';

export type StreamDiagnosis =
  | 'decode'
  | 'downlink'
  | 'healthy'
  | 'insufficient'
  | 'sender_capture'
  | 'sender_encode'
  | 'server'
  | 'uplink';

export function diagnoseStream(
  diagnostics: StreamDiagnosticsGetAckData | null,
  receiver: WatchedStreamVideoStats | null,
  now = Date.now(),
): StreamDiagnosis {
  if (
    !diagnostics ||
    !diagnostics.publisher ||
    diagnostics.publisherSampledAt === null ||
    now - diagnostics.publisherSampledAt > 6_000
  )
    return 'insufficient';
  const sender = diagnostics.publisher;
  const targetFps = sender.targetFrameRate;
  if (
    sender.captureFrameRate !== null &&
    sender.captureFrameRate < targetFps * 0.7
  )
    return 'sender_capture';
  if (
    sender.qualityLimitationReason === 'cpu' ||
    (sender.encodedFrameRate !== null &&
      sender.encodedFrameRate < targetFps * 0.7)
  )
    return 'sender_encode';

  const ingress = diagnostics.sfu?.ingress;
  const egress = diagnostics.sfu?.egress;
  if (diagnostics.mediaMode === 'sfu') {
    if (
      !diagnostics.sfu ||
      !ingress ||
      ingress.paused ||
      (diagnostics.sfu.workerCpuPct ?? 0) >= 85
    )
      return 'server';
    if (
      (ingress.score ?? 10) < 7 ||
      (sender.bitrateKbps !== null &&
        ingress.bitrateKbps !== null &&
        ingress.bitrateKbps < sender.bitrateKbps * 0.7)
    ) {
      return 'uplink';
    }
    if (egress?.paused || (receiver && !egress)) return 'server';
  }

  if (receiver) {
    const received =
      (receiver.packetsLost ?? 0) + (receiver.packetsReceived ?? 0);
    const lossPct =
      received > 0 ? ((receiver.packetsLost ?? 0) / received) * 100 : 0;
    if (
      lossPct >= 5 ||
      (receiver.jitterMs ?? 0) >= 80 ||
      (receiver.jitterBufferDelayMs ?? 0) >= 150 ||
      (egress?.bitrateKbps !== null &&
        egress?.bitrateKbps !== undefined &&
        receiver.bitrateKbps !== null &&
        receiver.bitrateKbps < egress.bitrateKbps * 0.7)
    )
      return 'downlink';
    const receivedFrames = receiver.framesReceived ?? 0;
    if (
      (receivedFrames >= targetFps * 0.8 &&
        receiver.frameRate !== null &&
        receiver.frameRate < targetFps * 0.7) ||
      (receiver.freezeDurationMs ?? 0) >= 200 ||
      (receiver.averageDecodeTimeMs ?? 0) > 1000 / targetFps
    )
      return 'decode';
  }
  return 'healthy';
}
