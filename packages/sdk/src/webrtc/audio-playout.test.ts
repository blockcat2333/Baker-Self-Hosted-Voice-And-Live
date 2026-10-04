import { describe, expect, it } from 'vitest';
import {
  configureAudioReceiver,
  summarizeAudioReceiveStats,
  updateAudioPlayout,
  type AudioReceiveSample,
} from './audio-playout';

function sample(
  overrides: Partial<AudioReceiveSample> = {},
): AudioReceiveSample {
  return {
    streamId: 'audio-1',
    timestamp: 1000,
    packetsReceived: 50,
    packetsLost: 0,
    packetsDiscarded: 0,
    jitterMs: 5,
    totalSamplesReceived: 48000,
    concealedSamples: 0,
    silentConcealedSamples: 0,
    concealmentEvents: 0,
    jitterBufferDelay: 2880,
    jitterBufferEmittedCount: 48000,
    insertedSamplesForDeceleration: 0,
    removedSamplesForAcceleration: 0,
    ...overrides,
  };
}
function receiver() {
  return {
    track: { kind: 'audio' },
    jitterBufferTarget: null,
  } as unknown as RTCRtpReceiver & { jitterBufferTarget: number | null };
}

describe('audio playout resilience', () => {
  it('detects audible impairment with zero RTP loss and increases the playout reserve', () => {
    const rx = receiver();
    configureAudioReceiver(rx);
    expect(rx.jitterBufferTarget).toBe(60);
    updateAudioPlayout(rx, sample());
    const health = updateAudioPlayout(
      rx,
      sample({
        timestamp: 2000,
        totalSamplesReceived: 96000,
        concealedSamples: 960,
        jitterBufferDelay: 5760,
        jitterBufferEmittedCount: 96000,
        packetsDiscarded: 1,
      }),
    );
    expect(health.audibleConcealedPct).toBe(2);
    expect(health.bufferMs).toBe(60);
    expect(health.discardedPackets).toBe(1);
    expect(rx.jitterBufferTarget).toBe(80);
  });

  it('bounds jitter-driven growth and reduces only after sustained active healthy audio', () => {
    const rx = receiver();
    updateAudioPlayout(rx, sample());
    updateAudioPlayout(
      rx,
      sample({ timestamp: 2000, jitterMs: 120, totalSamplesReceived: 96000 }),
    );
    expect(rx.jitterBufferTarget).toBe(240);
    for (let second = 3; second < 18; second++) {
      updateAudioPlayout(
        rx,
        sample({
          timestamp: second * 1000,
          totalSamplesReceived: second * 48000,
        }),
      );
    }
    expect(rx.jitterBufferTarget).toBe(240);
    updateAudioPlayout(
      rx,
      sample({ timestamp: 18000, totalSamplesReceived: 18 * 48000 }),
    );
    expect(rx.jitterBufferTarget).toBe(220);
  });

  it('does not treat silent concealment, missing counters, or a new RTP stream as audible loss', () => {
    const rx = receiver();
    updateAudioPlayout(rx, sample());
    const silence = updateAudioPlayout(
      rx,
      sample({
        timestamp: 2000,
        totalSamplesReceived: 96000,
        concealedSamples: 4800,
        silentConcealedSamples: 4800,
      }),
    );
    expect(silence.audibleConcealedPct).toBe(0);
    expect(rx.jitterBufferTarget).toBe(60);
    const reset = updateAudioPlayout(
      rx,
      sample({
        streamId: 'new-ssrc',
        timestamp: 3000,
        totalSamplesReceived: 200,
      }),
    );
    expect(reset.concealedPct).toBeNull();
    const missing = updateAudioPlayout(
      rx,
      sample({
        timestamp: 4000,
        totalSamplesReceived: null,
        concealedSamples: null,
      }),
    );
    expect(missing.audibleConcealedPct).toBeNull();
  });

  it('uses seconds for legacy hints and tolerates unsupported receivers', () => {
    const legacy = { track: { kind: 'audio' }, playoutDelayHint: null };
    configureAudioReceiver(legacy as unknown as RTCRtpReceiver);
    expect(legacy.playoutDelayHint).toBe(0.06);
    const unsupported = {
      track: { kind: 'audio' },
    } as unknown as RTCRtpReceiver;
    expect(updateAudioPlayout(unsupported, sample()).targetBufferMs).toBeNull();
    const video = { track: { kind: 'video' }, jitterBufferTarget: null };
    configureAudioReceiver(video as unknown as RTCRtpReceiver);
    expect(video.jitterBufferTarget).toBeNull();
  });

  it('extracts audio playout counters without mistaking video stats for audio', () => {
    const report = new Map([
      [
        'video',
        { id: 'video', type: 'inbound-rtp', kind: 'video', jitter: 0.1 },
      ],
      [
        'audio',
        {
          id: 'audio',
          type: 'inbound-rtp',
          kind: 'audio',
          timestamp: 1000,
          jitter: 0.025,
          packetsLost: 0,
          concealedSamples: 2400,
        },
      ],
    ]) as unknown as RTCStatsReport;
    const value = summarizeAudioReceiveStats(report);
    expect(value?.jitterMs).toBe(25);
    expect(value?.concealedSamples).toBe(2400);
    expect(value?.packetsLost).toBe(0);
    expect(value?.silentConcealedSamples).toBeNull();
  });
});
