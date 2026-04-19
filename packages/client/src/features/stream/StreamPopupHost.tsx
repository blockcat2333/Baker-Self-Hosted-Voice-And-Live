import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import './stream-ui.css';

import { useAuthStore } from '../auth/auth-store';
import { sendCommandAwaitAck } from '../gateway/gateway-store';
import { useGatewayStore } from '../gateway/gateway-store';
import {
  DEFAULT_STREAM_PLAYBACK_VOLUME,
  hasPlayableStreamAudioTrack,
  isDisplayAudioSource,
  startPopupStreamPlayback,
} from './stream-media';
import {
  getWatchedStreamVideoStats,
  type WatchedStreamState,
  type WatchedStreamVideoStats,
  useStreamStore,
} from './stream-store';
import {
  closeAllStreamPopups,
  closeStreamPopup,
  getStreamPopupSnapshot,
  shouldAutoCloseStreamPopup,
  subscribeToStreamPopupRegistry,
  type StreamPopupSnapshotEntry,
} from './stream-popup-controller';
import {
  isPopupFullscreenActive,
  isPopupFullscreenSupported,
  togglePopupFullscreen,
} from './stream-popup-fullscreen';

function sourceLabel(sourceType: 'camera' | 'screen' | null) {
  if (sourceType === 'camera') {
    return 'camera';
  }
  if (sourceType === 'screen') {
    return 'screen';
  }
  return 'stream';
}

function sourceLabelI18n(t: TFunction, sourceType: 'camera' | 'screen' | null) {
  if (sourceType === 'camera') {
    return t('stream.source_camera');
  }
  if (sourceType === 'screen') {
    return t('stream.source_screen');
  }
  return t('stream.source_stream');
}

function formatVolumeLabel(volume: number) {
  return `${Math.round(volume * 100)}%`;
}

const STREAM_PLAYBACK_START_TIMEOUT_MS = 3000;
const STREAM_STATS_POLL_INTERVAL_MS = 1000;

type PopupAttachWindow = Window &
  typeof globalThis & {
    __bakerAttachPopupStream?: (video: HTMLVideoElement, stream: MediaStream | null) => number;
  };

function attachPopupStream(video: HTMLVideoElement, stream: MediaStream | null): number | null {
  const popupWindow = video.ownerDocument.defaultView as PopupAttachWindow | null;
  if (!popupWindow) {
    return null;
  }

  if (!popupWindow.__bakerAttachPopupStream) {
    popupWindow.eval(`
      window.__bakerAttachPopupStream = (video, stream) => {
        if (!(video instanceof HTMLVideoElement)) {
          return 0;
        }

        if (!stream || typeof stream.getTracks !== 'function') {
          video.srcObject = null;
          return 0;
        }

        const attached = new MediaStream();
        for (const track of stream.getTracks()) {
          attached.addTrack(track);
        }

        video.srcObject = attached;
        return attached.getTracks().length;
      };
    `);
  }

  try {
    return popupWindow.__bakerAttachPopupStream?.(video, stream) ?? null;
  } catch (error) {
    console.warn('[stream] popup realm stream attach failed', error);
    return null;
  }
}

async function playPopupVideoElementWithAudio(video: HTMLVideoElement) {
  video.muted = false;
  await video.play();
}

