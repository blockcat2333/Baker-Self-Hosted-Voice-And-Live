import { describe, expect, test } from 'vitest';

import {
  clampVoiceInputVolume,
  clampVoicePlaybackVolume,
  computeEffectiveParticipantPlaybackVolume,
  toVoiceVolumePercent,
} from './voice-audio';

describe('voice-audio', () => {
  test('clampVoiceInputVolume constrains to [0, 2]', () => {
    expect(clampVoiceInputVolume(Number.NaN)).toBe(1);
    expect(clampVoiceInputVolume(-1)).toBe(0);
    expect(clampVoiceInputVolume(0.5)).toBe(0.5);
    expect(clampVoiceInputVolume(3)).toBe(2);
  });

  test('clampVoicePlaybackVolume constrains to [0, 1]', () => {
    expect(clampVoicePlaybackVolume(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampVoicePlaybackVolume(Number.NaN)).toBe(1);
    expect(clampVoicePlaybackVolume(-0.1)).toBe(0);
    expect(clampVoicePlaybackVolume(0.25)).toBe(0.25);
    expect(clampVoicePlaybackVolume(2)).toBe(1);
  });

  test('computeEffectiveParticipantPlaybackVolume multiplies and clamps', () => {
    expect(computeEffectiveParticipantPlaybackVolume(0.5, 0.5)).toBe(0.25);
    expect(computeEffectiveParticipantPlaybackVolume(1, 1)).toBe(1);
    expect(computeEffectiveParticipantPlaybackVolume(1.5, 0.5)).toBe(0.5);
    expect(computeEffectiveParticipantPlaybackVolume(0.8, 2)).toBe(0.8);
  });

  test('toVoiceVolumePercent returns integer percent', () => {
    expect(toVoiceVolumePercent(0)).toBe(0);
    expect(toVoiceVolumePercent(0.236)).toBe(24);
    expect(toVoiceVolumePercent(1)).toBe(100);
    expect(toVoiceVolumePercent(2)).toBe(100);
  });
});
