import { contextBridge, ipcRenderer } from 'electron';

type UpdateEventPayload = {
  error?: string;
  feedUrl?: string;
  percent?: number;
  serverVersion?: string;
  state: 'checking' | 'available' | 'not_available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
};

type SavedServerConfig = {
  apiBaseUrl: string;
  gatewayUrl: string;
  input: string;
  savedAt: string;
  serverVersion: string;
};

type ScreenSourceSelection = {
  shareAudio: boolean;
  sourceId: string;
};

type ScreenPickerSource = {
  appIconDataUrl: string | null;
  id: string;
  name: string;
  thumbnailDataUrl: string;
  type: 'screen' | 'window';
};

type ScreenPickerData = {
  audio: {
    available: boolean;
    reason: string | null;
    shareAudio: boolean;
  };
  sources: ScreenPickerSource[];
};

contextBridge.exposeInMainWorld('bakerDesktop', {
  async clearSavedServer() {
    await ipcRenderer.invoke('desktop:clear-server');
  },
  async downloadUpdate() {
    await ipcRenderer.invoke('desktop:update-download');
  },
  async getAppInfo() {
    return (await ipcRenderer.invoke('desktop:get-app-info')) as {
      logsDirectory: string;
      platform: NodeJS.Platform;
      version: string;
    };
  },
  async getSavedServer() {
    return (await ipcRenderer.invoke('desktop:get-saved-server')) as SavedServerConfig | null;
  },
  async installUpdate() {
    await ipcRenderer.invoke('desktop:update-install');
  },
  async logError(payload: { message: string; scope: string; stack?: string }) {
    await ipcRenderer.invoke('desktop:log-error', payload);
  },
  onUpdateEvent(callback: (payload: UpdateEventPayload) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: UpdateEventPayload) => callback(payload);
    ipcRenderer.on('desktop:update-event', listener);
    return () => {
      ipcRenderer.removeListener('desktop:update-event', listener);
    };
  },
  async openExternal(url: string) {
    await ipcRenderer.invoke('desktop:open-external', url);
  },
  async openLogs() {
    await ipcRenderer.invoke('desktop:open-logs');
  },
  platform: 'desktop' as const,
  async saveServer(config: SavedServerConfig) {
    return (await ipcRenderer.invoke('desktop:save-server', config)) as SavedServerConfig;
  },
  async selectScreenSource() {
    return (await ipcRenderer.invoke('desktop:select-screen-source')) as ScreenSourceSelection | null;
  },
  async startExcludedSystemAudioCapture() {
    return (await ipcRenderer.invoke('desktop:excluded-audio-start')) as {
      channelCount: number;
      sampleRate: number;
      sessionId: string;
    };
  },
  onExcludedSystemAudioChunk(sessionId: string, callback: (chunk: Uint8Array) => void) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { chunk: Uint8Array; sessionId: string },
    ) => {
      if (payload.sessionId === sessionId) {
        callback(new Uint8Array(payload.chunk));
      }
    };
    ipcRenderer.on('desktop:excluded-audio-chunk', listener);
    return () => {
      ipcRenderer.removeListener('desktop:excluded-audio-chunk', listener);
    };
  },
  async stopExcludedSystemAudioCapture(sessionId: string) {
    await ipcRenderer.invoke('desktop:excluded-audio-stop', sessionId);
  },
  async checkForUpdate(serverVersion: string) {
    return (await ipcRenderer.invoke('desktop:update-check', serverVersion)) as { feedUrl: string };
  },
});

contextBridge.exposeInMainWorld('bakerDesktopScreenPicker', {
  async cancel() {
    await ipcRenderer.invoke('desktop:screen-picker:cancel');
  },
  async getData() {
    return (await ipcRenderer.invoke('desktop:screen-picker:get-data')) as ScreenPickerData;
  },
  async select(selection: ScreenSourceSelection) {
    await ipcRenderer.invoke('desktop:screen-picker:select', selection);
  },
});
