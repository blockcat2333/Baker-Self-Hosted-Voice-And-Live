import { create } from 'zustand';

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

interface AudioDeviceState {
  audioInputDevices: AudioDeviceOption[];
  audioOutputDevices: AudioDeviceOption[];
  error: string | null;
  isRefreshing: boolean;
  selectedAudioInputId: string | null;
  selectedAudioOutputId: string | null;
  refreshDevices(): Promise<void>;
  setSelectedAudioInputId(deviceId: string | null): void;
  setSelectedAudioOutputId(deviceId: string | null): void;
}

const AUDIO_INPUT_KEY = 'baker_audio_input_device_id';
const AUDIO_OUTPUT_KEY = 'baker_audio_output_device_id';

type SinkCapableElement = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function loadStoredDeviceId(key: string): string | null {
  const value = getStorage()?.getItem(key)?.trim();
  return value ? value : null;
}

function saveStoredDeviceId(key: string, deviceId: string | null) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  if (deviceId) {
    storage.setItem(key, deviceId);
  } else {
    storage.removeItem(key);
  }
}

function listDevices(devices: readonly MediaDeviceInfo[], kind: MediaDeviceKind): AudioDeviceOption[] {
  let index = 0;
  return devices
    .filter((device) => device.kind === kind)
    .map((device) => {
      index += 1;
      return {
        deviceId: device.deviceId,
        label: device.label.trim() || (kind === 'audioinput' ? `Microphone ${index}` : `Speaker ${index}`),
      };
    });
}

function keepSelectionIfAvailable(deviceId: string | null, devices: readonly AudioDeviceOption[]) {
  if (!deviceId) {
    return null;
  }

  return devices.some((device) => device.deviceId === deviceId) ? deviceId : null;
}

export function buildPreferredAudioInputConstraints(): MediaTrackConstraints {
  const deviceId = useAudioDeviceStore.getState().selectedAudioInputId;
  return {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

export async function applyAudioOutputDevice(
  element: HTMLMediaElement | null | undefined,
  deviceId: string | null,
): Promise<boolean> {
  const sinkElement = element as SinkCapableElement | null | undefined;
  if (!sinkElement || typeof sinkElement.setSinkId !== 'function') {
    return false;
  }

  await sinkElement.setSinkId(deviceId ?? '');
  return true;
}

export async function applyPreferredAudioOutputDevice(
  element: HTMLMediaElement | null | undefined,
): Promise<boolean> {
  return applyAudioOutputDevice(element, useAudioDeviceStore.getState().selectedAudioOutputId);
}

export const useAudioDeviceStore = create<AudioDeviceState>((set) => ({
  audioInputDevices: [],
  audioOutputDevices: [],
  error: null,
  isRefreshing: false,
  selectedAudioInputId: loadStoredDeviceId(AUDIO_INPUT_KEY),
  selectedAudioOutputId: loadStoredDeviceId(AUDIO_OUTPUT_KEY),

  async refreshDevices() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.enumerateDevices !== 'function'
    ) {
      set({
        audioInputDevices: [],
        audioOutputDevices: [],
        error: 'Audio device enumeration is not available in this runtime.',
        isRefreshing: false,
        selectedAudioInputId: null,
        selectedAudioOutputId: null,
      });
      return;
    }

    set({ error: null, isRefreshing: true });

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices = listDevices(devices, 'audioinput');
      const audioOutputDevices = listDevices(devices, 'audiooutput');

      set((state) => {
        const selectedAudioInputId = keepSelectionIfAvailable(state.selectedAudioInputId, audioInputDevices);
        const selectedAudioOutputId = keepSelectionIfAvailable(state.selectedAudioOutputId, audioOutputDevices);
        saveStoredDeviceId(AUDIO_INPUT_KEY, selectedAudioInputId);
        saveStoredDeviceId(AUDIO_OUTPUT_KEY, selectedAudioOutputId);

        return {
          audioInputDevices,
          audioOutputDevices,
          error: null,
          isRefreshing: false,
          selectedAudioInputId,
          selectedAudioOutputId,
        };
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Audio device enumeration failed.',
        isRefreshing: false,
      });
    }
  },

  setSelectedAudioInputId(deviceId) {
    saveStoredDeviceId(AUDIO_INPUT_KEY, deviceId);
    set({ selectedAudioInputId: deviceId });
  },

  setSelectedAudioOutputId(deviceId) {
    saveStoredDeviceId(AUDIO_OUTPUT_KEY, deviceId);
    set({ selectedAudioOutputId: deviceId });
  },
}));
