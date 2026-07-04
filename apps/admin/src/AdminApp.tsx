import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  AdminDeploymentSettings,
  AdminRuntimeHealth,
  AdminRuntimePublicIpSettings,
  AdminRuntimeRepairResult,
  AdminRuntimeSelfRepairSettings,
  AdminServerSettings,
  AdminUpdateJobStatus,
  AdminUpdateProxySettings,
  AdminUpdateVersionsResponse,
  AdminWorkspaceState,
  ChannelSummary,
} from '@baker/protocol';
import {
  AdminDeploymentSettingsSchema,
  AdminDeleteChannelResponseSchema,
  AdminRuntimeHealthSchema,
  AdminRuntimePublicIpCheckResultSchema,
  AdminRuntimePublicIpSettingsSchema,
  AdminRuntimeRepairResultSchema,
  AdminRuntimeSelfRepairSettingsSchema,
  AdminServerSettingsSchema,
  AdminUpdateJobStatusSchema,
  AdminUpdateProxySettingsSchema,
  AdminUpdateVersionsResponseSchema,
  AdminVerifyPasswordResponseSchema,
  AdminWorkspaceStateSchema,
  AuthUserSchema,
  ChannelSummarySchema,
} from '@baker/protocol';

import { LanguageSwitcher } from './i18n/LanguageSwitcher';

interface AdminAppProps {
  apiBaseUrl?: string;
}

function normalizeApiOrigin(apiBaseUrl?: string): string {
  const trimmed = (apiBaseUrl ?? '').trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).toString().replace(/\/$/, '');
  } catch {
    // Allow relative-ish values by resolving against the current origin.
    try {
      return new URL(trimmed, window.location.origin)
        .toString()
        .replace(/\/$/, '');
    } catch {
      return '';
    }
  }
}

