import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import type { PublicServerConfig } from '@baker/protocol';
import { createApiClient } from '@baker/sdk';

import { i18n } from '../i18n';
import { LoginView } from '../features/auth/LoginView';
import {
  createBrowserAuthSessionPersistence,
  type AuthSessionPersistence,
  useAuthStore,
} from '../features/auth/auth-store';
import { ChatShell } from '../features/chat/ChatShell';
import type { ServerSwitcherModel } from '../features/chat/ServerList';
import { ServerList } from '../features/chat/ServerList';
import { useGatewayStore } from '../features/gateway/gateway-store';
import type { PlatformApi } from '../platform/platform-api';

import { deriveDefaultApiBaseUrl, deriveDefaultGatewayUrl } from './derive-default-urls';

export interface AppRootProps {
  apiBaseUrl?: string;
  authSessionPersistence?: AuthSessionPersistence;
  authSessionScope?: string;
  desktopUpdateAction?: ReactNode;
  gatewayUrl?: string;
  mediaBaseUrl?: string;
  onChangeServer?: () => void;
  platformApi: PlatformApi;
  serverSwitcher?: ServerSwitcherModel;
  versionWarning?: string | null;
}

export function AppRoot(props: AppRootProps) {
  const content = <AppRootContent {...props} />;
  return (
    <I18nextProvider i18n={i18n}>
      {props.serverSwitcher ? (
        <div className="desktop-server-app-shell">
          <ServerList model={props.serverSwitcher} />
          <div className="desktop-server-app-content">{content}</div>
        </div>
      ) : (
        content
      )}
    </I18nextProvider>
  );
}

function AppRootContent({
  apiBaseUrl,
  authSessionPersistence,
  authSessionScope = 'web',
  desktopUpdateAction,
  gatewayUrl,
  onChangeServer,
  platformApi,
  serverSwitcher,
  versionWarning,
}: AppRootProps) {
  const { t } = useTranslation();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  const activateSessionPersistence = useAuthStore((s) => s.activateSessionPersistence);
  const bootstrapSession = useAuthStore((s) => s.bootstrapSession);
  const connect = useGatewayStore((s) => s.connect);
  const disconnect = useGatewayStore((s) => s.disconnect);
  const gatewayStatus = useGatewayStore((s) => s.status);

  const [publicConfig, setPublicConfig] = useState<PublicServerConfig | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const browserSessionPersistence = useMemo(() => createBrowserAuthSessionPersistence(), []);
  const resolvedSessionPersistence = authSessionPersistence ?? browserSessionPersistence;

  const resolvedApiBaseUrl = useMemo(() => {
    const trimmedProp = apiBaseUrl?.trim();
    if (trimmedProp) return trimmedProp.replace(/\/$/, '');
    if (typeof window === 'undefined') return 'http://localhost:3001';

    // Prefer same-origin in browsers so dev/prod can run behind a reverse-proxy.
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      return window.location.origin;
    }

    // Desktop prod (file://) or other non-http contexts.
    return deriveDefaultApiBaseUrl(window.location);
  }, [apiBaseUrl]);

  const resolvedGatewayUrl = useMemo(() => {
    const trimmedProp = gatewayUrl?.trim();
    if (trimmedProp) return trimmedProp;
    if (typeof window === 'undefined') return 'ws://localhost:3002/ws';
    return deriveDefaultGatewayUrl(window.location);
  }, [gatewayUrl]);

  const api = useMemo(
    () => createApiClient(resolvedApiBaseUrl, { getAccessToken: () => useAuthStore.getState().accessToken }),
    [resolvedApiBaseUrl],
  );

  useEffect(() => {
    let cancelled = false;
    setSessionReady(false);

    void (async () => {
      try {
        await activateSessionPersistence(authSessionScope, resolvedSessionPersistence);
        if (cancelled || useAuthStore.getState().sessionScope !== authSessionScope) return;
        await bootstrapSession(api);
      } finally {
        if (!cancelled && useAuthStore.getState().sessionScope === authSessionScope) {
          setSessionReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activateSessionPersistence, api, authSessionScope, bootstrapSession, resolvedSessionPersistence]);

  useEffect(() => {
    let cancelled = false;

    const fallbackConfig: PublicServerConfig = {
      allowPublicRegistration: true,
      appPort: 5174,
      mediaMode: 'p2p',
      serverName: 'Baker',
      webEnabled: true,
      webPort: 80,
    };

    void api
      .getPublicServerConfig()
      .then((config) => {
        if (!cancelled) {
          setPublicConfig(config);
          setBootstrapError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPublicConfig(fallbackConfig);
          setBootstrapError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (sessionReady && accessToken && !isBootstrapping) {
      if (gatewayStatus === 'disconnected' || gatewayStatus === 'error') {
        connect(api, resolvedGatewayUrl);
      }
    } else {
      disconnect();
    }
    // api is stable (memoized); gatewayStatus intentionally omitted to avoid reconnect loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, api, isBootstrapping, resolvedGatewayUrl, sessionReady]);

  if (!publicConfig || !sessionReady) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1 className="login-title">{t('app.loading_server')}</h1>
          {bootstrapError ? <p className="login-error">{bootstrapError}</p> : null}
        </div>
      </div>
    );
  }

  if (!publicConfig.webEnabled) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-branding">
            <p className="login-eyebrow">{t('common.server')}</p>
            <h1 className="login-title">{publicConfig.serverName}</h1>
          </div>
          <p className="login-copy">{t('app.web_access_disabled')}</p>
        </div>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <LoginView
        allowRememberCredentials={platformApi.name === 'web'}
        api={api}
        bootstrapError={bootstrapError}
        desktopUpdateAction={desktopUpdateAction}
        publicConfig={publicConfig}
      />
    );
  }

  if (isBootstrapping) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <h1 className="login-title">{t('gateway.authenticating')}</h1>
        </div>
      </div>
    );
  }

  return (
    <ChatShell
      api={api}
      gatewayUrl={resolvedGatewayUrl}
      hideGuildList={Boolean(serverSwitcher)}
      onChangeServer={onChangeServer}
      serverName={publicConfig.serverName}
      versionWarning={versionWarning}
    />
  );
}
