import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { StreamQualitySettings } from '@baker/protocol';

import './stream-ui.css';

import { useAuthStore } from '../auth/auth-store';
import { useGatewayStore } from '../gateway/gateway-store';
import { sendCommandAwaitAck, sendRawCommand } from '../gateway/gateway-store';
import {
  loadStreamQualityPreference,
  loadStringOptionPreference,
  saveClientPreferencesPatch,
  saveStreamQualityPreference,
} from '../preferences/client-preferences';
import { useVoiceStore } from '../voice/voice-store';
import {
  type CameraOption,
  DEFAULT_STREAM_CODEC_PREFERENCE,
  DEFAULT_STREAM_QUALITY,
  STREAM_BITRATE_OPTIONS,
  STREAM_CODEC_OPTIONS,
  STREAM_FRAME_RATE_OPTIONS,
  STREAM_RESOLUTION_OPTIONS,
  type StreamCodecPreference,
} from './stream-media';
import {
  getOwnedStreamVideoStats,
  getWatchedStreamVideoStats,
  type OwnedStreamVideoStats,
  type WatchedStreamState,
  type WatchedStreamVideoStats,
  useStreamStore,
} from './stream-store';

const STREAM_DETAIL_STATS_POLL_INTERVAL_MS = 1000;

type VoiceHealthLevel = 'danger' | 'good' | 'warn';
type LiveStatsState =
  | { kind: 'none'; stats: null }
  | { kind: 'owned'; stats: OwnedStreamVideoStats | null }
  | { kind: 'watched'; stats: WatchedStreamVideoStats | null };

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

function cameraOptionLabel(t: TFunction, option: CameraOption) {
  if (option.selection.kind === 'facing') {
    return option.selection.facingMode === 'user' ? 'Front Camera' : 'Rear Camera';
  }

  if (option.selection.kind === 'default') {
    return t('stream.source_camera');
  }

  return option.label?.trim() || t('stream.source_camera');
}

function formatNullableValue(value: number | string | null | undefined, suffix?: string) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  return suffix ? `${value} ${suffix}` : String(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '--';
  }

  return `${Math.max(0, Math.round(value))}%`;
}

function formatLatency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '--';
  }

  return `${Math.max(0, Math.round(value))}ms`;
}

function formatVolumeLabel(volume: number) {
  return `${Math.round(volume * 100)}%`;
}

function formatPacketLoss(stats: WatchedStreamVideoStats | null) {
  if (!stats || stats.packetsLost === null || stats.packetsReceived === null) {
    return '--';
  }

  return `${stats.packetsLost} / ${stats.packetsReceived}`;
}

function sourceLabel(t: TFunction, sourceType: 'camera' | 'screen' | 'stream' | null | undefined) {
  if (sourceType === 'camera') {
    return t('stream.source_camera');
  }

  if (sourceType === 'screen') {
    return t('stream.source_screen');
  }

  return t('stream.source_stream');
}

function voiceStatusLabel(t: TFunction, status: ReturnType<typeof useVoiceStore.getState>['status']) {
  switch (status) {
    case 'active':
      return t('voice.connected_short');
    case 'joining':
    case 'requesting_mic':
      return t('voice.status_connecting');
    case 'reconnecting':
      return t('gateway.reconnecting');
    case 'error':
      return t('voice.error_title');
    case 'leaving':
      return t('voice.leave');
    case 'idle':
    default:
      return t('stream.voice_health_not_connected');
  }
}

function limitationReasonLabel(t: TFunction, reason: OwnedStreamVideoStats['qualityLimitationReason'] | null | undefined) {
  switch (reason) {
    case 'bandwidth':
      return t('stream.health_reason_bandwidth');
    case 'cpu':
      return t('stream.health_reason_cpu');
    case 'other':
      return t('stream.health_reason_other');
    case 'none':
    default:
      return t('stream.health_reason_none');
  }
}

