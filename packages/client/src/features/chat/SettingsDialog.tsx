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
}

export function SettingsDialog({ api, onChangeServer, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();

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
        aria-labelledby="settings-dialog-title"
        aria-modal="true"
        className="settings-dialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-dialog-header">
          <div>
            <p className="settings-dialog-eyebrow">{t('settings.title')}</p>
            <h2 id="settings-dialog-title" className="settings-dialog-title">
              {t('settings.preferences')}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="btn-ghost settings-dialog-close"
            onClick={onClose}
            aria-label={t('settings.close')}
          >
            {t('settings.close')}
          </button>
        </header>

        <div className="settings-dialog-body">
          <section className="settings-dialog-section">
            <h3 className="settings-dialog-section-title">{t('settings.audio')}</h3>
            <VoiceAudioDeviceControls />
          </section>

          <section className="settings-dialog-section">
            <h3 className="settings-dialog-section-title">{t('settings.language')}</h3>
            <LanguageSwitcher className="language-switcher settings-language-switcher" />
          </section>

          {onChangeServer ? (
            <section className="settings-dialog-section">
              <h3 className="settings-dialog-section-title">{t('settings.server')}</h3>
              <button type="button" className="btn-ghost settings-dialog-action" onClick={handleChangeServer}>
                {t('app.change_server')}
              </button>
            </section>
          ) : null}

          <section className="settings-dialog-section">
            <h3 className="settings-dialog-section-title">{t('settings.session')}</h3>
            <button type="button" className="btn-ghost settings-dialog-action" onClick={handleLogout}>
              {t('common.sign_out')}
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}