export function AdminApp({ apiBaseUrl = '' }: AdminAppProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AdminServerSettings | null>(null);
  const [workspace, setWorkspace] = useState<AdminWorkspaceState | null>(null);
  const [deployment, setDeployment] = useState<AdminDeploymentSettings | null>(
    null,
  );
  const [runtimeHealth, setRuntimeHealth] = useState<AdminRuntimeHealth | null>(
    null,
  );
  const [runtimeRepairResult, setRuntimeRepairResult] =
    useState<AdminRuntimeRepairResult | null>(null);
  const [selfRepair, setSelfRepair] =
    useState<AdminRuntimeSelfRepairSettings | null>(null);
  const [publicIp, setPublicIp] = useState<AdminRuntimePublicIpSettings | null>(
    null,
  );
  const [updateProxy, setUpdateProxy] =
    useState<AdminUpdateProxySettings | null>(null);
  const [updateVersions, setUpdateVersions] =
    useState<AdminUpdateVersionsResponse | null>(null);
  const [selectedUpdateTag, setSelectedUpdateTag] = useState('');
  const [updateStatus, setUpdateStatus] = useState<AdminUpdateJobStatus | null>(
    null,
  );
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);

  const [serverName, setServerName] = useState('Baker');
  const [allowPublicRegistration, setAllowPublicRegistration] = useState(true);
  const [webEnabled, setWebEnabled] = useState(true);
  const [webPort, setWebPort] = useState('80');
  const [appPort, setAppPort] = useState('5174');
  const [mediaMode, setMediaMode] = useState<'p2p' | 'sfu'>('p2p');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  const [webHostPort, setWebHostPort] = useState('3000');
  const [adminHostPort, setAdminHostPort] = useState('3001');
  const [allowedHosts, setAllowedHosts] = useState('');
  const [stunUrls, setStunUrls] = useState('');
  const [turnEnabled, setTurnEnabled] = useState(false);
  const [turnUrls, setTurnUrls] = useState('');
  const [turnUsername, setTurnUsername] = useState('');
  const [turnPassword, setTurnPassword] = useState('');
  const [turnExternalIp, setTurnExternalIp] = useState('');
  const [turnRealm, setTurnRealm] = useState('baker');
  const [turnPort, setTurnPort] = useState('3478');
  const [turnMinPort, setTurnMinPort] = useState('49160');
  const [turnMaxPort, setTurnMaxPort] = useState('49200');
  const [sfuAnnouncedIp, setSfuAnnouncedIp] = useState('');
  const [sfuEnableTcp, setSfuEnableTcp] = useState(true);
  const [sfuRtcMinPort, setSfuRtcMinPort] = useState('50000');
  const [sfuRtcMaxPort, setSfuRtcMaxPort] = useState('50100');
  const [selfRepairEnabled, setSelfRepairEnabled] = useState(false);
  const [selfRepairIntervalSeconds, setSelfRepairIntervalSeconds] =
    useState('60');
  const [selfRepairAllowContainerRepair, setSelfRepairAllowContainerRepair] =
    useState(true);
  const [publicIpEnabled, setPublicIpEnabled] = useState(false);
  const [publicIpIntervalSeconds, setPublicIpIntervalSeconds] = useState('300');
  const [updateProxyEnabled, setUpdateProxyEnabled] = useState(false);
  const [updateProxyUrl, setUpdateProxyUrl] = useState('');

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');

  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>(
    'text',
  );
  const [newChannelVoiceQuality, setNewChannelVoiceQuality] = useState<
    'high' | 'standard'
  >('standard');

  const apiOrigin = useMemo(() => normalizeApiOrigin(apiBaseUrl), [apiBaseUrl]);
  const channelTypeCounts = useMemo(
    () =>
      (workspace?.channels ?? []).reduce(
        (counts, channel) => {
          counts[channel.type] += 1;
          return counts;
        },
        { text: 0, voice: 0 },
      ),
    [workspace],
  );

  function applyDeploymentSettingsToForm(
    nextDeployment: AdminDeploymentSettings,
  ) {
    setWebHostPort(String(nextDeployment.webHostPort));
    setAdminHostPort(String(nextDeployment.adminHostPort));
    setAllowedHosts(nextDeployment.allowedHosts);
    setStunUrls(nextDeployment.stunUrls);
    setTurnEnabled(nextDeployment.turnEnabled);
    setTurnUrls(nextDeployment.turnUrls);
    setTurnUsername(nextDeployment.turnUsername);
    setTurnPassword('');
    setTurnExternalIp(nextDeployment.turnExternalIp);
    setTurnRealm(nextDeployment.turnRealm);
    setTurnPort(String(nextDeployment.turnPort));
    setTurnMinPort(String(nextDeployment.turnMinPort));
    setTurnMaxPort(String(nextDeployment.turnMaxPort));
    setSfuAnnouncedIp(nextDeployment.sfuAnnouncedIp);
    setSfuEnableTcp(nextDeployment.sfuEnableTcp);
    setSfuRtcMinPort(String(nextDeployment.sfuRtcMinPort));
    setSfuRtcMaxPort(String(nextDeployment.sfuRtcMaxPort));
  }

  function applySelfRepairSettingsToForm(
    nextSelfRepair: AdminRuntimeSelfRepairSettings,
  ) {
    setSelfRepairEnabled(nextSelfRepair.enabled);
    setSelfRepairIntervalSeconds(String(nextSelfRepair.intervalSeconds));
    setSelfRepairAllowContainerRepair(nextSelfRepair.allowContainerRepair);
  }

  function applyPublicIpSettingsToForm(
    nextPublicIp: AdminRuntimePublicIpSettings,
  ) {
    setPublicIpEnabled(nextPublicIp.enabled);
    setPublicIpIntervalSeconds(String(nextPublicIp.intervalSeconds));
  }

  function applyUpdateProxySettingsToForm(
    nextUpdateProxy: AdminUpdateProxySettings,
  ) {
    setUpdateProxyEnabled(nextUpdateProxy.enabled);
    setUpdateProxyUrl(nextUpdateProxy.proxyUrl);
  }

  const request = useCallback(
    async <T,>(
      path: string,
      init: RequestInit,
      schema: { parse(data: unknown): T },
      includePassword = true,
    ): Promise<T> => {
      const response = await fetch(`${apiOrigin}${path}`, {
        ...init,
        headers: {
          ...(init.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...(includePassword && password
            ? { 'x-admin-password': password }
            : {}),
          ...(init.headers ?? {}),
        },
      });

      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();

      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // ignore; we handle below
      }

      if (json === null) {
        const startsWith = text
          ? JSON.stringify(text.slice(0, 120))
          : '(empty)';
        throw new Error(
          `Invalid JSON response from server (HTTP ${response.status}, content-type: ${contentType || 'unknown'}). Body starts with: ${startsWith}`,
        );
      }

      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'message' in json
            ? String((json as Record<string, unknown>).message)
            : `HTTP ${response.status}`;
        throw new Error(message);
      }

      return schema.parse(json);
    },
    [apiOrigin, password],
  );

  async function loadDashboard() {
    const [
      nextSettings,
      nextWorkspace,
      nextDeployment,
      nextUpdateStatus,
      nextRuntimeHealth,
      nextSelfRepair,
      nextPublicIp,
      nextUpdateProxy,
    ] = await Promise.all([
      request(
        '/v1/admin/settings',
        { method: 'GET' },
        AdminServerSettingsSchema,
      ),
      request(
        '/v1/admin/workspace',
        { method: 'GET' },
        AdminWorkspaceStateSchema,
      ),
      request(
        '/v1/admin/deployment/settings',
        { method: 'GET' },
        AdminDeploymentSettingsSchema,
      ),
      request(
        '/v1/admin/updates/status',
        { method: 'GET' },
        AdminUpdateJobStatusSchema,
      ),
      request(
        '/v1/admin/runtime/health',
        { method: 'GET' },
        AdminRuntimeHealthSchema,
      ),
      request(
        '/v1/admin/runtime/self-repair',
        { method: 'GET' },
        AdminRuntimeSelfRepairSettingsSchema,
      ),
      request(
        '/v1/admin/runtime/public-ip',
        { method: 'GET' },
        AdminRuntimePublicIpSettingsSchema,
      ),
      request(
        '/v1/admin/updates/proxy',
        { method: 'GET' },
        AdminUpdateProxySettingsSchema,
      ),
    ]);

    setSettings(nextSettings);
    setWorkspace(nextWorkspace);
    setDeployment(nextDeployment);
    setUpdateStatus(nextUpdateStatus);
    setRuntimeHealth(nextRuntimeHealth);
    setRuntimeRepairResult(nextRuntimeHealth.lastRepair);
    setSelfRepair(nextSelfRepair);
    setPublicIp(nextPublicIp);
    setUpdateProxy(nextUpdateProxy);
    setServerName(nextSettings.serverName);
    setAllowPublicRegistration(nextSettings.allowPublicRegistration);
    setWebEnabled(nextSettings.webEnabled);
    setWebPort(String(nextSettings.webPort));
    setAppPort(String(nextSettings.appPort));
    setMediaMode(nextSettings.mediaMode);
    applyDeploymentSettingsToForm(nextDeployment);
    applySelfRepairSettingsToForm(nextSelfRepair);
    applyPublicIpSettingsToForm(nextPublicIp);
    applyUpdateProxySettingsToForm(nextUpdateProxy);
  }

  const refreshRuntimeHealth = useCallback(async () => {
    const nextRuntimeHealth = await request(
      '/v1/admin/runtime/health',
      { method: 'GET' },
      AdminRuntimeHealthSchema,
    );
    setRuntimeHealth(nextRuntimeHealth);
    setRuntimeRepairResult(nextRuntimeHealth.lastRepair);
    return nextRuntimeHealth;
  }, [request]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRuntimeHealth().catch((err) => {
        setError(
          err instanceof Error ? err.message : t('admin.error_runtime_health'),
        );
      });
    }, 10_000);

    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, refreshRuntimeHealth, t]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await request(
        '/v1/admin/auth/verify',
        {
          body: JSON.stringify({ password }),
          method: 'POST',
        },
        AdminVerifyPasswordResponseSchema,
        false,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_login_failed'),
      );
      setIsAuthenticated(false);
      setIsLoading(false);
      return;
    }

    setIsAuthenticated(true);

    try {
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_load_dashboard'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const nextSettings = await request(
        '/v1/admin/settings',
        {
          body: JSON.stringify({
            adminPassword: newAdminPassword || undefined,
            allowPublicRegistration,
            appPort: Number(appPort),
            mediaMode,
            serverName,
            webEnabled,
            webPort: Number(webPort),
          }),
          method: 'PATCH',
        },
        AdminServerSettingsSchema,
      );
      if (newAdminPassword) {
        setPassword(newAdminPassword);
      }
      setSettings(nextSettings);
      setNewAdminPassword('');
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_save_settings'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCheckVersions() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await request(
        '/v1/admin/updates/versions',
        { method: 'GET' },
        AdminUpdateVersionsResponseSchema,
      );
      setUpdateVersions(response);
      setSelectedUpdateTag(
        (current) => current || response.versions[0]?.tag || '',
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_check_versions'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveUpdateProxy(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const nextUpdateProxy = await request(
        '/v1/admin/updates/proxy',
        {
          body: JSON.stringify({
            enabled: updateProxyEnabled,
            proxyUrl: updateProxyEnabled ? updateProxyUrl : '',
          }),
          method: 'PATCH',
        },
        AdminUpdateProxySettingsSchema,
      );
      setUpdateProxy(nextUpdateProxy);
      applyUpdateProxySettingsToForm(nextUpdateProxy);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_save_update_proxy'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshUpdateStatus() {
    const nextStatus = await request(
      '/v1/admin/updates/status',
      { method: 'GET' },
      AdminUpdateJobStatusSchema,
    );
    setUpdateStatus(nextStatus);
    return nextStatus;
  }

  async function handleStartUpdate() {
    if (!selectedUpdateTag) {
      setError(t('admin.error_select_version'));
      return;
    }

    if (
      !window.confirm(
        t('admin.confirm_start_update', { tag: selectedUpdateTag }),
      )
    ) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const status = await request(
        '/v1/admin/updates/apply',
        {
          body: JSON.stringify({ tag: selectedUpdateTag }),
          method: 'POST',
        },
        AdminUpdateJobStatusSchema,
      );
      setUpdateStatus(status);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_start_update'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveDeploymentSettings(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const nextDeployment = await request(
        '/v1/admin/deployment/settings',
        {
          body: JSON.stringify({
            adminHostPort: Number(adminHostPort),
            allowedHosts,
            sfuAnnouncedIp,
            sfuEnableTcp,
            sfuRtcMaxPort: Number(sfuRtcMaxPort),
            sfuRtcMinPort: Number(sfuRtcMinPort),
            stunUrls,
            turnEnabled,
            turnExternalIp,
            turnMaxPort: Number(turnMaxPort),
            turnMinPort: Number(turnMinPort),
            turnPassword: turnPassword || undefined,
            turnPort: Number(turnPort),
            turnRealm,
            turnUrls,
            turnUsername,
            webHostPort: Number(webHostPort),
          }),
          method: 'PATCH',
        },
        AdminDeploymentSettingsSchema,
      );
      setDeployment(nextDeployment);
      applyDeploymentSettingsToForm(nextDeployment);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_save_deployment'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleApplyDeployment() {
    if (!window.confirm(t('admin.confirm_apply_deployment'))) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const status = await request(
        '/v1/admin/deployment/apply',
        { method: 'POST' },
        AdminUpdateJobStatusSchema,
      );
      setUpdateStatus(status);
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_apply_deployment'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRepairRuntime() {
    if (!window.confirm(t('admin.confirm_runtime_repair'))) {
      return;
    }

    setIsRuntimeLoading(true);
    setError(null);

    try {
      const result = await request(
        '/v1/admin/runtime/repair',
        {
          body: JSON.stringify({
            allowContainerRepair: selfRepairAllowContainerRepair,
          }),
          method: 'POST',
        },
        AdminRuntimeRepairResultSchema,
      );
      setRuntimeRepairResult(result);
      await refreshRuntimeHealth();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_runtime_repair'),
      );
    } finally {
      setIsRuntimeLoading(false);
    }
  }

  async function handleSaveSelfRepair(event: React.FormEvent) {
    event.preventDefault();
    setIsRuntimeLoading(true);
    setError(null);

    try {
      const nextSelfRepair = await request(
        '/v1/admin/runtime/self-repair',
        {
          body: JSON.stringify({
            allowContainerRepair: selfRepairAllowContainerRepair,
            enabled: selfRepairEnabled,
            intervalSeconds: Number(selfRepairIntervalSeconds),
          }),
          method: 'PATCH',
        },
        AdminRuntimeSelfRepairSettingsSchema,
      );
      setSelfRepair(nextSelfRepair);
      applySelfRepairSettingsToForm(nextSelfRepair);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_save_self_repair'),
      );
    } finally {
      setIsRuntimeLoading(false);
    }
  }

  async function handleSavePublicIp(event: React.FormEvent) {
    event.preventDefault();
    setIsRuntimeLoading(true);
    setError(null);

    try {
      const nextPublicIp = await request(
        '/v1/admin/runtime/public-ip',
        {
          body: JSON.stringify({
            enabled: publicIpEnabled,
            intervalSeconds: Number(publicIpIntervalSeconds),
          }),
          method: 'PATCH',
        },
        AdminRuntimePublicIpSettingsSchema,
      );
      setPublicIp(nextPublicIp);
      applyPublicIpSettingsToForm(nextPublicIp);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_save_public_ip'),
      );
    } finally {
      setIsRuntimeLoading(false);
    }
  }

  async function handleCheckPublicIp() {
    setIsRuntimeLoading(true);
    setError(null);

    try {
      const result = await request(
        '/v1/admin/runtime/public-ip/check',
        { method: 'POST' },
        AdminRuntimePublicIpCheckResultSchema,
      );
      setPublicIp(result.settings);
      applyPublicIpSettingsToForm(result.settings);
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_check_public_ip'),
      );
    } finally {
      setIsRuntimeLoading(false);
    }
  }

  async function handleCreateUser(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await request(
        '/v1/admin/users',
        {
          body: JSON.stringify({
            email: newUserEmail,
            password: newUserPassword,
            username: newUserUsername,
          }),
          method: 'POST',
        },
        AuthUserSchema,
      );
      setNewUserEmail('');
      setNewUserUsername('');
      setNewUserPassword('');
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_create_user'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateChannel(event: React.FormEvent) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await request(
        '/v1/admin/channels',
        {
          body: JSON.stringify({
            name: newChannelName,
            type: newChannelType,
            voiceQuality:
              newChannelType === 'voice' ? newChannelVoiceQuality : 'standard',
          }),
          method: 'POST',
        },
        ChannelSummarySchema,
      );
      setNewChannelName('');
      setNewChannelType('text');
      setNewChannelVoiceQuality('standard');
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_create_channel'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveChannel(channel: ChannelSummary) {
    const nameInput = document.getElementById(
      `channel-name-${channel.id}`,
    ) as HTMLInputElement | null;
    const qualityInput = document.getElementById(
      `channel-quality-${channel.id}`,
    ) as HTMLSelectElement | null;

    setIsLoading(true);
    setError(null);

    try {
      await request(
        `/v1/admin/channels/${channel.id}`,
        {
          body: JSON.stringify({
            name: nameInput?.value ?? channel.name,
            voiceQuality:
              channel.type === 'voice'
                ? (qualityInput?.value ?? channel.voiceQuality)
                : channel.voiceQuality,
          }),
          method: 'PATCH',
        },
        ChannelSummarySchema,
      );
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_update_channel'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  function getDeleteBlockReason(channel: ChannelSummary) {
    if (channel.type === 'text' && channelTypeCounts.text <= 1) {
      return t('admin.delete_channel_blocked_last_text');
    }

    if (channel.type === 'voice' && channelTypeCounts.voice <= 1) {
      return t('admin.delete_channel_blocked_last_voice');
    }

    return null;
  }

  async function handleDeleteChannel(channel: ChannelSummary) {
    const blockedReason = getDeleteBlockReason(channel);
    if (blockedReason) {
      setError(blockedReason);
      return;
    }

    if (
      !window.confirm(t('admin.confirm_delete_channel', { name: channel.name }))
    ) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await request(
        `/v1/admin/channels/${channel.id}`,
        {
          method: 'DELETE',
        },
        AdminDeleteChannelResponseSchema,
      );
      await loadDashboard();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.error_delete_channel'),
      );
    } finally {
      setIsLoading(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="admin-shell">
        <div className="admin-login-card">
          <p className="admin-eyebrow">Baker</p>
          <h1>{t('admin.title')}</h1>
          <p className="admin-copy">{t('admin.login_copy')}</p>
          <form className="admin-form" onSubmit={handleLogin}>
            <label className="admin-field">
              <span>{t('admin.management_password')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={1}
                required
              />
            </label>
            {error ? <p className="admin-error">{error}</p> : null}
            <button
              type="submit"
              className="admin-primary-btn"
              disabled={isLoading}
            >
              {isLoading ? t('admin.checking') : t('admin.open_control_panel')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell admin-shell--dashboard">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">Baker</p>
          <h1>{t('admin.title')}</h1>
          <p className="admin-copy">{t('admin.dashboard_copy')}</p>
        </div>
        <div className="admin-header-actions">
          <LanguageSwitcher className="admin-language-switcher" />
          <button
            type="button"
            className="admin-secondary-btn"
            onClick={() => {
              setIsAuthenticated(false);
              setPassword('');
            }}
          >
            {t('common.sign_out')}
          </button>
        </div>
      </header>

      {error ? (
        <p className="admin-error admin-error--inline">{error}</p>
      ) : null}

      <div className="admin-grid">
        <section className="admin-card">
          <h2>{t('admin.server_settings')}</h2>
          <form className="admin-form" onSubmit={handleSaveSettings}>
            <label className="admin-field">
              <span>{t('admin.server_name')}</span>
              <input
                value={serverName}
                onChange={(event) => setServerName(event.target.value)}
                required
              />
            </label>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={allowPublicRegistration}
                  onChange={(event) =>
                    setAllowPublicRegistration(event.target.checked)
                  }
                />{' '}
                {t('admin.allow_public_registration')}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={webEnabled}
                  onChange={(event) => setWebEnabled(event.target.checked)}
                />{' '}
                {t('admin.enable_web_client')}
              </label>
            </div>
            <div className="admin-inline-grid">
              <label className="admin-field">
                <span>{t('admin.web_port')}</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={webPort}
                  onChange={(event) => setWebPort(event.target.value)}
                  required
                />
              </label>
              <label className="admin-field">
                <span>{t('admin.app_port')}</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={appPort}
                  onChange={(event) => setAppPort(event.target.value)}
                  required
                />
              </label>
            </div>
            <label className="admin-field">
              <span>{t('admin.media_mode')}</span>
              <select
                value={mediaMode}
                onChange={(event) =>
                  setMediaMode(event.target.value as 'p2p' | 'sfu')
                }
              >
                <option value="p2p">{t('admin.media_mode_p2p')}</option>
                <option value="sfu">{t('admin.media_mode_sfu')}</option>
              </select>
            </label>
            {mediaMode === 'sfu' ? (
              <p className="admin-channel-hint">
                {t('admin.media_mode_sfu_hint')}
              </p>
            ) : null}
            <label className="admin-field">
              <span>{t('admin.new_management_password')}</span>
              <input
                type="password"
                minLength={1}
                placeholder={t('admin.new_management_password_placeholder')}
                value={newAdminPassword}
                onChange={(event) => setNewAdminPassword(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="admin-primary-btn"
              disabled={isLoading}
            >
              {t('admin.save_settings')}
            </button>
          </form>
          {settings ? (
            <div className="admin-meta">
              <span>
                {t('admin.current_web_port', {
                  port: String(settings.webPort),
                })}
              </span>
              <span>
                {t('admin.current_app_port', {
                  port: String(settings.appPort),
                })}
              </span>
              <span>
                {t('admin.current_media_mode', {
                  mode: settings.mediaMode.toUpperCase(),
                })}
              </span>
            </div>
          ) : null}
        </section>

        <section className="admin-card">
          <h2>{t('admin.server_updates')}</h2>
          <div className="admin-meta">
            <span>
              {t('admin.current_version', {
                version: updateVersions?.currentVersion ?? 'unknown',
              })}
            </span>
            <span>
              {t('admin.current_image', {
                image:
                  deployment?.currentImage ??
                  updateVersions?.currentImage ??
                  'unknown',
              })}
            </span>
          </div>
          {deployment?.dockerEnabled ? null : (
            <p className="admin-channel-hint">
              {t('admin.docker_socket_unavailable', {
                status:
                  deployment?.dockerStatus ??
                  updateVersions?.dockerStatus ??
                  '',
              })}
            </p>
          )}
          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-secondary-btn"
              onClick={() => void handleCheckVersions()}
              disabled={isLoading}
            >
              {t('admin.check_versions')}
            </button>
            <button
              type="button"
              className="admin-secondary-btn"
              onClick={() => void refreshUpdateStatus()}
              disabled={isLoading}
            >
              {t('admin.refresh_status')}
            </button>
          </div>
          <form className="admin-form" onSubmit={handleSaveUpdateProxy}>
            <p className="admin-copy">{t('admin.update_proxy_copy')}</p>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={updateProxyEnabled}
                  onChange={(event) =>
                    setUpdateProxyEnabled(event.currentTarget.checked)
                  }
                />
                {t('admin.update_proxy_enabled')}
              </label>
            </div>
            <label className="admin-field">
              <span>{t('admin.update_proxy_url')}</span>
              <input
                value={updateProxyUrl}
                onChange={(event) => setUpdateProxyUrl(event.target.value)}
                placeholder="http://127.0.0.1:7890"
                disabled={!updateProxyEnabled}
              />
            </label>
            <div className="admin-inline-actions">
              <button
                type="submit"
                className="admin-secondary-btn"
                disabled={isLoading}
              >
                {t('admin.save_update_proxy')}
              </button>
            </div>
            {updateProxy ? (
              <p className="admin-copy">
                {t('admin.update_proxy_saved_at', {
                  time: updateProxy.updatedAt,
                })}
              </p>
            ) : null}
          </form>
          <label className="admin-field">
            <span>{t('admin.target_version')}</span>
            <select
              value={selectedUpdateTag}
              onChange={(event) => setSelectedUpdateTag(event.target.value)}
              disabled={!updateVersions}
            >
              <option value="">{t('admin.target_version_placeholder')}</option>
              {(updateVersions?.versions ?? []).map((version) => (
                <option key={version.tag} value={version.tag}>
                  {version.tag}
                  {version.isLatest ? ` (${t('admin.latest_version')})` : ''}
                </option>
              ))}
            </select>
          </label>
          {selectedUpdateTag ? (
            <p className="admin-copy">
              {
                updateVersions?.versions.find(
                  (version) => version.tag === selectedUpdateTag,
                )?.image
              }
            </p>
          ) : null}
          {updateStatus ? (
            <div className="admin-status">
              <span>
                {t('admin.update_status', { status: updateStatus.status })}
              </span>
              <span>
                {updateStatus.phase}: {updateStatus.message}
              </span>
              {updateStatus.error ? (
                <span className="admin-error">{updateStatus.error}</span>
              ) : null}
            </div>
          ) : null}
          <button
            type="button"
            className="admin-primary-btn"
            onClick={() => void handleStartUpdate()}
            disabled={
              isLoading ||
              !selectedUpdateTag ||
              deployment?.dockerEnabled === false
            }
          >
            {t('admin.start_update')}
          </button>
        </section>

        <section className="admin-card admin-runtime-card">
          <div className="admin-section-header">
            <div>
              <h2>{t('admin.runtime_status')}</h2>
              <p className="admin-copy">{t('admin.runtime_status_copy')}</p>
            </div>
            <span
              className={`admin-status-badge admin-status-badge--${runtimeHealth?.overallStatus ?? 'unknown'}`}
            >
              {t(
                `admin.runtime_overall_${runtimeHealth?.overallStatus ?? 'unknown'}`,
              )}
            </span>
          </div>
          {runtimeHealth?.supervisorAvailable ? null : (
            <p className="admin-channel-hint">
              {t('admin.supervisor_unavailable')}
            </p>
          )}
          <div className="admin-runtime-services">
            {(runtimeHealth?.services ?? []).map((service) => (
              <article key={service.name} className="admin-runtime-service">
                <div>
                  <strong>{service.label}</strong>
                  <span>{service.message}</span>
                </div>
                <span
                  className={`admin-status-badge admin-status-badge--${service.status}`}
                >
                  {t(`admin.runtime_status_${service.status}`)}
                </span>
              </article>
            ))}
          </div>
          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-secondary-btn"
              onClick={() => void refreshRuntimeHealth()}
              disabled={isRuntimeLoading}
            >
              {t('admin.refresh_runtime_status')}
            </button>
            <button
              type="button"
              className="admin-primary-btn"
              onClick={() => void handleRepairRuntime()}
              disabled={
                isRuntimeLoading || runtimeHealth?.repairInProgress === true
              }
            >
              {runtimeHealth?.repairInProgress || isRuntimeLoading
                ? t('admin.runtime_repair_running')
                : t('admin.runtime_repair_action')}
            </button>
          </div>
          <form className="admin-form" onSubmit={handleSaveSelfRepair}>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={selfRepairEnabled}
                  onChange={(event) =>
                    setSelfRepairEnabled(event.target.checked)
                  }
                />{' '}
                {t('admin.self_repair_enabled')}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={selfRepairAllowContainerRepair}
                  onChange={(event) =>
                    setSelfRepairAllowContainerRepair(event.target.checked)
                  }
                />{' '}
                {t('admin.self_repair_allow_container')}
              </label>
            </div>
            <label className="admin-field">
              <span>{t('admin.self_repair_interval')}</span>
              <input
                type="number"
                min={30}
                max={86400}
                value={selfRepairIntervalSeconds}
                onChange={(event) =>
                  setSelfRepairIntervalSeconds(event.target.value)
                }
              />
            </label>
            <button
              type="submit"
              className="admin-secondary-btn"
              disabled={isRuntimeLoading}
            >
              {t('admin.save_self_repair')}
            </button>
          </form>
          {selfRepair ? (
            <p className="admin-copy">
              {t('admin.self_repair_saved_at', { time: selfRepair.updatedAt })}
            </p>
          ) : null}
          <form className="admin-form" onSubmit={handleSavePublicIp}>
            <div className="admin-section-header">
              <div>
                <h3>{t('admin.public_ip_automation')}</h3>
                <p className="admin-copy">
                  {t('admin.public_ip_automation_copy')}
                </p>
              </div>
            </div>
            <div className="admin-checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={publicIpEnabled}
                  onChange={(event) => setPublicIpEnabled(event.target.checked)}
                />{' '}
                {t('admin.public_ip_enabled')}
              </label>
            </div>
            <label className="admin-field">
              <span>{t('admin.public_ip_interval')}</span>
              <input
                type="number"
                min={60}
                max={86400}
                value={publicIpIntervalSeconds}
                onChange={(event) =>
                  setPublicIpIntervalSeconds(event.target.value)
                }
              />
            </label>
            <div className="admin-inline-actions">
              <button
                type="submit"
                className="admin-secondary-btn"
                disabled={isRuntimeLoading}
              >
                {t('admin.save_public_ip')}
              </button>
              <button
                type="button"
                className="admin-primary-btn"
                onClick={() => void handleCheckPublicIp()}
                disabled={isRuntimeLoading}
              >
                {t('admin.check_public_ip_now')}
              </button>
            </div>
          </form>
          {publicIp ? (
            <div className="admin-status">
              <span>
                {t('admin.public_ip_detected', {
                  ip: publicIp.lastDetectedIp ?? t('admin.public_ip_none'),
                })}
              </span>
              <span>
                {t('admin.public_ip_applied', {
                  ip: publicIp.lastAppliedIp ?? t('admin.public_ip_none'),
                })}
              </span>
              <span>
                {t('admin.public_ip_checked_at', {
                  time: publicIp.lastCheckedAt ?? t('admin.public_ip_never'),
                })}
              </span>
              {publicIp.lastError ? (
                <span className="admin-error">{publicIp.lastError}</span>
              ) : null}
            </div>
          ) : null}
          {runtimeRepairResult ? (
            <div className="admin-status">
              <span>
                {t('admin.runtime_repair_status', {
                  status: runtimeRepairResult.status,
                })}
              </span>
              <span>{runtimeRepairResult.message}</span>
              {runtimeRepairResult.containerRepairStarted ? (
                <span>{t('admin.runtime_container_repair_started')}</span>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="admin-card">
          <h2>{t('admin.create_user')}</h2>
          <form className="admin-form" onSubmit={handleCreateUser}>
            <label className="admin-field">
              <span>{t('common.email')}</span>
              <input
                type="email"
                value={newUserEmail}
                onChange={(event) => setNewUserEmail(event.target.value)}
                required
              />
            </label>
            <label className="admin-field">
              <span>{t('common.username')}</span>
              <input
                value={newUserUsername}
                onChange={(event) => setNewUserUsername(event.target.value)}
                minLength={2}
                maxLength={32}
                required
              />
            </label>
            <label className="admin-field">
              <span>{t('common.password')}</span>
              <input
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <button
              type="submit"
              className="admin-primary-btn"
              disabled={isLoading}
            >
              {t('admin.create_user_action')}
            </button>
          </form>
        </section>

        <section className="admin-card">
          <h2>{t('admin.create_channel')}</h2>
          <form className="admin-form" onSubmit={handleCreateChannel}>
            <label className="admin-field">
              <span>{t('admin.channel_name')}</span>
              <input
                value={newChannelName}
                onChange={(event) => setNewChannelName(event.target.value)}
                required
              />
            </label>
            <div className="admin-inline-grid">
              <label className="admin-field">
                <span>{t('admin.channel_type')}</span>
                <select
                  value={newChannelType}
                  onChange={(event) =>
                    setNewChannelType(event.target.value as 'text' | 'voice')
                  }
                >
                  <option value="text">{t('admin.channel_type_text')}</option>
                  <option value="voice">{t('admin.channel_type_voice')}</option>
                </select>
              </label>
              <label className="admin-field">
                <span>{t('admin.voice_quality')}</span>
                <select
                  value={newChannelVoiceQuality}
                  onChange={(event) =>
                    setNewChannelVoiceQuality(
                      event.target.value as 'high' | 'standard',
                    )
                  }
                  disabled={newChannelType !== 'voice'}
                >
                  <option value="standard">
                    {t('admin.voice_quality_standard')}
                  </option>
                  <option value="high">{t('admin.voice_quality_high')}</option>
                </select>
              </label>
            </div>
            <button
              type="submit"
              className="admin-primary-btn"
              disabled={isLoading}
            >
              {t('admin.create_channel_action')}
            </button>
          </form>
        </section>
      </div>

      <section className="admin-card admin-card--full">
        <div className="admin-section-header">
          <div>
            <h2>{t('admin.deployment_settings')}</h2>
            <p className="admin-copy">{t('admin.deployment_settings_copy')}</p>
          </div>
          {deployment?.pendingApply ? (
            <span className="admin-pending-badge">
              {t('admin.pending_apply')}
            </span>
          ) : null}
        </div>
        <form className="admin-form" onSubmit={handleSaveDeploymentSettings}>
          <div className="admin-inline-grid admin-inline-grid--wide">
            <label className="admin-field">
              <span>{t('admin.web_host_port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={webHostPort}
                onChange={(event) => setWebHostPort(event.target.value)}
                required
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.admin_host_port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={adminHostPort}
                onChange={(event) => setAdminHostPort(event.target.value)}
                required
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.allowed_hosts')}</span>
              <input
                value={allowedHosts}
                onChange={(event) => setAllowedHosts(event.target.value)}
                placeholder={t('admin.allowed_hosts_placeholder')}
              />
            </label>
          </div>
          <label className="admin-field">
            <span>{t('admin.stun_urls')}</span>
            <input
              value={stunUrls}
              onChange={(event) => setStunUrls(event.target.value)}
            />
          </label>
          <div className="admin-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={turnEnabled}
                onChange={(event) => setTurnEnabled(event.target.checked)}
              />{' '}
              {t('admin.turn_enabled')}
            </label>
            <label>
              <input
                type="checkbox"
                checked={sfuEnableTcp}
                onChange={(event) => setSfuEnableTcp(event.target.checked)}
              />{' '}
              {t('admin.sfu_enable_tcp')}
            </label>
          </div>
          <div className="admin-inline-grid admin-inline-grid--wide">
            <label className="admin-field">
              <span>{t('admin.turn_urls')}</span>
              <input
                value={turnUrls}
                onChange={(event) => setTurnUrls(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.turn_external_ip')}</span>
              <input
                value={turnExternalIp}
                onChange={(event) => setTurnExternalIp(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.turn_realm')}</span>
              <input
                value={turnRealm}
                onChange={(event) => setTurnRealm(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.turn_username')}</span>
              <input
                value={turnUsername}
                onChange={(event) => setTurnUsername(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.turn_password')}</span>
              <input
                type="password"
                value={turnPassword}
                onChange={(event) => setTurnPassword(event.target.value)}
                placeholder={
                  deployment?.turnPasswordConfigured
                    ? t('admin.secret_configured_placeholder')
                    : ''
                }
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.turn_port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={turnPort}
                onChange={(event) => setTurnPort(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.turn_min_port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={turnMinPort}
                onChange={(event) => setTurnMinPort(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.turn_max_port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={turnMaxPort}
                onChange={(event) => setTurnMaxPort(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.sfu_announced_ip')}</span>
              <input
                value={sfuAnnouncedIp}
                onChange={(event) => setSfuAnnouncedIp(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.sfu_rtc_min_port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={sfuRtcMinPort}
                onChange={(event) => setSfuRtcMinPort(event.target.value)}
              />
            </label>
            <label className="admin-field">
              <span>{t('admin.sfu_rtc_max_port')}</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={sfuRtcMaxPort}
                onChange={(event) => setSfuRtcMaxPort(event.target.value)}
              />
            </label>
          </div>
          <div className="admin-inline-actions">
            <button
              type="submit"
              className="admin-primary-btn"
              disabled={isLoading}
            >
              {t('admin.save_deployment_settings')}
            </button>
            <button
              type="button"
              className="admin-secondary-btn"
              onClick={() => void handleApplyDeployment()}
              disabled={isLoading || deployment?.dockerEnabled === false}
            >
              {t('admin.apply_deployment_settings')}
            </button>
          </div>
        </form>
      </section>

      <section className="admin-card admin-card--full">
        <h2>{t('admin.workspace_channels')}</h2>
        {!workspace?.guildId ? (
          <p className="admin-copy">{t('admin.workspace_channels_hint')}</p>
        ) : (
          <div className="admin-channel-list">
            {workspace.channels.map((channel) => (
              <article key={channel.id} className="admin-channel-row">
                <div className="admin-channel-fields">
                  <label className="admin-field">
                    <span>{t('admin.field_name')}</span>
                    <input
                      id={`channel-name-${channel.id}`}
                      defaultValue={channel.name}
                    />
                  </label>
                  <label className="admin-field">
                    <span>{t('admin.field_type')}</span>
                    <input value={channel.type} readOnly />
                  </label>
                  <label className="admin-field">
                    <span>{t('admin.voice_quality')}</span>
                    <select
                      id={`channel-quality-${channel.id}`}
                      defaultValue={channel.voiceQuality}
                      disabled={channel.type !== 'voice'}
                    >
                      <option value="standard">
                        {t('admin.voice_quality_standard')}
                      </option>
                      <option value="high">
                        {t('admin.voice_quality_high')}
                      </option>
                    </select>
                  </label>
                </div>
                <div className="admin-channel-actions">
                  <button
                    type="button"
                    className="admin-secondary-btn"
                    onClick={() => void handleSaveChannel(channel)}
                    disabled={isLoading}
                  >
                    {t('admin.save_channel')}
                  </button>
                  <button
                    type="button"
                    className="admin-danger-btn"
                    onClick={() => void handleDeleteChannel(channel)}
                    disabled={
                      isLoading || getDeleteBlockReason(channel) !== null
                    }
                  >
                    {t('admin.delete_channel_action')}
                  </button>
                </div>
                {getDeleteBlockReason(channel) ? (
                  <p className="admin-channel-hint">
                    {getDeleteBlockReason(channel)}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
