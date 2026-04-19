type VoiceSfxType =
  | 'mute'
  | 'unmute'
  | 'self_join'
  | 'self_leave'
  | 'peer_join'
  | 'peer_leave';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContext();
  }

  return audioContext;
}

function playTone(ctx: AudioContext, frequency: number, startAt: number, duration: number, gainValue: number) {
  if (typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') {
    return;
  }
  if (!('destination' in ctx) || !ctx.destination) {
    return;
  }

  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(gainValue, 0.0001), startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration);
  } catch {
    // Best-effort only.
  }
}

export function playVoiceSfx(type: VoiceSfxType): void {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {
      // Ignore browser autoplay state failures.
    });
  }

  const now = ctx.currentTime + 0.005;

  switch (type) {
    case 'mute':
      playTone(ctx, 520, now, 0.08, 0.045);
      playTone(ctx, 360, now + 0.09, 0.09, 0.04);
      break;
    case 'unmute':
      playTone(ctx, 360, now, 0.08, 0.04);
      playTone(ctx, 560, now + 0.09, 0.1, 0.045);
      break;
    case 'self_join':
      playTone(ctx, 500, now, 0.09, 0.05);
      playTone(ctx, 740, now + 0.1, 0.11, 0.05);
      break;
    case 'self_leave':
      playTone(ctx, 660, now, 0.09, 0.045);
      playTone(ctx, 420, now + 0.1, 0.11, 0.045);
      break;
    case 'peer_join':
      playTone(ctx, 610, now, 0.09, 0.035);
      playTone(ctx, 760, now + 0.1, 0.1, 0.035);
      break;
    case 'peer_leave':
      playTone(ctx, 610, now, 0.08, 0.03);
      playTone(ctx, 430, now + 0.09, 0.1, 0.03);
      break;
  }
}
