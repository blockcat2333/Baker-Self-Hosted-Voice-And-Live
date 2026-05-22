import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from 'react';

import { AppRoot, createDesktopPlatformApi, useAuthStore } from '@baker/client';

import {
  type DesktopServerConfig,
  isVersionGreater,
  normalizeServerInput,
  readServerHealth,
} from './server-config';

type DesktopAppInfo = {
  logsDirectory: string;
  platform: string;
  version: string;
};

type UpdateEventPayload = {
  error?: string;
  feedUrl?: string;
  percent?: number;
  serverVersion?: string;
  state: 'checking' | 'available' | 'not_available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
};

type DesktopPhase = 'loading' | 'setup' | 'update' | 'app';

class DesktopErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    void window.bakerDesktop?.logError({
      message: error.message,
      scope: 'renderer',
      stack: `${error.stack ?? ''}\n${info.componentStack}`,
    });
  }

  override render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="desktop-boot-shell">
        <section className="desktop-boot-panel" role="alert">
          <p className="desktop-boot-eyebrow">Baker Desktop</p>
          <h1 className="desktop-boot-title">Something went wrong</h1>
          <p className="desktop-boot-copy">{this.state.error.message}</p>
          <div className="desktop-boot-actions">
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                void window.bakerDesktop?.openLogs();
              }}
            >
              Open logs
            </button>
          </div>
        </section>
      </div>
    );
  }
}

function updateEventLabel(event: UpdateEventPayload | null) {
  if (!event) {
    return 'Waiting to start update.';
  }

  switch (event.state) {
    case 'checking':
      return 'Checking GitHub release metadata...';
    case 'available':
      return `Update ${event.version ?? ''} is available.`;
    case 'not_available':
      return 'No downloadable update was found for this release.';
    case 'downloading':
      return `Downloading update${typeof event.percent === 'number' ? ` ${Math.round(event.percent)}%` : ''}...`;
    case 'downloaded':
      return 'Update downloaded. Restart Baker to install it.';
    case 'error':
      return event.error ?? 'Update failed.';
  }
}

