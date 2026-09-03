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
    ((sender.averageEncodeTimeMs ?? 0) > 1000 / targetFps) ||
    (sender.qualityLimitationReason === 'other' &&
      sender.captureFrameRate !== null &&
      sender.encodedFrameRate !== null &&
      sender.encodedFrameRate < sender.captureFrameRate * 0.7)
  )
    return 'sender_encode';

  if (
    sender.qualityLimitationReason === 'bandwidth' ||
    (sender.availableOutgoingBitrateKbps !== null &&
      sender.availableOutgoingBitrateKbps !== undefined &&
      sender.encoderTargetBitrateKbps !== null &&
      sender.encoderTargetBitrateKbps !== undefined &&
      sender.availableOutgoingBitrateKbps < sender.encoderTargetBitrateKbps * 0.8)
  )
    return 'uplink';

  const ingress = diagnostics.sfu?.ingress;
  const egress = diagnostics.sfu?.egress;
  if (diagnostics.mediaMode === 'sfu') {
    const ingressTransportFailed =
      ingress?.iceState === 'failed' ||
      ingress?.iceState === 'disconnected' ||
      ingress?.iceState === 'closed' ||
      ingress?.dtlsState === 'failed' ||
      ingress?.dtlsState === 'closed';
    if (
      !diagnostics.sfu ||
      !ingress ||
      ingress.paused ||
      ingressTransportFailed ||
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
    if (
      egress?.paused ||
      egress?.iceState === 'failed' ||
      egress?.iceState === 'disconnected' ||
      egress?.iceState === 'closed' ||
      egress?.dtlsState === 'failed' ||
      egress?.dtlsState === 'closed' ||
      (receiver && !egress)
    )
      return 'server';
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
      (egress?.availableOutgoingBitrateKbps !== null &&
        egress?.availableOutgoingBitrateKbps !== undefined &&
        egress.bitrateKbps !== null &&
        egress.availableOutgoingBitrateKbps < egress.bitrateKbps * 0.8) ||
      (egress?.bitrateKbps !== null &&
        egress?.bitrateKbps !== undefined &&
        receiver.bitrateKbps !== null &&
        receiver.bitrateKbps < egress.bitrateKbps * 0.7)
    )
      return 'downlink';
    const receivedFrameRate = receiver.receiveFrameRate ?? null;
    const decodedFrameRate = receiver.decodeFrameRate ?? receiver.frameRate;
    const renderedFrameRate = receiver.renderFrameRate ?? null;
    if (
      (receivedFrameRate !== null &&
        decodedFrameRate !== null &&
        decodedFrameRate < receivedFrameRate * 0.7) ||
      (decodedFrameRate !== null &&
        renderedFrameRate !== null &&
        renderedFrameRate < decodedFrameRate * 0.7) ||
      (receiver.freezeDurationMs ?? 0) >= 200 ||
      (receiver.averageDecodeTimeMs ?? 0) > 1000 / targetFps
    )
      return 'decode';
  }
  return 'healthy';
}