function StreamPopupVideo({
  playbackVolume = DEFAULT_STREAM_PLAYBACK_VOLUME,
  stream,
}: {
  playbackVolume?: number;
  stream: MediaStream | null;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackState, setPlaybackState] = useState<'idle' | 'waiting' | 'playing' | 'blocked'>('idle');
  const attachedStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement) {
      return;
    }
    const element = mediaElement;

    let cancelled = false;
    const activeStream = stream;

    if (!activeStream) {
      setPlaybackState('idle');
      element.pause();
      element.srcObject = null;
      return;
    }

    async function attemptPlayback(targetStream: MediaStream, options?: { reattach?: boolean }) {
      setPlaybackState('waiting');

      if (options?.reattach !== false || !element.srcObject) {
        const attachedTrackCount = attachPopupStream(element, targetStream);
        if (attachedTrackCount === null) {
          setPlaybackState('blocked');
          return;
        }
      }

      const playbackTimeout = setTimeout(() => {
        if (!cancelled) {
          setPlaybackState('blocked');
        }
      }, STREAM_PLAYBACK_START_TIMEOUT_MS);

      try {
        const playbackResult = await startPopupStreamPlayback(element, targetStream);
        if (!cancelled) {
          setPlaybackState(playbackResult === 'playing' ? 'playing' : 'blocked');
        }
      } catch (error) {
        if (!cancelled) {
          setPlaybackState('blocked');
        }
        console.warn('[stream] popup playback start failed', error);
      } finally {
        clearTimeout(playbackTimeout);
      }
    }

    const markPlaying = () => {
      if (!cancelled) {
        setPlaybackState('playing');
      }
    };
      const recoverPlaybackIfPaused = () => {
      if (cancelled || !attachedStreamRef.current) {
        return;
      }
      void attemptPlayback(attachedStreamRef.current, { reattach: false });
    };

    const attachedStream = activeStream;
    attachedStreamRef.current = attachedStream;
    const onSourceTrackChanged = () => {
      if (element.paused || (element.muted && hasPlayableStreamAudioTrack(attachedStream))) {
        void attemptPlayback(attachedStream, { reattach: true });
      }
    };

    void attemptPlayback(attachedStream, { reattach: true });
    element.addEventListener('loadeddata', markPlaying);
    element.addEventListener('playing', markPlaying);
    element.addEventListener('pause', recoverPlaybackIfPaused);
    activeStream.addEventListener('addtrack', onSourceTrackChanged);
    activeStream.addEventListener('removetrack', onSourceTrackChanged);

    return () => {
      cancelled = true;
      attachedStreamRef.current = null;
      element.removeEventListener('loadeddata', markPlaying);
      element.removeEventListener('playing', markPlaying);
      element.removeEventListener('pause', recoverPlaybackIfPaused);
      activeStream.removeEventListener('addtrack', onSourceTrackChanged);
      activeStream.removeEventListener('removetrack', onSourceTrackChanged);
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement) {
      return;
    }
    mediaElement.volume = playbackVolume;
  }, [playbackVolume]);

  async function handleManualPlaybackStart() {
    const mediaElement = videoRef.current;
    if (!mediaElement || !stream) {
      return;
    }

    setPlaybackState('waiting');

    try {
      if (attachedStreamRef.current) {
        const attachedTrackCount = attachPopupStream(mediaElement, attachedStreamRef.current);
        if (attachedTrackCount === null) {
          setPlaybackState('blocked');
          return;
        }
      }

      const playbackTimeout = setTimeout(() => {
        setPlaybackState('blocked');
      }, STREAM_PLAYBACK_START_TIMEOUT_MS);

      try {
        await playPopupVideoElementWithAudio(mediaElement);
        setPlaybackState('playing');
      } finally {
        clearTimeout(playbackTimeout);
      }
    } catch (error) {
      setPlaybackState('blocked');
      console.warn('[stream] popup manual playback start failed', error);
    }
  }

  return (
    <div className={'stream-popup-video-frame'}>
      <video ref={videoRef} className={'stream-popup-video'} autoPlay playsInline />
      {!stream ? (
        <div className={'stream-popup-video-overlay stream-popup-video--placeholder'}>{t('stream.video_waiting')}</div>
      ) : playbackState === 'blocked' ? (
        <div className={'stream-popup-video-overlay'}>
          <p className={'stream-popup-video-copy'}>{t('stream.popup_video_playback_blocked')}</p>
          <button type={'button'} className={'btn-ghost stream-action-btn'} onClick={() => void handleManualPlaybackStart()}>
            {t('stream.popup_video_start_playback')}
          </button>
        </div>
      ) : playbackState !== 'playing' ? (
        <div className={'stream-popup-video-overlay stream-popup-video--placeholder'}>{t('stream.popup_video_starting')}</div>
      ) : null}
    </div>
  );
}

function formatStatsValue(value: number | string | null | undefined, suffix?: string) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  return suffix ? `${value} ${suffix}` : String(value);
}

function formatPacketLossValue(stats: WatchedStreamVideoStats | null) {
  if (!stats || stats.packetsLost === null || stats.packetsReceived === null) {
    return '--';
  }

  return `${stats.packetsLost} / ${stats.packetsReceived}`;
}

