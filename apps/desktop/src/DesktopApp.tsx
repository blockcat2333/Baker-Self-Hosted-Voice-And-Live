import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from 'react';

import { AppRoot, createDesktopPlatformApi, useAuthStore } from '@baker/client';

import {
  type DesktopServerConfig,
  isServerVersionGreaterThanClient,
  normalizeServerInput,
  probeGateway,
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

type DesktopPhase = 'loading' | 'setup' | 'app';

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
  const [serverInput, setServerInput] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateEvent, setUpdateEvent] = useState<UpdateEventPayload | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [serverVersionWarning, setServerVersionWarning] = useState<string | null>(null);
  const [updateCatalog, setUpdateCatalog] = useState<DesktopUpdateVersionsResponse | null>(null);
  const [updateCatalogError, setUpdateCatalogError] = useState<string | null>(null);
  const [isCheckingVersions, setIsCheckingVersions] = useState(false);
  const [selectedUpdateTag, setSelectedUpdateTag] = useState('');
  const [isUpdateChooserOpen, setIsUpdateChooserOpen] = useState(false);
  const [isUpdateNoticeDismissed, setIsUpdateNoticeDismissed] = useState(false);

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
        void refreshUpdateVersions({ openChooser: false, silent: true });
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
      await connectWithConfig(saved, info?.version ?? '0.0.0');
    }

    void boot().catch((err) => {
      setBootError(err instanceof Error ? err.message : 'Failed to start Baker Desktop.');
      setPhase('setup');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function connectWithConfig(config: DesktopServerConfig, appVersion: string) {
    setIsConnecting(true);
    setBootError(null);

    try {
      const health = await readServerHealth(config.apiBaseUrl);
      await probeGateway(config.gatewayUrl);
      const nextConfig = {
        ...config,
        savedAt: new Date().toISOString(),
        serverVersion: health.version,
      };
      await window.bakerDesktop?.saveServer(nextConfig);
      setServerConfig(nextConfig);
      setServerVersionWarning(
        isServerVersionGreaterThanClient(health.version, appVersion)
          ? `Server ${health.version} is newer than this client ${appVersion}. Check GitHub releases for a matching desktop client.`
          : null,
      );
      setPhase('app');
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleConnect() {
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

  async function refreshUpdateVersions({
    openChooser,
    silent,
  }: {
    openChooser: boolean;
    silent: boolean;
  }) {
    if (openChooser) {
      setIsUpdateChooserOpen(true);
    }

    setIsCheckingVersions(true);
    if (!silent) {
      setUpdateCatalogError(null);
    }

    try {
      const response = await window.bakerDesktop?.listUpdateVersions();
      if (!response) {
        throw new Error('Desktop update API is unavailable.');
      }
      setUpdateCatalog(response);
      setSelectedUpdateTag((current) => current || response.latestVersion || response.versions[0]?.tag || '');
      if (response.hasNewer) {
        setIsUpdateNoticeDismissed(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check GitHub releases.';
      setUpdateCatalogError(message);
      if (!silent) {
        void window.bakerDesktop?.logError({
          message,
          scope: 'update-list',
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    } finally {
      setIsCheckingVersions(false);
    }
  }

  async function openUpdateChooser() {
    setIsUpdateChooserOpen(true);
    if (!updateCatalog && !isCheckingVersions) {
      await refreshUpdateVersions({ openChooser: true, silent: false });
    }
  }

  async function handleStartUpdate() {
    if (!selectedUpdateTag) {
      setUpdateError('Select a desktop version first.');
      return;
    }

    setIsUpdating(true);
    setUpdateError(null);
    setUpdateEvent(null);

    try {
      await window.bakerDesktop?.checkForUpdate(selectedUpdateTag);
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

  async function switchServer() {
    await useAuthStore.getState().logout();
    await window.bakerDesktop?.clearSavedServer();
    setServerConfig(null);
    setServerVersionWarning(null);
    setBootError(null);
    setPhase('setup');
  }

  const selectedUpdateVersion =
    updateCatalog?.versions.find((version) => version.tag === selectedUpdateTag) ?? null;
  const updateNotice =
    updateCatalog?.hasNewer && updateCatalog.latestVersion && !isUpdateNoticeDismissed
      ? `Baker Desktop ${updateCatalog.latestVersion} is available. Current version: ${updateCatalog.currentVersion}.`
      : null;
  const updateAction = (
    <button
      type="button"
      className="desktop-update-chip"
      onClick={() => {
        void openUpdateChooser();
      }}
      disabled={isCheckingVersions}
      title="Check GitHub releases"
    >
      {isCheckingVersions ? 'Checking...' : updateCatalog?.hasNewer ? 'Update available' : 'Update'}
    </button>
  );
  const desktopUpdateOverlay = (
    <>
      {updateNotice ? (
        <div className="desktop-update-toast" role="status">
          <span>{updateNotice}</span>
          <div className="desktop-update-toast-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                void openUpdateChooser();
              }}
            >
              View versions
            </button>
            <button type="button" className="btn-ghost" onClick={() => setIsUpdateNoticeDismissed(true)}>
              Later
            </button>
          </div>
        </div>
      ) : null}

      {isUpdateChooserOpen ? (
        <div className="desktop-update-dialog-backdrop" role="presentation">
          <section className="desktop-update-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-update-title">
            <header className="desktop-update-dialog-header">
              <div>
                <p className="desktop-boot-eyebrow">GitHub Releases</p>
                <h2 id="desktop-update-title" className="desktop-update-dialog-title">Desktop updates</h2>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setIsUpdateChooserOpen(false)}>
                Close
              </button>
            </header>

            <div className="desktop-update-dialog-body">
              <div className="desktop-update-status">
                <span>Current desktop version: {updateCatalog?.currentVersion ?? appInfo?.version ?? 'unknown'}</span>
                <span>{updateEventLabel(updateEvent)}</span>
                {updateCatalogError ? <strong>{updateCatalogError}</strong> : null}
                {updateError ? <strong>{updateError}</strong> : null}
              </div>

              <label className="desktop-server-field">
                <span>Target desktop version</span>
                <select
                  value={selectedUpdateTag}
                  onChange={(event) => setSelectedUpdateTag(event.target.value)}
                  disabled={isCheckingVersions || isUpdating}
                >
                  <option value="">Select a version</option>
                  {(updateCatalog?.versions ?? []).map((version) => (
                    <option key={version.tag} value={version.tag}>
                      {version.tag}{version.isLatest ? ' (latest)' : ''}{version.hasInstaller ? '' : ' (metadata only)'}
                    </option>
                  ))}
                </select>
              </label>

              {selectedUpdateVersion ? (
                <div className="desktop-update-version-detail">
                  <span>{selectedUpdateVersion.name}</span>
                  {selectedUpdateVersion.publishedAt ? (
                    <span>Published {new Date(selectedUpdateVersion.publishedAt).toLocaleString()}</span>
                  ) : null}
                  {selectedUpdateVersion.releaseUrl ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        void window.bakerDesktop?.openExternal(selectedUpdateVersion.releaseUrl!);
                      }}
                    >
                      Open release notes
                    </button>
                  ) : null}
                  {!selectedUpdateVersion.hasInstaller ? (
                    <strong>This release does not include desktop update assets.</strong>
                  ) : null}
                </div>
              ) : null}
            </div>

            <footer className="desktop-update-dialog-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  void refreshUpdateVersions({ openChooser: true, silent: false });
                }}
                disabled={isCheckingVersions || isUpdating}
              >
                Refresh list
              </button>
              {updateEvent?.state === 'downloaded' ? (
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
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleStartUpdate()}
                  disabled={!selectedUpdateTag || selectedUpdateVersion?.hasInstaller === false || isCheckingVersions || isUpdating}
                >
                  {isUpdating ? 'Updating...' : updateError ? 'Retry update' : 'Update selected'}
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );

  if (phase === 'app' && serverConfig) {
    const warning = serverVersionWarning;

    return (
      <DesktopErrorBoundary>
        <>
          <AppRoot
            apiBaseUrl={serverConfig.apiBaseUrl}
            desktopUpdateAction={updateAction}
            gatewayUrl={serverConfig.gatewayUrl}
            onChangeServer={() => {
              void switchServer();
            }}
            platformApi={platformApi}
            versionWarning={warning}
          />
          {desktopUpdateOverlay}
        </>
      </DesktopErrorBoundary>
    );
  }

  return (
    <DesktopErrorBoundary>
      <>
        <div className="desktop-boot-shell">
          <form
            className="desktop-boot-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void handleConnect();
            }}
          >
            <p className="desktop-boot-eyebrow">Baker Desktop {appInfo?.version ?? ''}</p>
            <h1 className="desktop-boot-title">
              {phase === 'loading' ? 'Starting Baker...' : 'Connect to your Baker server'}
            </h1>
            <label className="desktop-server-field">
              <div className="desktop-field-label-row">
                <span>Domain or IP address</span>
                {updateAction}
              </div>
              <input
                type="text"
                value={serverInput}
                onChange={(event) => setServerInput(event.target.value)}
                placeholder="example.com or 192.168.1.10"
                autoFocus
              />
              <small>Include the port when your server uses one, for example https://ark.kkdy.space:3323</small>
            </label>
            {bootError ? <p className="desktop-boot-error">{bootError}</p> : null}
            <div className="desktop-boot-actions">
              <button type="submit" className="btn-primary" disabled={phase === 'loading' || isConnecting}>
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </form>
        </div>
        {desktopUpdateOverlay}
      </>
    </DesktopErrorBoundary>
  );
}
