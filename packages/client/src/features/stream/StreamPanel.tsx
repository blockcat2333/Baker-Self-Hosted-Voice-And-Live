import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { StreamQualitySettings } from '@baker/protocol';

import './stream-ui.css';

import { useAuthStore } from '../auth/auth-store';
import { sendCommandAwaitAck, sendRawCommand } from '../gateway/gateway-store';
import { useGatewayStore } from '../gateway/gateway-store';
import { useVoiceStore } from '../voice/voice-store';
import { closeStreamPopup, ensureStreamPopupWindow } from './stream-popup-controller';
import {
  DEFAULT_STREAM_CODEC_PREFERENCE,
  DEFAULT_STREAM_PLAYBACK_VOLUME,
  DEFAULT_STREAM_QUALITY,
  STREAM_BITRATE_OPTIONS,
  STREAM_CODEC_OPTIONS,
  STREAM_FRAME_RATE_OPTIONS,
  STREAM_RESOLUTION_OPTIONS,
  type StreamCodecPreference,
} from './stream-media';
import {
  getOwnedStreamVideoStats,
  type OwnedPublishState,
  type OwnedStreamVideoStats,
  useStreamStore,
} from './stream-store';

function sourceLabel(t: TFunction, sourceType: 'camera' | 'screen' | null) {
  if (sourceType === 'camera') {
    return t('stream.source_camera');
  }
  if (sourceType === 'screen') {
    return t('stream.source_screen');
  }
  return t('stream.source_stream');
}

function describeOwnedStatus(
  t: TFunction,
  status: 'capturing' | 'starting' | 'live' | 'stopping',
  sourceType: 'camera' | 'screen',
) {
  const source = sourceLabel(t, sourceType);
  if (status === 'live') {
    return t('stream.owned_status_sharing', { source });
  }

  if (status === 'capturing') {
    return t('stream.owned_status_preparing', { source });
  }

  if (status === 'starting') {
    return t('stream.owned_status_starting', { source });
  }

  return t('stream.owned_status_stopping');
}

function formatVolumeLabel(volume: number) {
  return `${Math.round(volume * 100)}%`;
}

function codecPreferenceLabel(t: TFunction, codecPreference: StreamCodecPreference) {
  switch (codecPreference) {
    case 'h264':
      return t('stream.codec_h264');
    case 'vp8':
      return t('stream.codec_vp8');
    case 'vp9':
      return t('stream.codec_vp9');
    case 'av1':
      return t('stream.codec_av1');
    case 'default':
    default:
      return t('stream.codec_default');
  }
}

function formatQualityLabel(t: TFunction, quality: StreamQualitySettings, codecPreference: StreamCodecPreference) {
  return `${quality.resolution} | ${quality.frameRate} FPS | ${quality.bitrateKbps} kbps | ${codecPreferenceLabel(t, codecPreference)}`;
}

function formatStatsValue(value: number | string | null | undefined, suffix?: string) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  return suffix ? `${value} ${suffix}` : String(value);
}

function limitationReasonLabel(t: TFunction, reason: OwnedStreamVideoStats['qualityLimitationReason']) {
  switch (reason) {
    case 'cpu':
      return t('stream.health_reason_cpu');
    case 'bandwidth':
      return t('stream.health_reason_bandwidth');
    case 'other':
      return t('stream.health_reason_other');
    case 'none':
    default:
      return t('stream.health_reason_none');
  }
}

function describeOwnedStreamHealth(
  t: TFunction,
  ownedStream: OwnedPublishState,
  stats: OwnedStreamVideoStats | null,
) {
  if (ownedStream.viewers.length === 0) {
    return {
      badgeClassName: 'stream-pill',
      badgeLabel: t('stream.health_waiting'),
      copy: t('stream.health_waiting_copy'),
    };
  }

  if (!stats) {
    return {
      badgeClassName: 'stream-pill',
      badgeLabel: t('stream.health_sampling'),
      copy: t('stream.health_sampling_copy'),
    };
  }

  if (stats.qualityLimitationReason === 'bandwidth') {
    return {
      badgeClassName: 'stream-pill stream-pill--warn',
      badgeLabel: t('stream.health_bandwidth'),
      copy: t('stream.health_bandwidth_copy'),
    };
  }

  if (stats.encoderLimited) {
    return {
      badgeClassName: 'stream-pill stream-pill--danger',
      badgeLabel: t('stream.health_encoder_limited'),
      copy: t('stream.health_encoder_limited_copy').replace('{{targetFps}}', String(ownedStream.quality.frameRate)),
    };
  }

  if (stats.qualityLimitationReason === 'other') {
    return {
      badgeClassName: 'stream-pill stream-pill--warn',
      badgeLabel: t('stream.health_other_limited'),
      copy: t('stream.health_other_limited_copy'),
    };
  }

  return {
    badgeClassName: 'stream-pill stream-pill--good',
    badgeLabel: t('stream.health_healthy'),
    copy: t('stream.health_healthy_copy'),
  };
}