function StreamPopupStatsPanel({
  streamId,
  status,
}: {
  streamId: string;
  status: WatchedStreamState['status'];
}) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<WatchedStreamVideoStats | null>(null);

  useEffect(() => {
    if (status === 'ended' || status === 'stopping') {
      setStats(null);
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function refreshStats() {
      const next = await getWatchedStreamVideoStats(streamId);
      if (!cancelled) {
        setStats(next);
      }
    }

    void refreshStats();
    interval = setInterval(() => {
      void refreshStats();
    }, STREAM_STATS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [status, streamId]);

  return (
    <section className={'stream-popup-stats'} aria-label={t('stream.popup_stats_title')}>
      <div className={'stream-popup-stats-header'}>
        <h2 className={'stream-popup-stats-title'}>{t('stream.popup_stats_title')}</h2>
        <p className={'stream-popup-stats-copy'}>
          {stats ? t('stream.popup_stats_live') : t('stream.popup_stats_collecting')}
        </p>
      </div>
      <div className={'stream-popup-stats-grid'}>
        <div className={'stream-popup-stats-item'}>
          <span className={'stream-popup-stats-label'}>{t('stream.popup_stats_codec')}</span>
          <strong className={'stream-popup-stats-value'}>{formatStatsValue(stats?.codec)}</strong>
        </div>
        <div className={'stream-popup-stats-item'}>
          <span className={'stream-popup-stats-label'}>{t('stream.popup_stats_resolution')}</span>
          <strong className={'stream-popup-stats-value'}>{formatStatsValue(stats?.resolution)}</strong>
        </div>
        <div className={'stream-popup-stats-item'}>
          <span className={'stream-popup-stats-label'}>{t('stream.popup_stats_frame_rate')}</span>
          <strong className={'stream-popup-stats-value'}>{formatStatsValue(stats?.frameRate, 'fps')}</strong>
        </div>
        <div className={'stream-popup-stats-item'}>
          <span className={'stream-popup-stats-label'}>{t('stream.popup_stats_bitrate')}</span>
          <strong className={'stream-popup-stats-value'}>{formatStatsValue(stats?.bitrateKbps, 'kbps')}</strong>
        </div>
        <div className={'stream-popup-stats-item'}>
          <span className={'stream-popup-stats-label'}>{t('stream.popup_stats_packet_loss')}</span>
          <strong className={'stream-popup-stats-value'}>{formatPacketLossValue(stats)}</strong>
        </div>
        <div className={'stream-popup-stats-item'}>
          <span className={'stream-popup-stats-label'}>{t('stream.popup_stats_jitter')}</span>
          <strong className={'stream-popup-stats-value'}>{formatStatsValue(stats?.jitterMs, 'ms')}</strong>
        </div>
        <div className={'stream-popup-stats-item'}>
          <span className={'stream-popup-stats-label'}>{t('stream.popup_stats_frames_dropped')}</span>
          <strong className={'stream-popup-stats-value'}>{formatStatsValue(stats?.framesDropped)}</strong>
        </div>
      </div>
    </section>
  );
}

function StreamPopupWindow({
  entry,
  onClose,
  userLabel,
  watchedStream,
}: {
  entry: StreamPopupSnapshotEntry;
  onClose: () => void;
  userLabel: (userId: string) => string;
  watchedStream: WatchedStreamState;
}) {
  const { t } = useTranslation();
  const setPlaybackVolume = useStreamStore((s) => s.setPlaybackVolume);
  const stageRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const title = `${userLabel(watchedStream.hostUserId)} • ${sourceLabel(watchedStream.sourceType)} stream`;

  const localizedTitle = t('stream.popup_title', {
    defaultValue: title,
    user: userLabel(watchedStream.hostUserId),
    source: sourceLabelI18n(t, watchedStream.sourceType),
  });

  useEffect(() => {
    entry.document.title = localizedTitle;
    entry.document.body.className = 'stream-popup-body';
  }, [entry.document, localizedTitle]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(isPopupFullscreenActive(stageRef.current, entry.document));
      setFullscreenSupported(isPopupFullscreenSupported(stageRef.current, entry.document));
    };

    syncFullscreenState();
    entry.document.addEventListener('fullscreenchange', syncFullscreenState);

    return () => {
      entry.document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, [entry.document, watchedStream.status]);

  async function handleToggleFullscreen() {
    if (!stageRef.current) {
      return;
    }

    await togglePopupFullscreen(stageRef.current, entry.document);
  }

  return (
    <div className={'stream-popup-shell'}>
      <header className={'stream-popup-header'}>
        <div>
          <p className={'stream-popup-kicker'}>{t('stream.popup_kicker')}</p>
          <h1 className={'stream-popup-title'}>{localizedTitle}</h1>
          <p className={'stream-popup-meta'}>
            {t('stream.viewer_count', { count: watchedStream.viewers.length })} | {watchedStream.streamId.slice(0, 8)}
          </p>
        </div>
        <div className={'stream-popup-header-actions'}>
          <span className={'stream-pill'}>
            {watchedStream.status === 'ended'
              ? t('stream.pill_ended')
              : watchedStream.status === 'starting' || watchedStream.status === 'reconnecting'
                ? t('stream.pill_starting')
                : t('stream.pill_live')}
          </span>
          <button
            type={'button'}
            className={'btn-ghost stream-action-btn'}
            onClick={() => void handleToggleFullscreen()}
            disabled={!fullscreenSupported || watchedStream.status === 'ended'}
          >
            {isFullscreen ? t('stream.popup_exit_fullscreen') : t('stream.popup_enter_fullscreen')}
          </button>
          <button type={'button'} className={'btn-ghost stream-action-btn'} onClick={onClose}>
            {t('stream.popup_close_viewer')}
          </button>
        </div>
      </header>

      {watchedStream.connectionError ? (
        <div className={'stream-popup-warning'} role={'alert'}>
          {t('stream.connection_error')}
        </div>
      ) : null}

      {watchedStream.status === 'ended' ? (
        <section className={'stream-popup-ended'}>
          <h2 className={'stream-popup-ended-title'}>{t('stream.popup_ended_title')}</h2>
          <p className={'stream-popup-ended-copy'}>
            {t('stream.popup_ended_copy')}
          </p>
        </section>
      ) : (
        <section ref={stageRef} className={'stream-popup-stage'}>
          <StreamPopupVideo playbackVolume={watchedStream.playbackVolume} stream={watchedStream.remoteStream} />
        </section>
      )}

      <section className={'stream-popup-controls'}>
        <div className={'stream-volume-control'}>
          <label className={'stream-volume-label'} htmlFor={`popup-stream-volume-${watchedStream.streamId}`}>
            {t('stream.popup_stream_volume')} <span>{formatVolumeLabel(watchedStream.playbackVolume)}</span>
          </label>
          <input
            id={`popup-stream-volume-${watchedStream.streamId}`}
            className={'stream-volume-slider'}
            type={'range'}
            min={0}
            max={100}
            step={5}
            value={Math.round(watchedStream.playbackVolume * 100)}
            onChange={(event) => {
              setPlaybackVolume(watchedStream.streamId, Number(event.target.value) / 100);
            }}
            aria-label={t('stream.popup_playback_volume_aria', { user: userLabel(watchedStream.hostUserId) })}
          />
          {isDisplayAudioSource(watchedStream.sourceType ?? 'camera') ? (
            <p className={'stream-audio-hint'}>
              {t('stream.popup_audio_hint_screen')}
            </p>
          ) : (
            <p className={'stream-audio-hint'}>
              {t('stream.popup_audio_hint_camera')}
            </p>
          )}
        </div>
        <StreamPopupStatsPanel streamId={watchedStream.streamId} status={watchedStream.status} />
      </section>
    </div>
  );
}

export function StreamPopupHost() {
  const { t } = useTranslation();
  const popupEntries = useSyncExternalStore(
    subscribeToStreamPopupRegistry,
    getStreamPopupSnapshot,
    getStreamPopupSnapshot,
  );
  const watchedStreamsById = useStreamStore((s) => s.watchedStreamsById);
  const unwatchStream = useStreamStore((s) => s.unwatchStream);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const presenceMap = useGatewayStore((s) => s.presenceMap);

  useEffect(() => {
    return () => {
      closeAllStreamPopups();
    };
  }, []);

  useEffect(() => {
    for (const entry of popupEntries) {
      if (watchedStreamsById[entry.streamId] || !shouldAutoCloseStreamPopup(entry)) {
        continue;
      }

      closeStreamPopup(entry.streamId);
    }
  }, [popupEntries, watchedStreamsById]);

  function userLabel(userId: string) {
    if (userId === myUserId) {
      return t('common.you');
    }

    return presenceMap[userId]?.username ?? userId.slice(0, 8);
  }

  return (
    <>
      {popupEntries.map((entry) => {
        const watchedStream = watchedStreamsById[entry.streamId];
        if (!watchedStream) {
          return null;
        }

        return createPortal(
          <StreamPopupWindow
            key={entry.streamId}
            entry={entry}
            watchedStream={watchedStream}
            userLabel={userLabel}
            onClose={() => {
              closeStreamPopup(entry.streamId);
              void unwatchStream(entry.streamId, sendCommandAwaitAck);
            }}
          />,
          entry.container,
          entry.streamId,
        );
      })}
    </>
  );
}
