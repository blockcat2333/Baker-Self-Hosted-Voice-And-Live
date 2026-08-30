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
      clearServerSession(serverId: string): Promise<void>;
      downloadUpdate(): Promise<void>;
      getAppInfo(): Promise<{ logsDirectory: string; platform: string; version: string }>;
      getServerRegistry(): Promise<{
        activeServerId: string | null;
        schemaVersion: 2;
        servers: Array<{
          apiBaseUrl: string;
          createdAt: string;
          gatewayUrl: string;
          id: string;
          input: string;
          lastConnectedAt: string | null;
          name: string;
          order: number;
          savedAt: string;
          serverVersion: string;
        }>;
      }>;
      getServerSession(serverId: string): Promise<{
        accessToken: string;
        refreshToken: string;
        user: { email: string; id: string; username: string } | null;
      } | null>;
      getSessionSecurity(): Promise<{ persistent: boolean }>;
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
      saveServerRegistry(registry: {
        activeServerId: string | null;
        schemaVersion: 2;
        servers: Array<{
          apiBaseUrl: string;
          createdAt: string;
          gatewayUrl: string;
          id: string;
          input: string;
          lastConnectedAt: string | null;
          name: string;
          order: number;
          savedAt: string;
          serverVersion: string;
        }>;
      }): Promise<{
        activeServerId: string | null;
        schemaVersion: 2;
        servers: Array<{
          apiBaseUrl: string;
          createdAt: string;
          gatewayUrl: string;
          id: string;
          input: string;
          lastConnectedAt: string | null;
          name: string;
          order: number;
          savedAt: string;
          serverVersion: string;
        }>;
      }>;
      saveServerSession(
        serverId: string,
        session: {
          accessToken: string;
          refreshToken: string;
          user: { email: string; id: string; username: string } | null;
        },
      ): Promise<{ persisted: boolean }>;
      selectScreenSource(): Promise<{ shareAudio: boolean; sourceId: string } | null>;
      selectMusicSource(): Promise<{ processId: number } | null>;
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
      isWindowAudioCaptureAvailable(): Promise<boolean>;
      startWindowAudioCapture(processId: number): Promise<{
        channelCount: number;
        sampleRate: number;
        sessionId: string;
      }>;
      onWindowAudioCaptureChunk(
        sessionId: string,
        callback: (chunk: Uint8Array) => void,
      ): () => void;
      stopWindowAudioCapture(sessionId: string): Promise<void>;
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
    bakerDesktopMusicPicker?: {
      cancel(): Promise<void>;
      getData(): Promise<{
        sources: Array<{
          id: string;
          processId: number;
          title: string;
        }>;
      }>;
      getLevels(processIds: number[]): Promise<Record<string, number>>;
      select(selection: { processId: number }): Promise<void>;
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