const OWNED_STREAM_STATS_POLL_INTERVAL_MS = 1000;

function OwnedStreamHealthPanel({
  ownedStream,
}: {
  ownedStream: OwnedPublishState;
}) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<OwnedStreamVideoStats | null>(null);

  useEffect(() => {
    if (ownedStream.status !== 'live') {
      setStats(null);
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      const next = await getOwnedStreamVideoStats();
      if (!cancelled) {
        setStats(next);
      }
    };

    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, OWNED_STREAM_STATS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ownedStream.status, ownedStream.streamId]);

  const health = describeOwnedStreamHealth(t, ownedStream, stats);

  return (
    <section className={'stream-owned-health'} aria-label={t('stream.health_title')}>
      <div className={'stream-owned-health-header'}>
        <div>
          <h4 className={'stream-owned-health-title'}>{t('stream.health_title')}</h4>
          <p className={'stream-owned-health-copy'}>{health.copy}</p>
        </div>
        <span className={health.badgeClassName}>{health.badgeLabel}</span>
      </div>
      <div className={'stream-owned-health-grid'}>
        <div className={'stream-owned-health-item'}>
          <span className={'stream-owned-health-label'}>{t('stream.health_target_frame_rate')}</span>
          <strong className={'stream-owned-health-value'}>{formatStatsValue(ownedStream.quality.frameRate, 'fps')}</strong>
        </div>
        <div className={'stream-owned-health-item'}>
          <span className={'stream-owned-health-label'}>{t('stream.health_actual_frame_rate')}</span>
          <strong className={'stream-owned-health-value'}>{formatStatsValue(stats?.frameRate, 'fps')}</strong>
        </div>
        <div className={'stream-owned-health-item'}>
          <span className={'stream-owned-health-label'}>{t('stream.health_send_bitrate')}</span>
          <strong className={'stream-owned-health-value'}>{formatStatsValue(stats?.bitrateKbps, 'kbps')}</strong>
        </div>
        <div className={'stream-owned-health-item'}>
          <span className={'stream-owned-health-label'}>{t('stream.health_send_resolution')}</span>
          <strong className={'stream-owned-health-value'}>{formatStatsValue(stats?.resolution)}</strong>
        </div>
        <div className={'stream-owned-health-item'}>
          <span className={'stream-owned-health-label'}>{t('stream.health_preferred_codec')}</span>
          <strong className={'stream-owned-health-value'}>
            {codecPreferenceLabel(t, ownedStream.codecPreference)}
          </strong>
        </div>
        <div className={'stream-owned-health-item'}>
          <span className={'stream-owned-health-label'}>{t('stream.health_actual_codec')}</span>
          <strong className={'stream-owned-health-value'}>{formatStatsValue(stats?.codec)}</strong>
        </div>
        <div className={'stream-owned-health-item'}>
          <span className={'stream-owned-health-label'}>{t('stream.health_limitation_reason')}</span>
          <strong className={'stream-owned-health-value'}>
            {stats ? limitationReasonLabel(t, stats.qualityLimitationReason) : '--'}
          </strong>
        </div>
        <div className={'stream-owned-health-item'}>
          <span className={'stream-owned-health-label'}>{t('stream.health_active_peers')}</span>
          <strong className={'stream-owned-health-value'}>{formatStatsValue(stats?.activePeerCount ?? ownedStream.viewers.length)}</strong>
        </div>
      </div>
    </section>
  );
}

function StreamVideo({
  muted = false,
  playbackVolume = DEFAULT_STREAM_PLAYBACK_VOLUME,
  stream,
}: {
  muted?: boolean;
  playbackVolume?: number;
  stream: MediaStream | null;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }

    element.srcObject = stream;
    if (stream) {
      void element.play().catch(() => {});
    }

    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }

    element.volume = playbackVolume;
  }, [playbackVolume]);

  if (!stream) {
    return <div className={'stream-video stream-video--placeholder'}>{t('stream.video_waiting')}</div>;
  }

  return <video ref={videoRef} className={'stream-video'} autoPlay muted={muted} playsInline />;
}

