export interface AudioReceiveSample {
  streamId: string;
  timestamp: number;
  packetsReceived: number | null;
  packetsLost: number | null;
  packetsDiscarded: number | null;
  jitterMs: number | null;
  totalSamplesReceived: number | null;
  concealedSamples: number | null;
  silentConcealedSamples: number | null;
  concealmentEvents: number | null;
  jitterBufferDelay: number | null;
  jitterBufferEmittedCount: number | null;
  insertedSamplesForDeceleration: number | null;
  removedSamplesForAcceleration: number | null;
}

export interface AudioPlayoutHealth {
  jitterMs: number | null;
  bufferMs: number | null;
  concealedPct: number | null;
  audibleConcealedPct: number | null;
  discardedPackets: number | null;
  targetBufferMs: number | null;
}

export function summarizeAudioReceiveStats(
  report: RTCStatsReport,
): AudioReceiveSample | null {
  let inbound: Record<string, unknown> | undefined;
  report.forEach((stat) => {
    const value = stat as unknown as Record<string, unknown>;
    if (
      value.type === 'inbound-rtp' &&
      (value.kind ?? value.mediaType) === 'audio'
    )
      inbound ??= value;
  });
  if (!inbound) return null;
  const record = inbound;
  const number = (key: string) =>
    typeof record[key] === 'number' && Number.isFinite(record[key])
      ? (record[key] as number)
      : null;
  return {
    streamId: String(record.id),
    timestamp: number('timestamp') ?? 0,
    packetsReceived: number('packetsReceived'),
    packetsLost: number('packetsLost'),
    packetsDiscarded: number('packetsDiscarded'),
    jitterMs: number('jitter') === null ? null : number('jitter')! * 1000,
    totalSamplesReceived: number('totalSamplesReceived'),
    concealedSamples: number('concealedSamples'),
    silentConcealedSamples: number('silentConcealedSamples'),
    concealmentEvents: number('concealmentEvents'),
    jitterBufferDelay: number('jitterBufferDelay'),
    jitterBufferEmittedCount: number('jitterBufferEmittedCount'),
    insertedSamplesForDeceleration: number('insertedSamplesForDeceleration'),
    removedSamplesForAcceleration: number('removedSamplesForAcceleration'),
  };
}

type AudioReceiver = RTCRtpReceiver & {
  jitterBufferTarget?: number | null;
  playoutDelayHint?: number | null;
};
const states = new WeakMap<
  RTCRtpReceiver,
  {
    previous: AudioReceiveSample | null;
    target: number;
    stableSince: number | null;
    applied: boolean;
  }
>();
const MIN_BUFFER_MS = 60;
const MAX_BUFFER_MS = 240;

function applyTarget(receiver: RTCRtpReceiver, target: number): boolean {
  const audio = receiver as AudioReceiver;
  if (receiver.track?.kind !== 'audio') return false;
  try {
    if ('jitterBufferTarget' in audio) {
      audio.jitterBufferTarget = target;
      return true;
    }
  } catch {
    /* Try the older Chromium hint below. */
  }
  try {
    if ('playoutDelayHint' in audio) {
      audio.playoutDelayHint = target / 1000;
      return true;
    }
  } catch {
    /* Unsupported hints never interrupt playback. */
  }
  return false;
}

export function configureAudioReceiver(receiver: RTCRtpReceiver): void {
  if (receiver.track?.kind !== 'audio' || states.has(receiver)) return;
  states.set(receiver, {
    previous: null,
    target: MIN_BUFFER_MS,
    stableSince: null,
    applied: applyTarget(receiver, MIN_BUFFER_MS),
  });
}

function delta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null || current < previous
    ? null
    : current - previous;
}

// Packet receipt and audible continuity are separate: a packet can arrive too
// late to play while RTP loss remains zero. Use short-window audio counters.
export function updateAudioPlayout(
  receiver: RTCRtpReceiver,
  sample: AudioReceiveSample,
): AudioPlayoutHealth {
  configureAudioReceiver(receiver);
  const state = states.get(receiver);
  const previous = state?.previous;
  const comparable =
    previous &&
    previous.streamId === sample.streamId &&
    sample.timestamp > previous.timestamp;
  const samples = comparable
    ? delta(sample.totalSamplesReceived, previous.totalSamplesReceived)
    : null;
  const concealed = comparable
    ? delta(sample.concealedSamples, previous.concealedSamples)
    : null;
  const silent = comparable
    ? delta(sample.silentConcealedSamples, previous.silentConcealedSamples)
    : null;
  const discarded = comparable
    ? delta(sample.packetsDiscarded, previous.packetsDiscarded)
    : null;
  const delay = comparable
    ? delta(sample.jitterBufferDelay, previous.jitterBufferDelay)
    : null;
  const emitted = comparable
    ? delta(sample.jitterBufferEmittedCount, previous.jitterBufferEmittedCount)
    : null;
  const concealedPct =
    samples && concealed !== null
      ? Math.min(100, (100 * concealed) / samples)
      : null;
  const audibleConcealedPct =
    samples && concealed !== null && silent !== null
      ? Math.min(100, (100 * Math.max(0, concealed - silent)) / samples)
      : null;
  const bufferMs = emitted && delay !== null ? (delay * 1000) / emitted : null;
  if (state) {
    // Do not interpret silence, stale stats, or reset counters as a healthy
    // interval and prematurely lower a buffer on a recovering connection.
    if (comparable && samples && concealedPct !== null) {
      const desired = Math.min(
        MAX_BUFFER_MS,
        Math.max(
          MIN_BUFFER_MS,
          Math.ceil(((sample.jitterMs ?? 0) * 3 + 40) / 20) * 20,
        ),
      );
      const impaired =
        (audibleConcealedPct ?? concealedPct) >= 0.5 || (discarded ?? 0) > 0;
      if (impaired || desired > state.target) {
        state.target = Math.min(
          MAX_BUFFER_MS,
          Math.max(desired, state.target + (impaired ? 20 : 0)),
        );
        state.stableSince = null;
      } else if (desired < state.target) {
        state.stableSince ??= sample.timestamp;
        if (sample.timestamp - state.stableSince >= 15_000) {
          state.target = Math.max(desired, state.target - 20);
          state.stableSince = sample.timestamp;
        }
      } else {
        state.stableSince = null;
      }
      state.applied = applyTarget(receiver, state.target);
    } else {
      state.stableSince = null;
    }
    state.previous = sample;
  }
  return {
    jitterMs: sample.jitterMs,
    bufferMs,
    concealedPct,
    audibleConcealedPct,
    discardedPackets: discarded,
    targetBufferMs: state?.applied ? state.target : null,
  };
}
