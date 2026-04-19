import { useEffect, useMemo, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import type { PublicServerConfig } from '@baker/protocol';
import { createApiClient } from '@baker/sdk';

import { i18n } from '../i18n';
import { LoginView } from '../features/auth/LoginView';
import { useAuthStore } from '../features/auth/auth-store';
import { ChatShell } from '../features/chat/ChatShell';
import { useGatewayStore } from '../features/gateway/gateway-store';
import type { PlatformApi } from '../platform/platform-api';

import { deriveDefaultApiBaseUrl, deriveDefaultGatewayUrl } from './derive-default-urls';

export interface AppRootProps {
  apiBaseUrl?: string;
  gatewayUrl?: string;
  mediaBaseUrl?: string;
  platformApi: PlatformApi;
}

export function AppRoot(props: AppRootProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <AppRootContent {...props} />
    </I18nextProvider>
  );
}

function AppRootContent({
  apiBaseUrl,
  gatewayUrl,
  platformApi: _platformApi,
}: AppRootProps) {
  const { t } = useTranslation();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  const rehydrate = useAuthStore((s) => s.rehydrate);
  const bootstrapSession = useAuthStore((s) => s.bootstrapSession);
  const connect = useGatewayStore((s) => s.connect);
  const disconnect = useGatewayStore((s) => s.disconnect);
  const gatewayStatus = useGatewayStore((s) => s.status);

  const [publicConfig, setPublicConfig] = useState<PublicServerConfig | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

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
    rehydrate();
  }, [rehydrate]);

  useEffect(() => {
    void bootstrapSession(api);
  }, [api, bootstrapSession]);

  useEffect(() => {
    let cancelled = false;

    const fallbackConfig: PublicServerConfig = {
      allowPublicRegistration: true,
      appPort: 5174,
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
    if (accessToken && !isBootstrapping) {
      if (gatewayStatus === 'disconnected' || gatewayStatus === 'error') {
        connect(api, resolvedGatewayUrl);
      }
    } else {
      disconnect();
    }
    // api is stable (memoized); gatewayStatus intentionally omitted to avoid reconnect loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, api, isBootstrapping, resolvedGatewayUrl]);

  if (!publicConfig) {
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
    return <LoginView api={api} publicConfig={publicConfig} bootstrapError={bootstrapError} />;
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

  return <ChatShell api={api} gatewayUrl={resolvedGatewayUrl} serverName={publicConfig.serverName} />;
}
