export interface PlatformApi {
  name: 'desktop' | 'web';
  openExternal(url: string): Promise<void>;
  selectScreenSource(): Promise<{ shareAudio: boolean; sourceId: string } | null>;
}

export function createBrowserPlatformApi(): PlatformApi {
  return {
    name: 'web',
    async openExternal(url: string) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    async selectScreenSource() {
      return null;
    },
  };
}

declare global {
  interface Window {
    bakerDesktop?: {
      checkForUpdate(targetVersion: string): Promise<{ feedUrl: string }>;
      clearSavedServer(): Promise<void>;
      downloadUpdate(): Promise<void>;
      getAppInfo(): Promise<{ logsDirectory: string; platform: string; version: string }>;
      getSavedServer(): Promise<{
        apiBaseUrl: string;
        gatewayUrl: string;
        input: string;
        savedAt: string;
        serverVersion: string;
      } | null>;
      installUpdate(): Promise<void>;
      logError(payload: { message: string; scope: string; stack?: string }): Promise<void>;
      listUpdateVersions(): Promise<{
        currentVersion: string;
        hasNewer: boolean;
        latestVersion: string | null;
        repository: string;
        versions: Array<{
          assetNames: string[];
          hasInstaller: boolean;
          isLatest: boolean;
          name: string;
          publishedAt: string | null;
          releaseNotes: string | null;
          releaseUrl: string | null;
          tag: string;
        }>;
      }>;
      onUpdateEvent(
        callback: (payload: {
          error?: string;
          feedUrl?: string;
          percent?: number;
          targetVersion?: string;
          state: 'checking' | 'available' | 'not_available' | 'downloading' | 'downloaded' | 'error';
          version?: string;
        }) => void,
      ): () => void;
      openExternal(url: string): Promise<void>;
      openLogs(): Promise<void>;
      platform: 'desktop';
      saveServer(config: {
        apiBaseUrl: string;
        gatewayUrl: string;
        input: string;
        savedAt: string;
        serverVersion: string;
      }): Promise<{
        apiBaseUrl: string;
        gatewayUrl: string;
        input: string;
        savedAt: string;
        serverVersion: string;
      }>;
      selectScreenSource(): Promise<{ shareAudio: boolean; sourceId: string } | null>;
      startExcludedSystemAudioCapture(): Promise<{
        channelCount: number;
        sampleRate: number;
        sessionId: string;
      }>;
      onExcludedSystemAudioChunk(
        sessionId: string,
        callback: (chunk: Uint8Array) => void,
      ): () => void;
      stopExcludedSystemAudioCapture(sessionId: string): Promise<void>;
    };
    bakerDesktopScreenPicker?: {
      cancel(): Promise<void>;
      getData(): Promise<{
        audio: {
          available: boolean;
          reason: string | null;
          shareAudio: boolean;
        };
        sources: Array<{
          appIconDataUrl: string | null;
          id: string;
          name: string;
          thumbnailDataUrl: string;
          type: 'screen' | 'window';
        }>;
      }>;
      select(selection: { shareAudio: boolean; sourceId: string }): Promise<void>;
    };
  }
}

export function createDesktopPlatformApi(): PlatformApi {
  return {
    name: 'desktop',
    async openExternal(url: string) {
      await window.bakerDesktop?.openExternal(url);
    },
    async selectScreenSource() {
      return (await window.bakerDesktop?.selectScreenSource()) ?? null;
    },
  };
}
