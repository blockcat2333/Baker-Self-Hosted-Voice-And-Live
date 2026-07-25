import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

import { Tooltip } from '../chat/Tooltip';
import { useGatewayStore } from '../gateway/gateway-store';
import { useAuthStore } from './auth-store';

export interface AccountPanelProps {
  api: ApiClient;
}

export function AccountPanel({ api }: AccountPanelProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const error = useAuthStore((s) => s.error);
  const isLoading = useAuthStore((s) => s.isLoading);
  const updateUsername = useAuthStore((s) => s.updateUsername);
  const updatePresenceUsername = useGatewayStore((s) => s.updatePresenceUsername);
  const [draftUsername, setDraftUsername] = useState(user?.username ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraftUsername(user?.username ?? '');
  }, [user?.username]);

  if (!user) {
    return null;
  }

  const currentUser = user;

  async function handleSave() {
    const normalized = draftUsername.trim();
    if (normalized.length < 2 || normalized.length > 32) {
      setLocalError(t('account.username_length_error'));
      return;
    }

    if (normalized === currentUser.username) {
      setLocalError(null);
      setIsEditing(false);
      return;
    }

    try {
      setLocalError(null);
      await updateUsername(api, normalized);
      updatePresenceUsername(currentUser.id, normalized);
      setIsEditing(false);
    } catch {
      // Store error is already populated.
    }
  }

  return (
    <>
      <section className="account-panel" aria-label={t('common.account')}>
        <div className="account-panel-header">
          <span className="account-panel-avatar" aria-hidden="true">
            {currentUser.username.slice(0, 2).toUpperCase()}
            <span className="account-panel-status" />
          </span>
          <div className="account-panel-identity">
            <h2 className="account-panel-title" title={currentUser.username}>{currentUser.username}</h2>
            <p className="account-panel-subtitle" title={currentUser.email}>{currentUser.email}</p>
          </div>
          <Tooltip label={t('account.edit_username')}>
            <button
              type="button"
              className="btn-ghost account-panel-edit-btn"
              aria-label={t('account.edit_username')}
              onClick={() => {
                setDraftUsername(currentUser.username);
                setLocalError(null);
                setIsEditing(true);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m4 16-.8 4 4-.8L18.4 8 16 5.6 4 16Z" />
                <path d="m14.5 7.1 2.4 2.4" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </section>

      {isEditing && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="account-edit-backdrop"
              role="presentation"
              onPointerDown={() => setIsEditing(false)}
            >
              <section
                className="account-edit-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="account-edit-title"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <header className="account-edit-dialog-header">
                  <div>
                    <p>{t('common.account')}</p>
                    <h2 id="account-edit-title">{t('account.edit_username')}</h2>
                  </div>
                  <button
                    type="button"
                    className="account-edit-close"
                    aria-label={t('settings.close')}
                    onClick={() => setIsEditing(false)}
                  >
                    ×
                  </button>
                </header>

                <div className="account-edit-preview">
                  <span className="account-panel-avatar" aria-hidden="true">
                    {(draftUsername.trim() || currentUser.username).slice(0, 2).toUpperCase()}
                    <span className="account-panel-status" />
                  </span>
                  <div>
                    <strong>{draftUsername.trim() || currentUser.username}</strong>
                    <span>{currentUser.email}</span>
                  </div>
                </div>

                <label className="field account-edit-field">
                  <span>{t('common.username')}</span>
                  <input
                    autoFocus
                    type="text"
                    value={draftUsername}
                    onChange={(event) => setDraftUsername(event.target.value)}
                    minLength={2}
                    maxLength={32}
                    autoComplete="username"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setIsEditing(false);
                      if (event.key === 'Enter') void handleSave();
                    }}
                  />
                </label>

                {(localError || error) ? <p className="login-error">{localError ?? error}</p> : null}

                <footer className="account-edit-actions">
                  <button
                    type="button"
                    className="btn-ghost account-panel-cancel-btn"
                    disabled={isLoading}
                    onClick={() => {
                      setDraftUsername(currentUser.username);
                      setLocalError(null);
                      setIsEditing(false);
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="btn-primary account-panel-save-btn"
                    disabled={isLoading}
                    onClick={() => {
                      void handleSave();
                    }}
                  >
                    {isLoading ? t('common.saving') : t('common.save')}
                  </button>
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