function StreamSection({
  children,
  className,
  countLabel,
  description,
  title,
}: {
  children: ReactNode;
  className?: string;
  countLabel?: string;
  description: string;
  title: string;
}) {
  return (
    <section className={className ? `stream-section ${className}` : 'stream-section'}>
      <div className={'stream-section-header'}>
        <div>
          <h2 className={'stream-section-title'}>{title}</h2>
          <p className={'stream-section-description'}>{description}</p>
        </div>
        {countLabel ? <span className={'stream-section-count'}>{countLabel}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function StreamPanel() {
  const { t } = useTranslation();
  const [streamQuality, setStreamQuality] = useState(DEFAULT_STREAM_QUALITY);
  const [streamCodecPreference, setStreamCodecPreference] = useState<StreamCodecPreference>(
    DEFAULT_STREAM_CODEC_PREFERENCE,
  );
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const voiceStatus = useVoiceStore((s) => s.status);
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const watchedStreamsById = useStreamStore((s) => s.watchedStreamsById);
  const roomStateByChannel = useStreamStore((s) => s.roomStateByChannel);
  const error = useStreamStore((s) => s.error);
  const startSharing = useStreamStore((s) => s.startSharing);
  const stopSharing = useStreamStore((s) => s.stopSharing);
  const watchStream = useStreamStore((s) => s.watchStream);
  const unwatchStream = useStreamStore((s) => s.unwatchStream);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const presenceMap = useGatewayStore((s) => s.presenceMap);

  const watchedStreams = Object.values(watchedStreamsById);
  const activeChannelId = voiceChannelId ?? ownedStream?.channelId ?? watchedStreams[0]?.channelId ?? null;
  const roomStreams = activeChannelId ? Object.values(roomStateByChannel[activeChannelId] ?? {}) : [];
  const watchedStreamsInChannel = watchedStreams.filter((stream) => stream.channelId === activeChannelId);
  const watchedStreamIds = new Set(watchedStreamsInChannel.map((stream) => stream.streamId));
  const availableStreams = roomStreams.filter(
    (stream) => stream.hostUserId !== myUserId && !watchedStreamIds.has(stream.streamId),
  );
  const canShare = voiceStatus === 'active' && !!voiceChannelId && !ownedStream;
  const liveCountLabel = t('stream.live_stream_count', { count: roomStreams.length });
  const watchingCountLabel = t('stream.watching_now_count', { count: watchedStreamsInChannel.length });
  const availableCountLabel = t('stream.available_count', { count: availableStreams.length });

  if (!activeChannelId && !ownedStream && watchedStreams.length === 0 && !error) {
    return null;
  }

  function userLabel(userId: string) {
    if (userId === myUserId) {
      return t('common.you');
    }

    return presenceMap[userId]?.username ?? userId.slice(0, 8);
  }

  function handleShareScreen() {
    if (!voiceChannelId) {
      return;
    }

    void startSharing(voiceChannelId, streamQuality, 'screen', sendCommandAwaitAck, sendRawCommand, streamCodecPreference);
  }

  function handleShareCamera() {
    if (!voiceChannelId) {
      return;
    }

    void startSharing(voiceChannelId, streamQuality, 'camera', sendCommandAwaitAck, sendRawCommand, streamCodecPreference);
  }

  function handleWatch(streamId: string) {
    if (!activeChannelId) {
      return;
    }

    if (!ensureStreamPopupWindow(streamId)) {
      useStreamStore.setState({ error: t('stream.error_popup_blocked') });
      return;
    }

    void watchStream(activeChannelId, streamId, sendCommandAwaitAck, sendRawCommand).catch(() => {
      closeStreamPopup(streamId);
    });
  }

  return (
    <aside className={'stream-panel'} aria-label={t('stream.streams_label')}>
      <div className={'stream-panel-header'}>
        <div>
          <div className={'stream-panel-heading-row'}>
            <span className={'stream-panel-icon'}>LIVE</span>
            <span className={'stream-panel-label'}>{t('stream.streams_label')}</span>
          </div>
          <p className={'stream-panel-summary'}>
            {activeChannelId ? liveCountLabel : t('stream.panel_summary_join_voice')}
          </p>
        </div>
      </div>

      {error && <p className={'stream-panel-error'}>{error}</p>}

      <div className={'stream-panel-stack'}>
        <StreamSection
          className={'stream-section--watching'}
          countLabel={watchingCountLabel}
          title={t('stream.section_watching_title')}
          description={t('stream.section_watching_description')}
        >
          {watchedStreamsInChannel.length > 0 ? (
            <div className={'stream-watch-status-list'}>
              {watchedStreamsInChannel.map((stream) => (
                <article key={stream.streamId} className={'stream-watch-row'}>
                  <div className={'stream-watch-row-summary'}>
                    <div>
                      <h3 className={'stream-card-title'}>
                        {userLabel(stream.hostUserId)} | {sourceLabel(t, stream.sourceType)}
                      </h3>
                      <p className={stream.connectionError ? 'stream-card-subtitle stream-card-subtitle--error' : 'stream-card-subtitle'}>
                        {stream.connectionError
                          ? t('stream.connection_error')
                          : stream.status === 'starting'
                            ? t('stream.watching_status_starting')
                            : stream.status === 'reconnecting'
                              ? t('stream.watching_status_starting')
                              : stream.status === 'stopping'
                                ? t('stream.watching_status_stopping')
                                : stream.status === 'ended'
                                  ? t('stream.watching_status_ended')
                                  : t('stream.watching_status_watching')}
                      </p>
                    </div>
                    <span className={'stream-pill'}>
                      {stream.status === 'ended'
                        ? t('stream.pill_ended')
                        : stream.status === 'stopping'
                          ? t('stream.pill_stopping')
                          : stream.status === 'starting' || stream.status === 'reconnecting'
                            ? t('stream.pill_starting')
                            : t('stream.pill_live')}
                    </span>
                  </div>
                  <div className={'stream-watch-row-meta'}>
                    <span className={'stream-card-meta'}>
                      {t('stream.watch_row_meta', {
                        viewerCount: t('stream.viewer_count', { count: stream.viewers.length }),
                        volume: formatVolumeLabel(stream.playbackVolume),
                      })}
                    </span>
                    <span className={'stream-card-meta'}>
                      {t('stream.viewer_meta', { id: stream.streamId.slice(0, 8) })}
                    </span>
                  </div>
                  <div className={'stream-watch-row-actions'}>
                    <button
                      type={'button'}
                      className={'btn-ghost stream-action-btn'}
                      onClick={() => {
                        if (!ensureStreamPopupWindow(stream.streamId)) {
                          useStreamStore.setState({ error: t('stream.error_popup_blocked') });
                        }
                      }}
                      disabled={stream.status === 'stopping'}
                    >
                      {t('stream.action_focus_window')}
                    </button>
                    <button
                      type={'button'}
                      className={'btn-ghost stream-action-btn'}
                      onClick={() => {
                        closeStreamPopup(stream.streamId);
                        void unwatchStream(stream.streamId, sendCommandAwaitAck);
                      }}
                      disabled={stream.status === 'stopping'}
                    >
                      {t('stream.action_stop_watching')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={'stream-empty stream-empty--compact'}>
              <p className={'stream-empty-copy'}>{t('stream.section_watching_none')}</p>
            </div>
          )}
        </StreamSection>

        <StreamSection
          className={'stream-section--owned'}
          countLabel={ownedStream ? t('stream.viewer_count', { count: ownedStream.viewers.length }) : undefined}
          title={t('stream.section_owned_title')}
          description={t('stream.section_owned_description')}
        >
          {ownedStream ? (
            <article className={'stream-card stream-card--owned'}>
              <div className={'stream-card-header'}>
                <div>
                  <h3 className={'stream-card-title'}>
                    {describeOwnedStatus(t, ownedStream.status, ownedStream.sourceType)}
                  </h3>
                  <p className={'stream-card-subtitle'}>
                    {t('stream.viewer_count', { count: ownedStream.viewers.length })} |{' '}
                    {formatQualityLabel(t, ownedStream.quality, ownedStream.codecPreference)}
                  </p>
                </div>
                <span className={'stream-pill'}>{sourceLabel(t, ownedStream.sourceType)}</span>
              </div>
              <StreamVideo muted stream={ownedStream.localPreviewStream} />
              <OwnedStreamHealthPanel ownedStream={ownedStream} />
              <div className={'stream-card-actions'}>
                <button
                  type={'button'}
                  className={'btn-ghost stream-action-btn'}
                  onClick={() => {
                    void stopSharing(sendCommandAwaitAck);
                  }}
                  disabled={ownedStream.status === 'stopping'}
                >
                  {t('stream.action_stop_sharing')}
                </button>
              </div>
            </article>
          ) : canShare ? (
            <div className={'stream-empty stream-empty--actions'}>
              <p className={'stream-empty-copy'}>{t('stream.section_owned_empty')}</p>
              <div className={'stream-quality-controls'}>
                <label className={'stream-quality-field'}>
                  <span className={'stream-quality-label'}>{t('stream.quality_resolution')}</span>
                  <select
                    className={'stream-quality-select'}
                    value={streamQuality.resolution}
                    onChange={(event) =>
                      setStreamQuality((current) => ({
                        ...current,
                        resolution: event.target.value as StreamQualitySettings['resolution'],
                      }))
                    }
                  >
                    {STREAM_RESOLUTION_OPTIONS.map((resolution) => (
                      <option key={resolution} value={resolution}>
                        {resolution}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={'stream-quality-field'}>
                  <span className={'stream-quality-label'}>{t('stream.quality_frame_rate')}</span>
                  <select
                    className={'stream-quality-select'}
                    value={String(streamQuality.frameRate)}
                    onChange={(event) =>
                      setStreamQuality((current) => ({
                        ...current,
                        frameRate: Number(event.target.value) as StreamQualitySettings['frameRate'],
                      }))
                    }
                  >
                    {STREAM_FRAME_RATE_OPTIONS.map((frameRate) => (
                      <option key={frameRate} value={frameRate}>
                        {frameRate} FPS
                      </option>
                    ))}
                  </select>
                </label>
                <label className={'stream-quality-field'}>
                  <span className={'stream-quality-label'}>{t('stream.quality_bitrate')}</span>
                  <select
                    className={'stream-quality-select'}
                    value={String(streamQuality.bitrateKbps)}
                    onChange={(event) =>
                      setStreamQuality((current) => ({
                        ...current,
                        bitrateKbps: Number(event.target.value) as StreamQualitySettings['bitrateKbps'],
                      }))
                    }
                  >
                    {STREAM_BITRATE_OPTIONS.map((bitrate) => (
                      <option key={bitrate} value={bitrate}>
                        {bitrate} kbps
                      </option>
                    ))}
                  </select>
                </label>
                <label className={'stream-quality-field'}>
                  <span className={'stream-quality-label'}>{t('stream.quality_codec')}</span>
                  <select
                    className={'stream-quality-select'}
                    value={streamCodecPreference}
                    onChange={(event) => setStreamCodecPreference(event.target.value as StreamCodecPreference)}
                  >
                    {STREAM_CODEC_OPTIONS.map((codecPreference) => (
                      <option key={codecPreference} value={codecPreference}>
                        {codecPreferenceLabel(t, codecPreference)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className={'stream-share-actions'}>
                <button type={'button'} className={'btn-ghost stream-action-btn'} onClick={handleShareScreen}>
                  {t('stream.action_share_screen')}
                </button>
                <button type={'button'} className={'btn-ghost stream-action-btn'} onClick={handleShareCamera}>
                  {t('stream.action_share_camera')}
                </button>
              </div>
            </div>
          ) : (
            <div className={'stream-empty'}>
              <p className={'stream-empty-copy'}>{t('stream.section_owned_join_voice')}</p>
            </div>
          )}
        </StreamSection>

        <StreamSection
          className={'stream-section--available'}
          countLabel={availableStreams.length > 0 ? availableCountLabel : undefined}
          title={t('stream.section_available_title')}
          description={t('stream.section_available_description')}
        >
          {availableStreams.length > 0 ? (
            <div className={'stream-available-list'}>
              {availableStreams.map((stream) => (
                <article key={stream.streamId} className={'stream-card stream-card--available'}>
                  <div className={'stream-card-header'}>
                    <div>
                      <h3 className={'stream-card-title'}>{userLabel(stream.hostUserId)}</h3>
                      <p className={'stream-card-subtitle'}>
                        {sourceLabel(t, stream.sourceType)} | {t('stream.viewer_count', { count: stream.viewers.length })}
                      </p>
                    </div>
                    <span className={'stream-pill'}>{t('stream.pill_live')}</span>
                  </div>
                  <div className={'stream-card-actions'}>
                    <span className={'stream-card-meta'}>{t('stream.section_available_opens_in_popup')}</span>
                    <button
                      type={'button'}
                      className={'btn-ghost stream-action-btn stream-action-btn--primary'}
                      onClick={() => handleWatch(stream.streamId)}
                    >
                      {t('stream.action_watch_stream')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={'stream-empty'}>
              <p className={'stream-empty-copy'}>{t('stream.section_available_none')}</p>
            </div>
          )}
        </StreamSection>
      </div>
    </aside>
  );
}
