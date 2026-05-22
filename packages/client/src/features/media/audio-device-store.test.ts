import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyAudioOutputDevice,
  buildPreferredAudioInputConstraints,
  useAudioDeviceStore,
} from './audio-device-store';

const enumerateDevices = vi.fn();
const originalNavigator = globalThis.navigator;

beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        enumerateDevices,
      },
    },
  });
  enumerateDevices.mockReset();
  useAudioDeviceStore.setState({
    audioInputDevices: [],
    audioOutputDevices: [],
    error: null,
    isRefreshing: false,
    selectedAudioInputId: null,
    selectedAudioOutputId: null,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

describe('audio device store', () => {
  it('enumerates microphone and speaker devices', async () => {
    enumerateDevices.mockResolvedValue([
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Desk Mic' },
      { deviceId: 'speaker-1', kind: 'audiooutput', label: 'Headphones' },
      { deviceId: 'camera-1', kind: 'videoinput', label: 'Camera' },
    ]);

    await useAudioDeviceStore.getState().refreshDevices();

    expect(useAudioDeviceStore.getState().audioInputDevices).toEqual([
      { deviceId: 'mic-1', label: 'Desk Mic' },
    ]);
    expect(useAudioDeviceStore.getState().audioOutputDevices).toEqual([
      { deviceId: 'speaker-1', label: 'Headphones' },
    ]);
  });

  it('builds microphone constraints for the selected input device', () => {
    useAudioDeviceStore.getState().setSelectedAudioInputId('mic-2');

    expect(buildPreferredAudioInputConstraints()).toEqual({
      autoGainControl: true,
      deviceId: { exact: 'mic-2' },
      echoCancellation: true,
      noiseSuppression: true,
    });
  });

  it('applies selected speaker output with setSinkId when supported', async () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    const element = { setSinkId } as unknown as HTMLMediaElement;

    await expect(applyAudioOutputDevice(element, 'speaker-1')).resolves.toBe(true);
    expect(setSinkId).toHaveBeenCalledWith('speaker-1');
  });

  it('gracefully skips speaker selection when setSinkId is unsupported', async () => {
    await expect(applyAudioOutputDevice({} as HTMLMediaElement, 'speaker-1')).resolves.toBe(false);
  });
});
