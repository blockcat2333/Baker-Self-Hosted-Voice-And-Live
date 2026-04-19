import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  AdminServerSettings,
  AdminWorkspaceState,
  ChannelSummary,
} from '@baker/protocol';
import {
  AdminServerSettingsSchema,
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
      return new URL(trimmed, window.location.origin).toString().replace(/\/$/, '');
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

  const [serverName, setServerName] = useState('Baker');
  const [allowPublicRegistration, setAllowPublicRegistration] = useState(true);
  const [webEnabled, setWebEnabled] = useState(true);
  const [webPort, setWebPort] = useState('80');
  const [appPort, setAppPort] = useState('5174');
  const [newAdminPassword, setNewAdminPassword] = useState('');

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');

  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');
  const [newChannelVoiceQuality, setNewChannelVoiceQuality] = useState<'high' | 'standard'>('standard');

  const apiOrigin = useMemo(() => normalizeApiOrigin(apiBaseUrl), [apiBaseUrl]);

  async function request<T>(
    path: string,
    init: RequestInit,
    schema: { parse(data: unknown): T },
    includePassword = true,
  ): Promise<T> {
    const response = await fetch(`${apiOrigin}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(includePassword && password ? { 'x-admin-password': password } : {}),
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
      const startsWith = text ? JSON.stringify(text.slice(0, 120)) : '(empty)';
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
  }

  async function loadDashboard() {
    const [nextSettings, nextWorkspace] = await Promise.all([
      request('/v1/admin/settings', { method: 'GET' }, AdminServerSettingsSchema),
      request('/v1/admin/workspace', { method: 'GET' }, AdminWorkspaceStateSchema),
    ]);

    setSettings(nextSettings);
    setWorkspace(nextWorkspace);
    setServerName(nextSettings.serverName);
    setAllowPublicRegistration(nextSettings.allowPublicRegistration);
    setWebEnabled(nextSettings.webEnabled);
    setWebPort(String(nextSettings.webPort));
    setAppPort(String(nextSettings.appPort));
  }

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
      setError(err instanceof Error ? err.message : t('admin.error_login_failed'));
      setIsAuthenticated(false);
      setIsLoading(false);
      return;
    }

    setIsAuthenticated(true);

    try {
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.error_load_dashboard'));
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
      setError(err instanceof Error ? err.message : t('admin.error_save_settings'));
    } finally {
      setIsLoading(false);
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
      setError(err instanceof Error ? err.message : t('admin.error_create_user'));
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
            voiceQuality: newChannelType === 'voice' ? newChannelVoiceQuality : 'standard',
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
      setError(err instanceof Error ? err.message : t('admin.error_create_channel'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveChannel(channel: ChannelSummary) {
    const nameInput = document.getElementById(`channel-name-${channel.id}`) as HTMLInputElement | null;
    const qualityInput = document.getElementById(`channel-quality-${channel.id}`) as HTMLSelectElement | null;

    setIsLoading(true);
    setError(null);

    try {
      await request(
        `/v1/admin/channels/${channel.id}`,
        {
          body: JSON.stringify({
            name: nameInput?.value ?? channel.name,
            voiceQuality: channel.type === 'voice' ? (qualityInput?.value ?? channel.voiceQuality) : channel.voiceQuality,
          }),
          method: 'PATCH',
        },
        ChannelSummarySchema,
      );
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.error_update_channel'));
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
            <button type="submit" className="admin-primary-btn" disabled={isLoading}>
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

      {error ? <p className="admin-error admin-error--inline">{error}</p> : null}

      <div className="admin-grid">
        <section className="admin-card">
          <h2>{t('admin.server_settings')}</h2>
          <form className="admin-form" onSubmit={handleSaveSettings}>
            <label className="admin-field">
              <span>{t('admin.server_name')}</span>
              <input value={serverName} onChange={(event) => setServerName(event.target.value)} required />
            </label>
            <div className="admin-checkbox-row">
              <label><input type="checkbox" checked={allowPublicRegistration} onChange={(event) => setAllowPublicRegistration(event.target.checked)} /> {t('admin.allow_public_registration')}</label>
              <label><input type="checkbox" checked={webEnabled} onChange={(event) => setWebEnabled(event.target.checked)} /> {t('admin.enable_web_client')}</label>
            </div>
            <div className="admin-inline-grid">
              <label className="admin-field">
                <span>{t('admin.web_port')}</span>
                <input type="number" min={1} max={65535} value={webPort} onChange={(event) => setWebPort(event.target.value)} required />
              </label>
              <label className="admin-field">
                <span>{t('admin.app_port')}</span>
                <input type="number" min={1} max={65535} value={appPort} onChange={(event) => setAppPort(event.target.value)} required />
              </label>
            </div>
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
            <button type="submit" className="admin-primary-btn" disabled={isLoading}>
              {t('admin.save_settings')}
            </button>
          </form>
          {settings ? (
            <div className="admin-meta">
              <span>{t('admin.current_web_port', { port: String(settings.webPort) })}</span>
              <span>{t('admin.current_app_port', { port: String(settings.appPort) })}</span>
            </div>
          ) : null}
        </section>

        <section className="admin-card">
          <h2>{t('admin.create_user')}</h2>
          <form className="admin-form" onSubmit={handleCreateUser}>
            <label className="admin-field">
              <span>{t('common.email')}</span>
              <input type="email" value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} required />
            </label>
            <label className="admin-field">
              <span>{t('common.username')}</span>
              <input value={newUserUsername} onChange={(event) => setNewUserUsername(event.target.value)} minLength={2} maxLength={32} required />
            </label>
            <label className="admin-field">
              <span>{t('common.password')}</span>
              <input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} minLength={8} required />
            </label>
            <button type="submit" className="admin-primary-btn" disabled={isLoading}>
              {t('admin.create_user_action')}
            </button>
          </form>
        </section>

        <section className="admin-card">
          <h2>{t('admin.create_channel')}</h2>
          <form className="admin-form" onSubmit={handleCreateChannel}>
            <label className="admin-field">
              <span>{t('admin.channel_name')}</span>
              <input value={newChannelName} onChange={(event) => setNewChannelName(event.target.value)} required />
            </label>
            <div className="admin-inline-grid">
              <label className="admin-field">
                <span>{t('admin.channel_type')}</span>
                <select value={newChannelType} onChange={(event) => setNewChannelType(event.target.value as 'text' | 'voice')}>
                  <option value="text">{t('admin.channel_type_text')}</option>
                  <option value="voice">{t('admin.channel_type_voice')}</option>
                </select>
              </label>
              <label className="admin-field">
                <span>{t('admin.voice_quality')}</span>
                <select
                  value={newChannelVoiceQuality}
                  onChange={(event) => setNewChannelVoiceQuality(event.target.value as 'high' | 'standard')}
                  disabled={newChannelType !== 'voice'}
                >
                  <option value="standard">{t('admin.voice_quality_standard')}</option>
                  <option value="high">{t('admin.voice_quality_high')}</option>
                </select>
              </label>
            </div>
            <button type="submit" className="admin-primary-btn" disabled={isLoading}>
              {t('admin.create_channel_action')}
            </button>
          </form>
        </section>
      </div>

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
                    <input id={`channel-name-${channel.id}`} defaultValue={channel.name} />
                  </label>
                  <label className="admin-field">
                    <span>{t('admin.field_type')}</span>
                    <input value={channel.type} readOnly />
                  </label>
                  <label className="admin-field">
                    <span>{t('admin.voice_quality')}</span>
                    <select id={`channel-quality-${channel.id}`} defaultValue={channel.voiceQuality} disabled={channel.type !== 'voice'}>
                      <option value="standard">{t('admin.voice_quality_standard')}</option>
                      <option value="high">{t('admin.voice_quality_high')}</option>
                    </select>
                  </label>
                </div>
                <button type="button" className="admin-secondary-btn" onClick={() => void handleSaveChannel(channel)} disabled={isLoading}>
                  {t('admin.save_channel')}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
