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
    return (await ipcRenderer.invoke('desktop:select-screen-source')) as string | null;
  },
  async checkForUpdate(serverVersion: string) {
    return (await ipcRenderer.invoke('desktop:update-check', serverVersion)) as { feedUrl: string };
  },
});
