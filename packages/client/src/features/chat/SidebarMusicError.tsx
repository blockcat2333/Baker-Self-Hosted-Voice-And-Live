import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useMusicStore } from '../music/music-store';
import { scheduleSidebarMusicErrorClear } from './sidebar-music-error-utils';

export function SidebarMusicError() {
  const { t } = useTranslation();
  const musicError = useMusicStore((s) => s.error);

  useEffect(() => {
    if (!musicError) return;

    const timeoutId = scheduleSidebarMusicErrorClear(musicError);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [musicError]);

  if (!musicError) return null;

  return (
    <div className="sidebar-music-error" role="alert">
      <div className="sidebar-music-error-header">
        <span className="sidebar-music-error-icon" aria-hidden="true">
          !
        </span>
        <span className="sidebar-music-error-title">{t('voice.music_error_title')}</span>
      </div>
      <p className="sidebar-music-error-message">{musicError}</p>
      <button
        type="button"
        className="btn-ghost sidebar-music-error-dismiss"
        onClick={() => useMusicStore.setState({ error: null })}
      >
        {t('voice.error_dismiss')}
      </button>
    </div>
  );
}