function VoiceHealthPanel() {
  const { t } = useTranslation();
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const gatewayRttMs = useGatewayStore((s) => s.gatewayRttMs);
  const voiceNetworkByChannel = useGatewayStore((s) => s.voiceNetworkByChannel);
  const channelId = useVoiceStore((s) => s.channelId);
  const connectionIssue = useVoiceStore((s) => s.connectionIssue);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const localMediaSelfLossPct = useVoiceStore((s) => s.localMediaSelfLossPct);
  const localMediaSelfUpdatedAt = useVoiceStore((s) => s.localMediaSelfUpdatedAt);
  const participants = useVoiceStore((s) => s.participants);
  const status = useVoiceStore((s) => s.status);

  const networkSnapshot = channelId && myUserId ? voiceNetworkByChannel[channelId]?.[myUserId] : null;
  const gatewayLossPct = networkSnapshot?.gatewayLossPct ?? null;
  const mediaLossPct = localMediaSelfLossPct ?? networkSnapshot?.mediaSelfLossPct ?? null;
  const localStatsStale =
    localMediaSelfUpdatedAt !== null && Date.now() - localMediaSelfUpdatedAt > 15_000;
  const isStale = networkSnapshot?.stale ?? localStatsStale;

  const healthLevel: VoiceHealthLevel = useMemo(() => {
    if (connectionIssue || status === 'error' || (gatewayRttMs !== null && gatewayRttMs > 300)) {
      return 'danger';
    }

    if ((gatewayLossPct ?? 0) >= 5 || (mediaLossPct ?? 0) >= 5) {
      return 'danger';
    }

    if (
      status === 'joining' ||
      status === 'requesting_mic' ||
      status === 'reconnecting' ||
      status === 'leaving' ||
      isStale ||
      (gatewayRttMs !== null && gatewayRttMs >= 150) ||
      (gatewayLossPct ?? 0) >= 2 ||
      (mediaLossPct ?? 0) >= 2
    ) {
      return 'warn';
    }

    return status === 'active' ? 'good' : 'warn';
  }, [connectionIssue, gatewayLossPct, gatewayRttMs, isStale, mediaLossPct, status]);

  const healthLabel =
    healthLevel === 'danger'
      ? t('stream.voice_health_danger')
      : healthLevel === 'warn'
        ? t('stream.voice_health_warn')
        : t('stream.voice_health_good');

  return (
    <section className={'stream-section stream-dashboard-section stream-dashboard-section--voice'}>
      <header className={'stream-section-header'}>
        <div>
          <h2 className={'stream-section-title'}>{t('stream.voice_health_title')}</h2>
          <p className={'stream-section-description'}>{t('stream.voice_health_description')}</p>
        </div>
        <span className={`stream-pill stream-pill--${healthLevel}`}>{healthLabel}</span>
      </header>

      <div className={'stream-dashboard-grid'}>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.voice_health_connection')}</span>
          <strong>{voiceStatusLabel(t, status)}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.voice_health_gateway_rtt')}</span>
          <strong>{formatLatency(gatewayRttMs)}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.voice_health_gateway_loss')}</span>
          <strong>{formatPercent(gatewayLossPct)}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.voice_health_media_loss')}</span>
          <strong>{formatPercent(mediaLossPct)}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.voice_health_freshness')}</span>
          <strong>{isStale ? t('stream.voice_health_stale') : t('stream.voice_health_fresh')}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.voice_health_members')}</span>
          <strong>{participants.length}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.voice_health_microphone')}</span>
          <strong>{isMuted ? t('voice.muted_label') : t('voice.mic_on_label')}</strong>
        </div>
      </div>

      {connectionIssue ? <p className={'stream-dashboard-warning'}>{t('voice.error_connection_issue')}</p> : null}
    </section>
  );
}

