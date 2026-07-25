import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

import { useAuthStore } from '../auth/auth-store';
import { VoiceAudioDeviceControls } from '../voice/VoicePanel';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';

interface SettingsDialogProps {
  api: ApiClient;
  onChangeServer?: () => void;
  onClose: () => void;
  onShowDataDetailsChange: (show: boolean) => void;
  showDataDetails: boolean;
}

export function SettingsDialog({
  api,
  onChangeServer,
  onClose,
  onShowDataDetailsChange,
  showDataDetails,
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  function handleChangeServer() {
    onClose();
    onChangeServer?.();
  }

  function handleLogout() {
    onClose();
    void logout(api);
  }

  return (
    <div className="settings-dialog-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        aria-labelledby="settings-dialog-title"
        aria-modal="true"
        className="settings-dialog"
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-dialog-content">
          <header className="settings-dialog-header">
            <div>
              <p className="settings-dialog-eyebrow">{t('settings.preferences')}</p>
              <h2 id="settings-dialog-title" className="settings-dialog-title">
                {t('settings.title')}
              </h2>
              <p className="settings-dialog-description">{t('settings.description')}</p>
            </div>
            <div className="settings-dialog-close-wrap">
              <button
                type="button"
                className="settings-dialog-close"
                onClick={onClose}
                aria-label={t('settings.close')}
                title={t('settings.close')}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
              <span>ESC</span>
            </div>
          </header>

          <div className="settings-dialog-body">
            <section className="settings-pane">
              <div className="settings-pane-heading">
                <h3>{t('settings.audio')}</h3>
                <p>{t('settings.audio_device_hint')}</p>
              </div>
              <div className="settings-control-surface settings-control-surface--audio">
                <VoiceAudioDeviceControls />
              </div>
            </section>

            <section className="settings-pane">
              <div className="settings-pane-heading">
                <h3>{t('settings.application')}</h3>
                <p>{t('settings.application_description')}</p>
              </div>
              <div className="settings-section-surface">
                <div className="settings-setting-row">
                  <div>
                    <h4>{t('settings.language')}</h4>
                    <p>{t('settings.language_description')}</p>
                  </div>
                  <LanguageSwitcher className="language-switcher settings-language-switcher" />
                </div>
                <div className="settings-setting-row">
                  <div>
                    <h4>{t('settings.data_details')}</h4>
                    <p>{t('settings.data_details_description')}</p>
                  </div>
                  <div className="settings-data-detail-toggle">
                    <button
                      type="button"
                      aria-pressed={showDataDetails}
                      onClick={() => onShowDataDetailsChange(true)}
                    >
                      {t('settings.show_data')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={!showDataDetails}
                      onClick={() => onShowDataDetailsChange(false)}
                    >
                      {t('settings.hide_data')}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-pane">
              <div className="settings-pane-heading">
                <h3>{t('settings.session')}</h3>
                <p>{t('settings.session_description')}</p>
              </div>
              <div className="settings-section-surface">
                {user ? (
                  <div className="settings-account-summary">
                    <span aria-hidden="true">{user.username.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <strong>{user.username}</strong>
                      <small>{user.email}</small>
                    </div>
                  </div>
                ) : null}
                {onChangeServer ? (
                  <div className="settings-setting-row settings-setting-row--action">
                    <div>
                      <h4>{t('settings.server')}</h4>
                      <p>{t('settings.server_description')}</p>
                    </div>
                    <button type="button" className="settings-row-action" onClick={handleChangeServer}>
                      {t('app.change_server')}
                    </button>
                  </div>
                ) : null}
                <div className="settings-setting-row settings-setting-row--action">
                  <div>
                    <h4>{t('common.sign_out')}</h4>
                    <p>{t('settings.sign_out_description')}</p>
                  </div>
                  <button
                    type="button"
                    className="settings-row-action settings-row-action--danger"
                    onClick={handleLogout}
                  >
                    {t('common.sign_out')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
