export const DEFAULT_VOICE_INPUT_VOLUME = 1;
export const DEFAULT_VOICE_PLAYBACK_VOLUME = 1;
export const DEFAULT_VOICE_PARTICIPANT_VOLUME = 1;

export function limitVoiceSample(sample: number): number {
  const magnitude = Math.abs(sample);
  // Unity gain below the knee; smooth, bounded peaks instead of hard clipping
  // when microphone or participant amplification is raised to 200%.
  // Reserve 2% for oversampling-filter ringing and intersample peaks.
  return magnitude <= 0.9
    ? sample
    : Math.sign(sample) *
        (0.9 + 0.08 * (1 - Math.exp(-(magnitude - 0.9) / 0.08)));
}

let limiterCurve: Float32Array<ArrayBuffer> | undefined;
export function connectVoiceLimiter(
  context: AudioContext,
  input: AudioNode,
  destination: AudioNode,
): void {
  if (typeof context.createWaveShaper !== 'function') {
    input.connect(destination);
    return;
  }
  // WaveShaper's domain is [-1,1]. Scale down first so a 2x-amplified
  // signal remains in that domain, then undo the scale inside the curve.
  const headroom = context.createGain();
  headroom.gain.value = 0.5;
  const limiter = context.createWaveShaper();
  limiterCurve ??= Float32Array.from({ length: 8193 }, (_, index) =>
    limitVoiceSample(((index / 8192) * 2 - 1) * 2),
  );
  limiter.curve = limiterCurve;
  limiter.oversample = '2x';
  input.connect(headroom);
  headroom.connect(limiter);
  limiter.connect(destination);
}

export function setVoiceGain(
  param: AudioParam,
  volume: number,
  context: AudioContext,
): void {
  if (typeof param.setTargetAtTime === 'function') {
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(volume, context.currentTime, 0.01);
  } else {
    param.value = volume;
  }
}

export function clampVoiceInputVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_VOICE_INPUT_VOLUME;
  }

  if (volume <= 0) {
    return 0;
  }

  if (volume >= 2) {
    return 2;
  }

  return volume;
}

export function clampVoicePlaybackVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_VOICE_PLAYBACK_VOLUME;
  }

  if (volume <= 0) {
    return 0;
  }

  if (volume >= 1) {
    return 1;
  }

  return volume;
}

export function clampVoiceParticipantPlaybackVolume(volume: number): number {
  if (!Number.isFinite(volume)) {
    return DEFAULT_VOICE_PARTICIPANT_VOLUME;
  }

  if (volume <= 0) {
    return 0;
  }

  if (volume >= 2) {
    return 2;
  }

  return volume;
}

export function computeEffectiveParticipantPlaybackVolume(
  globalPlaybackVolume: number,
  participantPlaybackVolume: number,
): number {
  return (
    clampVoicePlaybackVolume(globalPlaybackVolume) *
    clampVoiceParticipantPlaybackVolume(participantPlaybackVolume)
  );
}

export function toVoiceVolumePercent(volume: number): number {
  return Math.round(clampVoicePlaybackVolume(volume) * 100);
}

export function toVoiceParticipantVolumePercent(volume: number): number {
  return Math.round(clampVoiceParticipantPlaybackVolume(volume) * 100);
}
