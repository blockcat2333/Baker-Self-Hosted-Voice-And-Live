import { useMusicStore } from '../music/music-store';

const MUSIC_ERROR_AUTO_CLEAR_MS = 5_000;

type SidebarMusicErrorTimeout = (handler: TimerHandler, timeout?: number) => number;

export function clearSidebarMusicError(error: string) {
  if (useMusicStore.getState().error === error) {
    useMusicStore.setState({ error: null });
  }
}

export function scheduleSidebarMusicErrorClear(
  error: string,
  setTimeoutFn: SidebarMusicErrorTimeout = window.setTimeout,
) {
  return setTimeoutFn(() => clearSidebarMusicError(error), MUSIC_ERROR_AUTO_CLEAR_MS);
}
