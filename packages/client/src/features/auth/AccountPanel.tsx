import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

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
    <section className="account-panel" aria-label={t('common.account')}>
      <div className="account-panel-header">
        <div className="account-panel-identity">
          <h2 className="account-panel-title" title={currentUser.username}>{currentUser.username}</h2>
          <p className="account-panel-subtitle" title={currentUser.email}>{currentUser.email}</p>
        </div>
        {!isEditing ? (
          <button
            type="button"
            className="btn-ghost account-panel-edit-btn"
            onClick={() => {
              setDraftUsername(currentUser.username);
              setLocalError(null);
              setIsEditing(true);
            }}
          >
            {t('common.edit')}
          </button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="account-panel-form">
          <label className="field">
            <span>{t('common.username')}</span>
            <input
              type="text"
              value={draftUsername}
              onChange={(event) => setDraftUsername(event.target.value)}
              minLength={2}
              maxLength={32}
              autoComplete="username"
            />
          </label>

          {(localError || error) ? <p className="login-error">{localError ?? error}</p> : null}

          <div className="account-panel-actions">
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
          </div>
        </div>
      ) : null}
    </section>
  );
}

