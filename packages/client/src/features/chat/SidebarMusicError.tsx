import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useMusicStore } from '../music/music-store';
import { scheduleSidebarMusicErrorClear } from './sidebar-music-error-utils';

interface SidebarMusicErrorViewProps {
  musicError: string;
  onDismiss: () => void;
}

export function SidebarMusicErrorView({
  musicError,
  onDismiss,
}: SidebarMusicErrorViewProps) {
  const { t } = useTranslation();

  return (
    <div className="sidebar-music-error" role="alert">
      <div className="sidebar-music-error-header">
        <span className="sidebar-music-error-icon" aria-hidden="true">
          !
        </span>
        <span className="sidebar-music-error-title">
          {t('voice.music_error_title')}
        </span>
      </div>
      <p className="sidebar-music-error-message">{musicError}</p>
      <button
        type="button"
        className="btn-ghost sidebar-music-error-dismiss"
        onClick={onDismiss}
      >
        {t('voice.error_dismiss')}
      </button>
    </div>
  );
}

export function SidebarMusicError() {
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
    <SidebarMusicErrorView
      musicError={musicError}
      onDismiss={() => useMusicStore.setState({ error: null })}
    />
  );
}
