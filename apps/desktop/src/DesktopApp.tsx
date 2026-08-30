import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import {
  AppRoot,
  createDesktopPlatformApi,
  i18n,
  type ServerRailConnectionState,
  type ServerSwitcherModel,
  useAuthStore,
  useChatStore,
  useGatewayStore,
} from '@baker/client';

import {
  isServerVersionGreaterThanClient,
  normalizeServerInput,
  probeGateway,
  readServerHealth,
  readServerIdentity,
} from './server-config';
import { createDesktopAuthSessionPersistence } from './desktop-session-persistence';
import {
  createDesktopServerEntry,
  createEmptyServerRegistry,
  removeDesktopServer,
  type DesktopServerEntry,
  type DesktopServerRegistry,
  upsertDesktopServer,
} from './server-registry';
import { DesktopServerSwitchCoordinator } from './server-switch';

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
type ServerReachability = 'available' | 'checking' | 'unavailable';

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
  const [, setInterfaceLanguage] = useState(i18n.language);
  const t = i18n.t.bind(i18n);
  const platformApi = useMemo(() => createDesktopPlatformApi(), []);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const [phase, setPhase] = useState<DesktopPhase>('loading');
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [registry, setRegistry] = useState<DesktopServerRegistry>(() => createEmptyServerRegistry());
  const [serverConfig, setServerConfig] = useState<DesktopServerEntry | null>(null);
  const [serverInput, setServerInput] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [serverReachability, setServerReachability] = useState<Record<string, ServerReachability>>({});
  const [isServerManagerOpen, setIsServerManagerOpen] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | 'new' | null>(null);
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [serverNotice, setServerNotice] = useState<string | null>(null);
  const [sessionSecurityWarning, setSessionSecurityWarning] = useState<string | null>(null);
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
  const serverSwitchCoordinatorRef = useRef(new DesktopServerSwitchCoordinator());

  useEffect(() => {
    const handleLanguageChanged = (language: string) => setInterfaceLanguage(language);
    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, []);

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

  const registryProbeKey = registry.servers
    .map((server) => `${server.id}:${server.apiBaseUrl}`)
    .join('|');

  useEffect(() => {
    if (!registryProbeKey) return;
    let cancelled = false;

    async function probeSavedServers() {
      const servers = registry.servers;
      setServerReachability((current) => ({
        ...current,
        ...Object.fromEntries(servers.map((server) => [server.id, 'checking' as const])),
      }));
      await Promise.all(
        servers.map(async (server) => {
          try {
            await Promise.all([
              readServerHealth(server.apiBaseUrl, 5_000),
              probeGateway(server.gatewayUrl, 5_000),
            ]);
            if (!cancelled) {
              setServerReachability((current) => ({ ...current, [server.id]: 'available' }));
            }
          } catch {
            if (!cancelled) {
              setServerReachability((current) => ({ ...current, [server.id]: 'unavailable' }));
            }
          }
        }),
      );
    }

    void probeSavedServers();
    const timer = window.setInterval(() => void probeSavedServers(), 30_000);
    const handleFocus = () => void probeSavedServers();
    window.addEventListener('focus', handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [registry.servers, registryProbeKey]);

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

      const [saved, security] = await Promise.all([
        window.bakerDesktop?.getServerRegistry(),
        window.bakerDesktop?.getSessionSecurity(),
      ]);
      if (cancelled) {
        return;
      }

      if (security && !security.persistent) {
        setSessionSecurityWarning(
          'Windows secure storage is unavailable. Sign-in sessions will only be kept until Baker closes.',
        );
      }

      const nextRegistry = saved ?? createEmptyServerRegistry();
      setRegistry(nextRegistry);
      const active = nextRegistry.servers.find((server) => server.id === nextRegistry.activeServerId) ?? null;
      if (!active) {
        setPhase('setup');
        return;
      }

      setServerInput(active.input);
      setServerConfig(active);
      setServerVersionWarning(
        isServerVersionGreaterThanClient(active.serverVersion, info?.version ?? '0.0.0')
          ? `Server ${active.serverVersion} is newer than this client ${info?.version ?? '0.0.0'}. Check GitHub releases for a matching desktop client.`
          : null,
      );
      setPhase('app');
    }

    void boot().catch((err) => {
      setBootError(err instanceof Error ? err.message : 'Failed to start Baker Desktop.');
      setPhase('setup');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function validateServer(server: DesktopServerEntry) {
    setServerReachability((current) => ({ ...current, [server.id]: 'checking' }));
    const [health, identity] = await Promise.all([
      readServerHealth(server.apiBaseUrl),
      readServerIdentity(server.apiBaseUrl),
      probeGateway(server.gatewayUrl),
    ]);
    const now = new Date().toISOString();
    setServerReachability((current) => ({ ...current, [server.id]: 'available' }));
    return {
      ...server,
      lastConnectedAt: now,
      name: identity.serverName,
      savedAt: now,
      serverVersion: health.version,
    };
  }

  async function commitActiveServer(server: DesktopServerEntry, sourceRegistry = registry) {
    useGatewayStore.getState().disconnect();
    useChatStore.getState().reset();
    useAuthStore.getState().clearRuntimeSession();

    const nextRegistry = upsertDesktopServer(sourceRegistry, server, true);
    const saved = (await window.bakerDesktop?.saveServerRegistry(nextRegistry)) ?? nextRegistry;
    setRegistry(saved);
    setServerConfig(server);
    setServerInput(server.input);
    const appVersion = appInfo?.version ?? '0.0.0';
    setServerVersionWarning(
      isServerVersionGreaterThanClient(server.serverVersion, appVersion)
        ? `Server ${server.serverVersion} is newer than this client ${appVersion}. Check GitHub releases for a matching desktop client.`
        : null,
    );
    setPhase('app');
  }

  async function selectServer(serverId: string) {
    const target = registry.servers.find((server) => server.id === serverId);
    if (!target || busyServerId) return;
    setBusyServerId(serverId);
    setBootError(null);
    setServerNotice(null);

    try {
      const outcome = await serverSwitchCoordinatorRef.current.run(
        target,
        validateServer,
        commitActiveServer,
      );
      if (outcome.status === 'superseded') return;
    } catch (err) {
      setServerReachability((current) => ({ ...current, [serverId]: 'unavailable' }));
      const message = err instanceof Error ? err.message : 'Failed to connect to Baker server.';
      setServerNotice(message);
      void window.bakerDesktop?.logError({
        message,
        scope: 'server-switch',
        stack: err instanceof Error ? err.stack : undefined,
      });
    } finally {
      setBusyServerId((current) => (current === serverId ? null : current));
    }
  }

  async function handleConnect() {
    let requestServerId: string | null = null;
    setIsConnecting(true);
    setBootError(null);
    try {
      const normalized = normalizeServerInput(serverInput);
      const existing = registry.servers.find(
        (server) => server.apiBaseUrl === normalized.apiBaseUrl && server.id !== editingServerId,
      );
      if (existing) {
        throw new Error(`This server is already saved as ${existing.name}.`);
      }

      const editing = editingServerId && editingServerId !== 'new'
        ? registry.servers.find((server) => server.id === editingServerId) ?? null
        : null;
      const now = new Date().toISOString();
      const draft = editing
        ? {
            ...editing,
            ...normalized,
            savedAt: now,
          }
        : createDesktopServerEntry(
            { ...normalized, savedAt: now, serverVersion: '0.0.0' },
            {
              id: crypto.randomUUID(),
              name: 'Baker',
              now,
              order: registry.servers.length,
            },
          );
      setBusyServerId(draft.id);
      requestServerId = draft.id;
      const outcome = await serverSwitchCoordinatorRef.current.run(
        draft,
        validateServer,
        async (validated) => {
          if (editing && editing.apiBaseUrl !== validated.apiBaseUrl) {
            await window.bakerDesktop?.clearServerSession(editing.id);
          }
          await commitActiveServer(validated, upsertDesktopServer(registry, validated));
        },
      );
      if (outcome.status === 'superseded') return;
      const validated = outcome.value;
      setEditingServerId(null);
      setIsServerManagerOpen(false);
      setServerNotice(t('servers.connected_notice', { server: validated.name }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to Baker server.';
      setBootError(message);
      void window.bakerDesktop?.logError({
        message,
        scope: 'server-connect',
        stack: err instanceof Error ? err.stack : undefined,
      });
    } finally {
      setBusyServerId((current) => (current === requestServerId ? null : current));
      setIsConnecting(false);
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

  function openServerManager() {
    setPendingRemovalId(null);
    setEditingServerId(null);
    setBootError(null);
    setIsServerManagerOpen(true);
  }

  function beginAddServer() {
    setPendingRemovalId(null);
    setEditingServerId('new');
    setServerInput('');
    setBootError(null);
    setIsServerManagerOpen(true);
  }

  function beginEditServer(serverId: string) {
    const server = registry.servers.find((entry) => entry.id === serverId);
    if (!server) return;
    setPendingRemovalId(null);
    setEditingServerId(serverId);
    setServerInput(server.input);
    setBootError(null);
    setIsServerManagerOpen(true);
  }

  function requestRemoveServer(serverId: string) {
    setEditingServerId(null);
    setPendingRemovalId(serverId);
    setIsServerManagerOpen(true);
  }

  async function confirmRemoveServer() {
    if (!pendingRemovalId) return;
    serverSwitchCoordinatorRef.current.cancel();
    const wasActive = registry.activeServerId === pendingRemovalId;
    let nextRegistry = removeDesktopServer(registry, pendingRemovalId);
    await window.bakerDesktop?.clearServerSession(pendingRemovalId);

    if (wasActive) {
      const availableFallback = nextRegistry.servers.find(
        (server) => serverReachability[server.id] === 'available',
      );
      if (availableFallback) {
        nextRegistry = { ...nextRegistry, activeServerId: availableFallback.id };
      }
      useGatewayStore.getState().disconnect();
      useChatStore.getState().reset();
      useAuthStore.getState().clearRuntimeSession();
    }

    const saved = (await window.bakerDesktop?.saveServerRegistry(nextRegistry)) ?? nextRegistry;
    setRegistry(saved);
    setPendingRemovalId(null);

    if (!wasActive) return;
    const fallback = saved.servers.find((server) => server.id === saved.activeServerId) ?? null;
    setServerConfig(fallback);
    setServerInput(fallback?.input ?? '');
    setServerVersionWarning(null);
    if (fallback) {
      setPhase('app');
      setIsServerManagerOpen(false);
    } else {
      setPhase('setup');
      setEditingServerId('new');
    }
  }

  const authSessionPersistence = useMemo(
    () =>
      serverConfig
        ? createDesktopAuthSessionPersistence(serverConfig.id, () => {
            setSessionSecurityWarning(
              'Windows secure storage is unavailable. Sign-in sessions will only be kept until Baker closes.',
            );
          })
        : undefined,
    [serverConfig],
  );

  function railState(serverId: string): ServerRailConnectionState {
    if (serverId === registry.activeServerId) {
      if (gatewayStatus === 'ready') return 'connected';
      if (
        gatewayStatus === 'connecting' ||
        gatewayStatus === 'authenticating' ||
        gatewayStatus === 'reconnecting'
      ) {
        return 'connecting';
      }
      if (gatewayStatus === 'error') return 'error';
    }
    const reachability = serverReachability[serverId];
    if (reachability === 'available') return 'available';
    if (reachability === 'unavailable') return 'unavailable';
    return 'connecting';
  }

  const serverSwitcher: ServerSwitcherModel = {
    activeServerId: registry.activeServerId,
    busyServerId,
    entries: registry.servers.map((server) => ({
      address: server.apiBaseUrl,
      id: server.id,
      name: server.name,
      state: railState(server.id),
    })),
    onAdd: beginAddServer,
    onEdit: beginEditServer,
    onManage: openServerManager,
    onRemove: requestRemoveServer,
    onRetry: (serverId) => void selectServer(serverId),
    onSelect: (serverId) => void selectServer(serverId),
  };

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
  const pendingRemovalServer = registry.servers.find((server) => server.id === pendingRemovalId) ?? null;
  const desktopServerManagerOverlay = isServerManagerOpen ? (
    <div
      className="desktop-server-manager-backdrop"
      role="presentation"
      onClick={() => {
        if (!isConnecting) setIsServerManagerOpen(false);
      }}
    >
      <section
        className="desktop-server-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-server-manager-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="desktop-server-manager-header">
          <div>
            <p className="desktop-boot-eyebrow">Baker Desktop</p>
            <h2 id="desktop-server-manager-title">{t('servers.manager_title')}</h2>
            <p>{t('servers.manager_description')}</p>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setIsServerManagerOpen(false)}
            disabled={isConnecting}
          >
            {t('servers.close')}
          </button>
        </header>

        <div className="desktop-server-manager-list">
          {registry.servers.map((server) => (
            <div
              key={server.id}
              className={`desktop-server-manager-row${registry.activeServerId === server.id ? ' active' : ''}`}
            >
              <button
                type="button"
                className="desktop-server-manager-main"
                onClick={() => void selectServer(server.id)}
                disabled={Boolean(busyServerId)}
              >
                <span className={`desktop-server-manager-dot desktop-server-manager-dot--${railState(server.id)}`} />
                <span>
                  <strong>{server.name}</strong>
                  <small>{server.apiBaseUrl}</small>
                </span>
                {registry.activeServerId === server.id ? <em>{t('servers.current')}</em> : null}
              </button>
              <div className="desktop-server-manager-actions">
                <button type="button" onClick={() => beginEditServer(server.id)}>
                  {t('common.edit')}
                </button>
                <button type="button" className="danger" onClick={() => requestRemoveServer(server.id)}>
                  {t('servers.remove_short')}
                </button>
              </div>
            </div>
          ))}
          {registry.servers.length === 0 ? (
            <p className="desktop-server-manager-empty">{t('servers.empty')}</p>
          ) : null}
        </div>

        {pendingRemovalServer ? (
          <div className="desktop-server-remove-confirm" role="alert">
            <div>
              <strong>{t('servers.remove_confirm_title', { server: pendingRemovalServer.name })}</strong>
              <span>{t('servers.remove_confirm_copy')}</span>
            </div>
            <div>
              <button type="button" className="btn-ghost" onClick={() => setPendingRemovalId(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn-primary danger" onClick={() => void confirmRemoveServer()}>
                {t('servers.remove')}
              </button>
            </div>
          </div>
        ) : null}

        {editingServerId ? (
          <form
            className="desktop-server-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void handleConnect();
            }}
          >
            <label className="desktop-server-field">
              <span>{editingServerId === 'new' ? t('servers.add') : t('servers.edit_address')}</span>
              <input
                type="text"
                value={serverInput}
                onChange={(event) => setServerInput(event.target.value)}
                placeholder="example.com or 192.168.1.10:3323"
                autoFocus
              />
              <small>{t('servers.address_hint')}</small>
            </label>
            {bootError ? <p className="desktop-boot-error">{bootError}</p> : null}
            <div className="desktop-server-editor-actions">
              <button type="button" className="btn-ghost" onClick={() => setEditingServerId(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn-primary" disabled={isConnecting}>
                {isConnecting
                  ? t('servers.checking')
                  : editingServerId === 'new'
                    ? t('servers.add_and_connect')
                    : t('servers.save_and_connect')}
              </button>
            </div>
          </form>
        ) : (
          <footer className="desktop-server-manager-footer">
            <button type="button" className="btn-primary" onClick={beginAddServer}>
              {t('servers.add')}
            </button>
          </footer>
        )}
      </section>
    </div>
  ) : null;
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
            key={serverConfig.id}
            apiBaseUrl={serverConfig.apiBaseUrl}
            authSessionPersistence={authSessionPersistence}
            authSessionScope={`desktop:${serverConfig.id}`}
            desktopUpdateAction={updateAction}
            gatewayUrl={serverConfig.gatewayUrl}
            onChangeServer={openServerManager}
            platformApi={platformApi}
            serverSwitcher={serverSwitcher}
            versionWarning={warning}
          />
          {desktopServerManagerOverlay}
          {serverNotice ? (
            <div className="desktop-server-notice" role="status">
              <span>{serverNotice}</span>
              <button type="button" onClick={() => setServerNotice(null)} aria-label="Dismiss">
                ×
              </button>
            </div>
          ) : null}
          {sessionSecurityWarning ? (
            <div className="desktop-session-warning" role="status">
              <span>{sessionSecurityWarning}</span>
              <button type="button" onClick={() => setSessionSecurityWarning(null)} aria-label="Dismiss">
                ×
              </button>
            </div>
          ) : null}
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
