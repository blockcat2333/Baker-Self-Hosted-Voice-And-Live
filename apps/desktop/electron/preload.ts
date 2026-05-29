import { contextBridge, ipcRenderer } from 'electron';

type UpdateEventPayload = {
  error?: string;
  feedUrl?: string;
  percent?: number;
  targetVersion?: string;
  state: 'checking' | 'available' | 'not_available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
};

type DesktopUpdateVersion = {
  assetNames: string[];
  hasInstaller: boolean;
  isLatest: boolean;
  name: string;
  publishedAt: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  tag: string;
};

type DesktopUpdateVersionsResponse = {
  currentVersion: string;
  hasNewer: boolean;
  latestVersion: string | null;
  repository: string;
  versions: DesktopUpdateVersion[];
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

type MusicSourceSelection = {
  processId: number;
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

type MusicPickerSource = {
  id: string;
  processId: number;
  title: string;
};

type MusicPickerData = {
  sources: MusicPickerSource[];
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
  async listUpdateVersions() {
    return (await ipcRenderer.invoke('desktop:update-versions')) as DesktopUpdateVersionsResponse;
  },
  async selectScreenSource() {
    return (await ipcRenderer.invoke('desktop:select-screen-source')) as ScreenSourceSelection | null;
  },
  async selectMusicSource() {
    return (await ipcRenderer.invoke('desktop:select-music-source')) as MusicSourceSelection | null;
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
  async isWindowAudioCaptureAvailable() {
    return (await ipcRenderer.invoke('desktop:window-audio-available')) as boolean;
  },
  async startWindowAudioCapture(processId: number) {
    return (await ipcRenderer.invoke('desktop:window-audio-start', processId)) as {
      channelCount: number;
      sampleRate: number;
      sessionId: string;
    };
  },
  onWindowAudioCaptureChunk(sessionId: string, callback: (chunk: Uint8Array) => void) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { chunk: Uint8Array; sessionId: string },
    ) => {
      if (payload.sessionId === sessionId) {
        callback(new Uint8Array(payload.chunk));
      }
    };
    ipcRenderer.on('desktop:window-audio-chunk', listener);
    return () => {
      ipcRenderer.removeListener('desktop:window-audio-chunk', listener);
    };
  },
  async stopWindowAudioCapture(sessionId: string) {
    await ipcRenderer.invoke('desktop:window-audio-stop', sessionId);
  },
  async checkForUpdate(targetVersion: string) {
    return (await ipcRenderer.invoke('desktop:update-check', targetVersion)) as { feedUrl: string };
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

contextBridge.exposeInMainWorld('bakerDesktopMusicPicker', {
  async cancel() {
    await ipcRenderer.invoke('desktop:music-picker:cancel');
  },
  async getData() {
    return (await ipcRenderer.invoke('desktop:music-picker:get-data')) as MusicPickerData;
  },
  async getLevels(processIds: number[]) {
    return (await ipcRenderer.invoke('desktop:music-picker:get-levels', processIds)) as Record<string, number>;
  },
  async select(selection: MusicSourceSelection) {
    await ipcRenderer.invoke('desktop:music-picker:select', selection);
  },
});
