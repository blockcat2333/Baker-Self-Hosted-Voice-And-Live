export const DEFAULT_VOICE_INPUT_VOLUME = 1;
export const DEFAULT_VOICE_PLAYBACK_VOLUME = 1;
export const DEFAULT_VOICE_PARTICIPANT_VOLUME = 1;

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

export function computeEffectiveParticipantPlaybackVolume(
  globalPlaybackVolume: number,
  participantPlaybackVolume: number,
): number {
  return clampVoicePlaybackVolume(
    clampVoicePlaybackVolume(globalPlaybackVolume) * clampVoicePlaybackVolume(participantPlaybackVolume),
  );
}

export function toVoiceVolumePercent(volume: number): number {
  return Math.round(clampVoicePlaybackVolume(volume) * 100);
}
