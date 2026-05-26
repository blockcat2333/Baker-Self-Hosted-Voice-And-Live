import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';
import type { PublicServerConfig } from '@baker/protocol';

import { useAuthStore } from './auth-store';

export interface LoginViewProps {
  api: ApiClient;
  bootstrapError?: string | null;
  desktopUpdateAction?: ReactNode;
  publicConfig: PublicServerConfig;
}

const REMEMBERED_CREDENTIALS_KEY = 'baker_remembered_credentials_v1';

function loadRememberedCredentials(): { email: string; password: string; username: string } | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(REMEMBERED_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ email: string; password: string; username: string }>;
    if (typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
      return null;
    }
    return {
      email: parsed.email,
      password: parsed.password,
      username: typeof parsed.username === 'string' ? parsed.username : '',
    };
  } catch {
    return null;
  }
}

function saveRememberedCredentials(input: { email: string; password: string; username: string }) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(REMEMBERED_CREDENTIALS_KEY, JSON.stringify(input));
  } catch {
    // ignore unavailable storage
  }
}

function clearRememberedCredentials() {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
  } catch {
    // ignore unavailable storage
  }
}

export function LoginView({ api, publicConfig, bootstrapError, desktopUpdateAction }: LoginViewProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { isLoading, error, login, register } = useAuthStore();
  const displayedError = localError ?? error ?? bootstrapError ?? null;

  useEffect(() => {
    const remembered = loadRememberedCredentials();
    if (!remembered) {
      return;
    }

    setEmail(remembered.email);
    setPassword(remembered.password);
    setUsername(remembered.username);
    setRememberCredentials(true);
  }, []);

  function persistCredentialsAfterSuccess() {
    if (rememberCredentials) {
      saveRememberedCredentials({ email, password, username });
    } else {
      clearRememberedCredentials();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === 'register' && password !== confirmPassword) {
      setLocalError(t('auth.passwords_do_not_match'));
      return;
    }

    try {
      setLocalError(null);
      if (mode === 'login') {
        await login(api, email, password);
      } else {
        await register(api, email, password, username);
      }
      persistCredentialsAfterSuccess();
    } catch {
      // Store error is already populated.
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-branding">
          <p className="login-eyebrow">{t('common.server')}</p>
          <h1 className="login-title">{publicConfig.serverName}</h1>
        </div>

        {publicConfig.allowPublicRegistration ? (
          <div className="login-tabs">
            <button
              type="button"
              className={mode === 'login' ? 'tab active' : 'tab'}
              onClick={() => {
                setMode('login');
                setLocalError(null);
              }}
            >
              {t('auth.sign_in')}
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'tab active' : 'tab'}
              onClick={() => {
                setMode('register');
                setLocalError(null);
              }}
            >
              {t('auth.create_account')}
            </button>
          </div>
        ) : (
          <p className="login-copy">{t('auth.public_registration_disabled')}</p>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          {mode === 'register' && publicConfig.allowPublicRegistration && (
            <label className="field">
              <div className="field-label-row">
                <span>{t('common.username')}</span>
                {desktopUpdateAction}
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                maxLength={32}
                autoComplete="username"
              />
            </label>
          )}

          <label className="field">
            <div className="field-label-row">
              <span>{t('common.email')}</span>
              {mode === 'login' ? desktopUpdateAction : null}
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>

          <label className="field">
            <span>{t('common.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {mode === 'register' && publicConfig.allowPublicRegistration && (
            <label className="field">
              <span>{t('common.confirm_password')}</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>
          )}

          <label className="login-remember-row">
            <input
              type="checkbox"
              checked={rememberCredentials}
              onChange={(event) => setRememberCredentials(event.target.checked)}
            />
            <span>{t('auth.remember_credentials')}</span>
          </label>

          {displayedError ? <p className="login-error">{displayedError}</p> : null}

          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading
              ? t('common.please_wait')
              : mode === 'login' || !publicConfig.allowPublicRegistration
                ? t('auth.sign_in')
                : t('auth.create_account')}
          </button>
        </form>
      </div>
    </div>
  );
}