function LiveDetailPanel() {
  const { t } = useTranslation();
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const watchedStreamsById = useStreamStore((s) => s.watchedStreamsById);
  const watchedStream = useMemo<WatchedStreamState | null>(
    () => Object.values(watchedStreamsById).find((entry) => entry.status !== 'ended') ?? null,
    [watchedStreamsById],
  );
  const [statsState, setStatsState] = useState<LiveStatsState>({ kind: 'none', stats: null });
  const hasLiveData = !!ownedStream || !!watchedStream;

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function refreshStats() {
      if (ownedStream) {
        const stats = await getOwnedStreamVideoStats();
        if (!cancelled) {
          setStatsState({ kind: 'owned', stats });
        }
        return;
      }

      if (watchedStream) {
        const stats = await getWatchedStreamVideoStats(watchedStream.streamId);
        if (!cancelled) {
          setStatsState({ kind: 'watched', stats });
        }
        return;
      }

      setStatsState({ kind: 'none', stats: null });
    }

    void refreshStats();
    interval = setInterval(() => {
      void refreshStats();
    }, STREAM_DETAIL_STATS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [ownedStream, watchedStream]);

  const liveStatus = ownedStream
    ? ownedStream.status === 'live'
      ? t('stream.pill_live')
      : ownedStream.status === 'stopping'
        ? t('stream.pill_stopping')
        : t('stream.pill_starting')
    : watchedStream
      ? watchedStream.status === 'watching'
        ? t('stream.pill_live')
        : watchedStream.status === 'ended'
          ? t('stream.pill_ended')
          : t('stream.pill_starting')
      : t('stream.live_detail_none');

  const activeStats = statsState.stats;

  if (!hasLiveData) {
    return null;
  }

  return (
    <section className={'stream-section stream-dashboard-section stream-dashboard-section--live'}>
      <header className={'stream-section-header'}>
        <div>
          <h2 className={'stream-section-title'}>{t('stream.live_detail_title')}</h2>
          <p className={'stream-section-description'}>
            {ownedStream
              ? t('stream.live_detail_owned_description')
              : watchedStream
                ? t('stream.live_detail_watched_description')
                : t('stream.live_detail_empty')}
          </p>
        </div>
        <span className={'stream-pill'}>{liveStatus}</span>
      </header>

      <div className={'stream-dashboard-grid'}>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.live_detail_source')}</span>
          <strong>{sourceLabel(t, ownedStream?.sourceType ?? watchedStream?.sourceType ?? null)}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.live_detail_viewers')}</span>
          <strong>{ownedStream?.viewers.length ?? watchedStream?.viewers.length ?? 0}</strong>
        </div>
        {ownedStream ? (
          <div className={'stream-dashboard-item'}>
            <span>{t('stream.live_detail_target_quality')}</span>
            <strong>{`${ownedStream.quality.resolution} / ${ownedStream.quality.frameRate} fps / ${ownedStream.quality.bitrateKbps} kbps`}</strong>
          </div>
        ) : watchedStream ? (
          <div className={'stream-dashboard-item'}>
            <span>{t('stream.popup_stream_volume')}</span>
            <strong>{formatVolumeLabel(watchedStream.playbackVolume)}</strong>
          </div>
        ) : null}
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.popup_stats_codec')}</span>
          <strong>{formatNullableValue(activeStats?.codec)}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.popup_stats_resolution')}</span>
          <strong>{formatNullableValue(activeStats?.resolution)}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.popup_stats_frame_rate')}</span>
          <strong>{formatNullableValue(activeStats?.frameRate, 'fps')}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.popup_stats_bitrate')}</span>
          <strong>{formatNullableValue(activeStats?.bitrateKbps, 'kbps')}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.popup_stats_packet_loss')}</span>
          <strong>{statsState.kind === 'watched' ? formatPacketLoss(statsState.stats) : '--'}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.popup_stats_jitter')}</span>
          <strong>{statsState.kind === 'watched' ? formatNullableValue(statsState.stats?.jitterMs, 'ms') : '--'}</strong>
        </div>
        <div className={'stream-dashboard-item'}>
          <span>{t('stream.popup_stats_frames_dropped')}</span>
          <strong>{statsState.kind === 'watched' ? formatNullableValue(statsState.stats?.framesDropped) : '--'}</strong>
        </div>
        {statsState.kind === 'owned' ? (
          <>
            <div className={'stream-dashboard-item'}>
              <span>{t('stream.health_active_peers')}</span>
              <strong>{statsState.stats?.activePeerCount ?? 0}</strong>
            </div>
            <div className={'stream-dashboard-item'}>
              <span>{t('stream.health_limitation_reason')}</span>
              <strong>{limitationReasonLabel(t, statsState.stats?.qualityLimitationReason)}</strong>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

export interface StreamPanelProps {
  isShareDialogOpen: boolean;
  onCloseShareDialog: () => void;
}

export function StreamPanel({ isShareDialogOpen, onCloseShareDialog }: StreamPanelProps) {
  const { t } = useTranslation();
  const [streamQuality, setStreamQuality] = useState(() =>
    loadStreamQualityPreference(DEFAULT_STREAM_QUALITY, {
      bitrates: STREAM_BITRATE_OPTIONS,
      frameRates: STREAM_FRAME_RATE_OPTIONS,
      resolutions: STREAM_RESOLUTION_OPTIONS,
    }),
  );
  const [streamCodecPreference, setStreamCodecPreference] = useState<StreamCodecPreference>(
    () => loadStringOptionPreference('streamCodecPreference', DEFAULT_STREAM_CODEC_PREFERENCE, STREAM_CODEC_OPTIONS),
  );
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const voiceStatus = useVoiceStore((s) => s.status);
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const cameraOptions = useStreamStore((s) => s.cameraOptions);
  const selectedCameraKey = useStreamStore((s) => s.selectedCameraKey);
  const isRefreshingCameras = useStreamStore((s) => s.isRefreshingCameras);
  const isSwitchingCamera = useStreamStore((s) => s.isSwitchingCamera);
  const refreshCameraOptions = useStreamStore((s) => s.refreshCameraOptions);
  const selectCamera = useStreamStore((s) => s.selectCamera);
  const startSharing = useStreamStore((s) => s.startSharing);
  const canShare = voiceStatus === 'active' && !!voiceChannelId && !ownedStream;

  useEffect(() => {
    void refreshCameraOptions();
  }, [refreshCameraOptions]);

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

  function handleShareScreenFromDialog() {
    onCloseShareDialog();
    handleShareScreen();
  }

  function handleShareCameraFromDialog() {
    onCloseShareDialog();
    handleShareCamera();
  }

  function handleStreamQualityChange(patch: Partial<StreamQualitySettings>) {
    const nextQuality = { ...streamQuality, ...patch };
    setStreamQuality(nextQuality);
    saveStreamQualityPreference(nextQuality);
  }

  function handleStreamCodecPreferenceChange(codecPreference: StreamCodecPreference) {
    setStreamCodecPreference(codecPreference);
    saveClientPreferencesPatch({ streamCodecPreference: codecPreference });
  }

  function renderCameraSourceControl(disabled: boolean) {
    const selectValue = selectedCameraKey ?? cameraOptions[0]?.key ?? 'camera-refreshing';

    return (
      <div className={'stream-camera-controls'}>
        <label className={'stream-quality-field'}>
          <span className={'stream-quality-label'}>{t('stream.source_camera')}</span>
          <select
            className={'stream-quality-select'}
            value={selectValue}
            onChange={(event) => {
              void selectCamera(event.target.value);
            }}
            disabled={disabled || isRefreshingCameras || cameraOptions.length === 0}
          >
            {cameraOptions.length > 0 ? (
              cameraOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {cameraOptionLabel(t, option)}
                </option>
              ))
            ) : (
              <option value={'camera-refreshing'}>{t('common.loading')}</option>
            )}
          </select>
        </label>
        {isSwitchingCamera ? (
          <p className={'stream-camera-status'}>{t('common.please_wait')}</p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <aside className={'stream-panel stream-dashboard-panel'} aria-label={t('stream.streams_label')}>
        <VoiceHealthPanel />
        <LiveDetailPanel />
      </aside>
      {canShare && isShareDialogOpen ? (
        <div
          className={'stream-share-dialog-backdrop'}
          role={'presentation'}
          onMouseDown={onCloseShareDialog}
        >
          <section
            className={'stream-share-dialog'}
            role={'dialog'}
            aria-modal={'true'}
            aria-labelledby={'stream-share-dialog-title'}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={'stream-share-dialog-header'}>
              <div>
                <p className={'stream-panel-icon stream-share-dialog-kicker'}>LIVE</p>
                <h2 id={'stream-share-dialog-title'} className={'stream-share-dialog-title'}>
                  {t('stream.share_dialog_title')}
                </h2>
                <p className={'stream-share-dialog-copy'}>{t('stream.share_dialog_description')}</p>
              </div>
              <button
                type={'button'}
                className={'btn-ghost stream-share-dialog-close'}
                onClick={onCloseShareDialog}
              >
                {t('stream.share_dialog_close')}
              </button>
            </header>

            <div className={'stream-share-dialog-body'}>
              <div className={'stream-quality-controls'}>
                <label className={'stream-quality-field'}>
                  <span className={'stream-quality-label'}>{t('stream.quality_resolution')}</span>
                  <select
                    className={'stream-quality-select'}
                    value={streamQuality.resolution}
                    onChange={(event) =>
                      handleStreamQualityChange({
                        resolution: event.target.value as StreamQualitySettings['resolution'],
                      })
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
                      handleStreamQualityChange({
                        frameRate: Number(event.target.value) as StreamQualitySettings['frameRate'],
                      })
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
                      handleStreamQualityChange({
                        bitrateKbps: Number(event.target.value) as StreamQualitySettings['bitrateKbps'],
                      })
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
                    onChange={(event) =>
                      handleStreamCodecPreferenceChange(event.target.value as StreamCodecPreference)
                    }
                  >
                    {STREAM_CODEC_OPTIONS.map((codecPreference) => (
                      <option key={codecPreference} value={codecPreference}>
                        {codecPreferenceLabel(t, codecPreference)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {renderCameraSourceControl(isSwitchingCamera)}
            </div>

            <footer className={'stream-share-dialog-actions'}>
              <button
                type={'button'}
                className={'btn-ghost stream-action-btn'}
                onClick={handleShareScreenFromDialog}
              >
                {t('stream.action_share_screen')}
              </button>
              <button
                type={'button'}
                className={'btn-ghost stream-action-btn stream-action-btn--primary'}
                onClick={handleShareCameraFromDialog}
                disabled={isSwitchingCamera}
              >
                {t('stream.action_share_camera')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
