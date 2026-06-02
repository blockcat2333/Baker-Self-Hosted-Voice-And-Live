import type { StreamQualitySettings } from '@baker/protocol';

export const CLIENT_PREFERENCES_STORAGE_KEY = 'baker_client_preferences_v1';

export interface ClientPreferences {
  musicPlaybackVolume?: number;
  selectedCameraKey?: string | null;
  showDataDetails?: boolean;
  streamCodecPreference?: string;
  streamQuality?: Partial<StreamQualitySettings>;
  voiceInputVolume?: number;
  voiceParticipantPlaybackVolume?: Record<string, number>;
  voicePlaybackVolume?: number;
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRawPreferences(): ClientPreferences {
  try {
    const raw = getStorage()?.getItem(CLIENT_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};

    return parsed;
  } catch {
    return {};
  }
}

function writeRawPreferences(preferences: ClientPreferences) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(CLIENT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Persistent storage may be full or blocked; preferences are best-effort.
  }
}

export function loadClientPreferences(): ClientPreferences {
  return readRawPreferences();
}

export function loadBooleanPreference(key: keyof ClientPreferences, fallback: boolean) {
  const value = readRawPreferences()[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function saveClientPreferencesPatch(patch: ClientPreferences) {
  writeRawPreferences({
    ...readRawPreferences(),
    ...patch,
  });
}

export function loadNumberPreference(key: keyof ClientPreferences, fallback: number, clamp: (value: number) => number) {
  const value = readRawPreferences()[key];
  return typeof value === 'number' ? clamp(value) : fallback;
}

export function saveNumberPreference(key: keyof ClientPreferences, value: number) {
  saveClientPreferencesPatch({ [key]: value });
}

export function loadNumberRecordPreference(
  key: keyof ClientPreferences,
  clamp: (value: number) => number,
): Record<string, number> {
  const value = readRawPreferences()[key];
  if (!isRecord(value)) return {};

  const next: Record<string, number> = {};
  for (const [recordKey, recordValue] of Object.entries(value)) {
    if (typeof recordValue === 'number' && Number.isFinite(recordValue)) {
      next[recordKey] = clamp(recordValue);
    }
  }
  return next;
}

export function saveNumberRecordPreference(key: keyof ClientPreferences, value: Record<string, number>) {
  saveClientPreferencesPatch({ [key]: value });
}

export function loadStreamQualityPreference(
  fallback: StreamQualitySettings,
  options: {
    bitrates: readonly StreamQualitySettings['bitrateKbps'][];
    frameRates: readonly StreamQualitySettings['frameRate'][];
    resolutions: readonly StreamQualitySettings['resolution'][];
  },
): StreamQualitySettings {
  const raw = readRawPreferences().streamQuality;
  if (!isRecord(raw)) return fallback;

  const resolution = options.resolutions.includes(raw.resolution as StreamQualitySettings['resolution'])
    ? raw.resolution as StreamQualitySettings['resolution']
    : fallback.resolution;
  const frameRate = options.frameRates.includes(raw.frameRate as StreamQualitySettings['frameRate'])
    ? raw.frameRate as StreamQualitySettings['frameRate']
    : fallback.frameRate;
  const bitrateKbps = options.bitrates.includes(raw.bitrateKbps as StreamQualitySettings['bitrateKbps'])
    ? raw.bitrateKbps as StreamQualitySettings['bitrateKbps']
    : fallback.bitrateKbps;

  return {
    bitrateKbps,
    frameRate,
    resolution,
  };
}

export function saveStreamQualityPreference(quality: StreamQualitySettings) {
  saveClientPreferencesPatch({ streamQuality: quality });
}

export function loadStringOptionPreference<T extends string>(
  key: keyof ClientPreferences,
  fallback: T,
  options: readonly T[],
): T {
  const value = readRawPreferences()[key];
  return typeof value === 'string' && options.includes(value as T) ? value as T : fallback;
}

export function loadSelectedCameraKeyPreference(): string | null {
  const value = readRawPreferences().selectedCameraKey;
  return typeof value === 'string' && value.trim() ? value : null;
}

export function saveSelectedCameraKeyPreference(selectedCameraKey: string | null) {
  saveClientPreferencesPatch({ selectedCameraKey });
}