export function DesktopApp() {
  const platformApi = useMemo(() => createDesktopPlatformApi(), []);
  const [phase, setPhase] = useState<DesktopPhase>('loading');
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [serverConfig, setServerConfig] = useState<DesktopServerConfig | null>(null);
  const [pendingUpdateConfig, setPendingUpdateConfig] = useState<DesktopServerConfig | null>(null);
  const [serverInput, setServerInput] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateEvent, setUpdateEvent] = useState<UpdateEventPayload | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [skippedUpdate, setSkippedUpdate] = useState(false);

  useEffect(() => {
    return window.bakerDesktop?.onUpdateEvent((event) => {
      setUpdateEvent(event);
      if (event.state === 'error') {
        setUpdateError(event.error ?? 'Update failed.');
        setIsUpdating(false);
      }
      if (event.state === 'downloaded' || event.state === 'not_available') {
        setIsUpdating(false);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const info = await window.bakerDesktop?.getAppInfo();
      if (cancelled) {
        return;
      }

      if (info) {
        setAppInfo(info);
      }

      const saved = await window.bakerDesktop?.getSavedServer();
      if (cancelled) {
        return;
      }

      if (!saved) {
        setPhase('setup');
        return;
      }

      setServerInput(saved.input);
      await connectWithConfig(saved, info?.version ?? '0.0.0', false);
    }

    void boot().catch((err) => {
      setBootError(err instanceof Error ? err.message : 'Failed to start Baker Desktop.');
      setPhase('setup');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function connectWithConfig(
    config: DesktopServerConfig,
    appVersion: string,
    skipUpdateCheck: boolean,
  ) {
    setIsConnecting(true);
    setBootError(null);

    try {
      const health = await readServerHealth(config.apiBaseUrl);
      const nextConfig = {
        ...config,
        savedAt: new Date().toISOString(),
        serverVersion: health.version,
      };
      await window.bakerDesktop?.saveServer(nextConfig);
      setServerConfig(nextConfig);

      if (!skipUpdateCheck && isVersionGreater(health.version, appVersion)) {
        setPendingUpdateConfig(nextConfig);
        setUpdateEvent(null);
        setUpdateError(null);
        setPhase('update');
        return;
      }

      setSkippedUpdate(skipUpdateCheck && isVersionGreater(health.version, appVersion));
      setPhase('app');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleConnect(skipUpdateCheck = false) {
    const appVersion = appInfo?.version ?? '0.0.0';

    try {
      const normalized = normalizeServerInput(serverInput);
      await connectWithConfig(
        {
          ...normalized,
          savedAt: new Date().toISOString(),
          serverVersion: '0.0.0',
        },
        appVersion,
        skipUpdateCheck,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to Baker server.';
      setBootError(message);
      void window.bakerDesktop?.logError({
        message,
        scope: 'server-connect',
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  async function handleStartUpdate() {
    if (!pendingUpdateConfig) {
      return;
    }

    setIsUpdating(true);
    setUpdateError(null);

    try {
      await window.bakerDesktop?.checkForUpdate(pendingUpdateConfig.serverVersion);
      await window.bakerDesktop?.downloadUpdate();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed.';
      setUpdateError(message);
      setIsUpdating(false);
      void window.bakerDesktop?.logError({
        message,
        scope: 'update',
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  function continueToApp(skipped: boolean) {
    if (!pendingUpdateConfig) {
      return;
    }
    setServerConfig(pendingUpdateConfig);
    setSkippedUpdate(skipped);
    setPhase('app');
  }

  async function switchServer() {
    await useAuthStore.getState().logout();
    await window.bakerDesktop?.clearSavedServer();
    setPendingUpdateConfig(null);
    setServerConfig(null);
    setSkippedUpdate(false);
    setBootError(null);
    setPhase('setup');
  }

  if (phase === 'app' && serverConfig) {
    const warning =
      skippedUpdate && appInfo
        ? `Server ${serverConfig.serverVersion} is newer than this client ${appInfo.version}. You chose to connect without updating.`
        : null;

    return (
      <DesktopErrorBoundary>
        <AppRoot
          apiBaseUrl={serverConfig.apiBaseUrl}
          gatewayUrl={serverConfig.gatewayUrl}
          onChangeServer={() => {
            void switchServer();
          }}
          platformApi={platformApi}
          versionWarning={warning}
        />
      </DesktopErrorBoundary>
    );
  }

  if (phase === 'update' && pendingUpdateConfig && appInfo) {
    const isDownloaded = updateEvent?.state === 'downloaded';

    return (
      <DesktopErrorBoundary>
        <div className="desktop-boot-shell">
          <section className="desktop-boot-panel">
            <p className="desktop-boot-eyebrow">Baker Desktop</p>
            <h1 className="desktop-boot-title">Update available</h1>
            <p className="desktop-boot-copy">
              Server {pendingUpdateConfig.serverVersion} is newer than this client {appInfo.version}. You can update now
              or continue connecting without updating.
            </p>
            <div className="desktop-update-status">
              <span>{updateEventLabel(updateEvent)}</span>
              {updateError ? <strong>{updateError}</strong> : null}
            </div>
            <div className="desktop-boot-actions">
              {isDownloaded ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    void window.bakerDesktop?.installUpdate();
                  }}
                >
                  Restart and install
                </button>
              ) : (
                <button type="button" className="btn-primary" disabled={isUpdating} onClick={() => void handleStartUpdate()}>
                  {isUpdating ? 'Updating...' : updateError ? 'Retry update' : 'Update now'}
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => continueToApp(true)}>
                Continue
              </button>
              {updateError ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    void window.bakerDesktop?.openLogs();
                  }}
                >
                  Open logs
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </DesktopErrorBoundary>
    );
  }

  return (
    <DesktopErrorBoundary>
      <div className="desktop-boot-shell">
        <form
          className="desktop-boot-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void handleConnect(false);
          }}
        >
          <p className="desktop-boot-eyebrow">Baker Desktop {appInfo?.version ?? ''}</p>
          <h1 className="desktop-boot-title">
            {phase === 'loading' ? 'Starting Baker...' : 'Connect to your Baker server'}
          </h1>
          <label className="desktop-server-field">
            <span>Domain or IP address</span>
            <input
              type="text"
              value={serverInput}
              onChange={(event) => setServerInput(event.target.value)}
              placeholder="example.com or 192.168.1.10"
              autoFocus
            />
          </label>
          {bootError ? <p className="desktop-boot-error">{bootError}</p> : null}
          <div className="desktop-boot-actions">
            <button type="submit" className="btn-primary" disabled={phase === 'loading' || isConnecting}>
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </DesktopErrorBoundary>
  );
}
