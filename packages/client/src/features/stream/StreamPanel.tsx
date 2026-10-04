import { useEffect, useMemo, useState } from 'react';
import { getStreamHdrStatus } from './stream-hdr';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import './stream-ui.css';

import { useAuthStore } from '../auth/auth-store';
import { useGatewayStore } from '../gateway/gateway-store';
import { useVoiceStore } from '../voice/voice-store';
import {
  NetworkStatusButton,
  type NetworkStatusLevel,
  type NetworkStatusMetric,
} from '../voice/NetworkStatusButton';
import {
  getOwnedStreamVideoStats,
  getStreamDiagnostics,
  getWatchedStreamVideoStats,
  type OwnedStreamVideoStats,
  type WatchedStreamState,
  type WatchedStreamVideoStats,
  useStreamStore,
} from './stream-store';
import { diagnoseStream, type StreamDiagnosis } from './stream-diagnostics';
import { StreamDiagnosticsSummary, type StreamBitrateHistoryPoint } from './StreamDiagnosticsSummary';

const STREAM_DASHBOARD_REFRESH_INTERVAL_MS = 2000;

type VoiceHealthLevel = 'danger' | 'good' | 'warn';
type LiveStatsState =
  | { kind: 'none'; stats: null }
  | { kind: 'owned'; stats: OwnedStreamVideoStats | null }
  | { kind: 'watched'; stats: WatchedStreamVideoStats | null };

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

  return `${Math.max(0, Math.round(value * 100) / 100)}%`;
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

function accelerationLabel(
  t: TFunction,
  value: 'hardware' | 'software' | 'unknown' | null | undefined,
) {
  return t(`stream.acceleration_${value ?? 'unknown'}` as const);
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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const gatewayRttMs = useGatewayStore((s) => s.gatewayRttMs);
  const voiceNetworkByChannel = useGatewayStore((s) => s.voiceNetworkByChannel);
  const channelId = useVoiceStore((s) => s.channelId);
  const connectionIssue = useVoiceStore((s) => s.connectionIssue);
  const localMediaSelfLossPct = useVoiceStore((s) => s.localMediaSelfLossPct);
  const localMediaSelfUpdatedAt = useVoiceStore((s) => s.localMediaSelfUpdatedAt);
  const participants = useVoiceStore((s) => s.participants);
  const status = useVoiceStore((s) => s.status);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), STREAM_DASHBOARD_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const networkSnapshot = channelId && myUserId ? voiceNetworkByChannel[channelId]?.[myUserId] : null;
  const gatewayLossPct = networkSnapshot?.gatewayLossPct ?? null;
  const mediaLossPct = localMediaSelfLossPct ?? networkSnapshot?.mediaSelfLossPct ?? null;
  const localStatsStale =
    localMediaSelfUpdatedAt !== null && nowMs - localMediaSelfUpdatedAt > 15_000;
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
      <div className={`stream-voice-health-bubble stream-voice-health-bubble--${healthLevel}`}>
        <header className={'stream-voice-health-header'}>
          <h2 className={'stream-section-title'}>{t('stream.voice_health_title')}</h2>
          <span className={`stream-pill stream-pill--${healthLevel}`}>{healthLabel}</span>
        </header>

        <dl className={'stream-voice-health-list'}>
          <div className={'stream-voice-health-row'}>
            <dt>{t('stream.voice_health_connection')}</dt>
            <dd>{voiceStatusLabel(t, status)}</dd>
          </div>
          <div className={'stream-voice-health-row'}>
            <dt>{t('stream.voice_health_gateway_rtt')}</dt>
            <dd>{formatLatency(gatewayRttMs)}</dd>
          </div>
          <div className={'stream-voice-health-row'}>
            <dt>{t('stream.voice_health_gateway_loss')}</dt>
            <dd>{formatPercent(gatewayLossPct)}</dd>
          </div>
          <div className={'stream-voice-health-row'}>
            <dt>{t('stream.voice_health_media_loss')}</dt>
            <dd>{formatPercent(mediaLossPct)}</dd>
          </div>
          <div className={'stream-voice-health-row'}>
            <dt>{t('stream.voice_health_freshness')}</dt>
            <dd>{isStale ? t('stream.voice_health_stale') : t('stream.voice_health_fresh')}</dd>
          </div>
          <div className={'stream-voice-health-row'}>
            <dt>{t('stream.voice_health_members')}</dt>
            <dd>{participants.length}</dd>
          </div>
        </dl>

        {connectionIssue ? <p className={'stream-voice-health-warning'}>{t('voice.error_connection_issue')}</p> : null}
      </div>
    </section>
  );
}

function LiveDetailPanel() {
  const { t } = useTranslation();
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const watchedStreamsById = useStreamStore((s) => s.watchedStreamsById);
  const watchedStreams = useMemo(
    () => Object.values(watchedStreamsById).filter((entry) => entry.status !== 'ended'),
    [watchedStreamsById],
  );
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);
  const watchedStream = useMemo<WatchedStreamState | null>(
    () => watchedStreams.find((entry) => entry.streamId === selectedStreamId) ??
      (selectedStreamId === null ? watchedStreams[0] ?? null : null),
    [selectedStreamId, watchedStreams],
  );
  const activeOwnedStream =
    ownedStream &&
    (ownedStream.streamId === selectedStreamId || (selectedStreamId === null && watchedStreams.length === 0))
      ? ownedStream
      : null;
  const [statsState, setStatsState] = useState<LiveStatsState>({
    kind: 'none',
    stats: null,
  });
  const [diagnostics, setDiagnostics] =
    useState<Awaited<ReturnType<typeof getStreamDiagnostics>>>(null);
  const [diagnosisState, setDiagnosisState] = useState<{
    candidate: StreamDiagnosis;
    count: number;
    stable: StreamDiagnosis;
  }>({
    candidate: 'insufficient',
    count: 0,
    stable: 'insufficient',
  });
  const [history, setHistory] = useState<StreamBitrateHistoryPoint[]>([]);
  const streamOptions = useMemo(() => [
    ...watchedStreams.map((entry) => ({ id: entry.streamId, label: `${t('stream.section_watching_title')} · ${entry.streamId.slice(0, 8)}` })),
    ...(ownedStream?.streamId ? [{ id: ownedStream.streamId, label: `${t('stream.section_owned_title')} · ${ownedStream.streamId.slice(0, 8)}` }] : []),
  ], [ownedStream?.streamId, t, watchedStreams]);
  const hasLiveData = !!activeOwnedStream || !!watchedStream;

  useEffect(() => {
    if (selectedStreamId && streamOptions.some((entry) => entry.id === selectedStreamId)) return;
    setSelectedStreamId(watchedStreams[0]?.streamId ?? ownedStream?.streamId ?? null);
  }, [ownedStream?.streamId, selectedStreamId, streamOptions, watchedStreams]);

  useEffect(() => {
    setHistory([]);
    setDiagnosisState({ candidate: 'insufficient', count: 0, stable: 'insufficient' });
  }, [selectedStreamId]);

  function appendHistory(
    details: Awaited<ReturnType<typeof getStreamDiagnostics>>,
    receiver: WatchedStreamVideoStats | null,
  ) {
    const point: StreamBitrateHistoryPoint = {
      at: Date.now(),
      sender: details?.publisher?.bitrateKbps ?? null,
      ingress: details?.sfu?.ingress?.bitrateKbps ?? null,
      egress: details?.sfu?.egress?.bitrateKbps ?? null,
      receiver: receiver?.bitrateKbps ?? null,
    };
    setHistory((current) => [...current, point].filter((entry) => point.at - entry.at <= 60_000).slice(-30));
  }

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function refreshStats() {
      if (watchedStream) {
        const [stats, details] = await Promise.all([
          getWatchedStreamVideoStats(watchedStream.streamId),
          getStreamDiagnostics(watchedStream.streamId),
        ]);
        if (!cancelled) {
          setStatsState({ kind: 'watched', stats });
          setDiagnostics(details);
          appendHistory(details, stats);
          const next = diagnoseStream(details, stats);
          setDiagnosisState((current) => {
            const count = current.candidate === next ? current.count + 1 : 1;
            return {
              candidate: next,
              count,
              stable: count >= 2 ? next : current.stable,
            };
          });
        }
        return;
      }

      if (activeOwnedStream?.streamId) {
        const [stats, details] = await Promise.all([
          getOwnedStreamVideoStats(),
          getStreamDiagnostics(activeOwnedStream.streamId),
        ]);
        if (!cancelled) {
          setStatsState({ kind: 'owned', stats });
          setDiagnostics(details);
          appendHistory(details, null);
          const next = diagnoseStream(details, null);
          setDiagnosisState((current) => {
            const count = current.candidate === next ? current.count + 1 : 1;
            return {
              candidate: next,
              count,
              stable: count >= 2 ? next : current.stable,
            };
          });
        }
        return;
      }

      setStatsState({ kind: 'none', stats: null });
      setDiagnostics(null);
    }

    void refreshStats();
    interval = setInterval(() => {
      void refreshStats();
    }, STREAM_DASHBOARD_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [activeOwnedStream, watchedStream]);

  const liveStatus = activeOwnedStream
    ? activeOwnedStream.status === 'live'
      ? t('stream.pill_live')
      : activeOwnedStream.status === 'stopping'
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
  const captureFrameRate = activeOwnedStream?.localPreviewStream?.getVideoTracks()[0]?.getSettings().frameRate ?? null;
  const captureBelowTarget = Boolean(
    activeOwnedStream && captureFrameRate !== null && captureFrameRate < activeOwnedStream.quality.frameRate * 0.85,
  );
  const watchedPacketLossPct =
    statsState.kind === 'watched' &&
    statsState.stats?.packetsLost !== null &&
    statsState.stats?.packetsLost !== undefined &&
    statsState.stats?.packetsReceived !== null &&
    statsState.stats?.packetsReceived !== undefined &&
    statsState.stats.packetsLost + statsState.stats.packetsReceived > 0
      ? (statsState.stats.packetsLost /
          (statsState.stats.packetsLost + statsState.stats.packetsReceived)) *
        100
      : null;
  let streamNetworkLevel: NetworkStatusLevel = 'warn';
  if (activeStats) {
    if (statsState.kind === 'owned') {
      streamNetworkLevel =
        statsState.stats?.encoderLimited || statsState.stats?.qualityLimitationReason === 'bandwidth'
          ? 'danger'
          : statsState.stats?.qualityLimitationReason === 'other'
            ? 'warn'
            : 'good';
    } else if (statsState.kind === 'watched') {
      streamNetworkLevel =
        (watchedPacketLossPct ?? 0) >= 5 || (statsState.stats?.jitterMs ?? 0) >= 80
          ? 'danger'
          : (watchedPacketLossPct ?? 0) >= 1 || (statsState.stats?.jitterMs ?? 0) >= 35
            ? 'warn'
            : 'good';
    }
  }
  const diagnosis = diagnosisState.stable;
  const diagnosisKey = `stream.diagnosis_${diagnosis}` as const;
  const streamNetworkSummary = t(diagnosisKey);
  streamNetworkLevel =
    diagnosis === 'healthy'
      ? 'good'
      : diagnosis === 'insufficient'
        ? 'warn'
        : 'danger';
  const publisher = diagnostics?.publisher;
  const ingress = diagnostics?.sfu?.ingress;
  const egress = diagnostics?.sfu?.egress;
  const streamNetworkMetrics: NetworkStatusMetric[] = [
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.health_preferred_codec'),
      value: formatNullableValue(publisher?.requestedCodec?.toUpperCase()),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.health_actual_codec'),
      value: formatNullableValue(publisher?.actualCodec?.toUpperCase()),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.diagnostics_acceleration'),
      value: accelerationLabel(t, publisher?.encoderAcceleration),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.diagnostics_implementation'),
      value: formatNullableValue(publisher?.encoderImplementation),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.quality_bitrate_limit'),
      value: formatNullableValue(publisher?.targetBitrateKbps, 'kbps'),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.diagnostics_encoder_target'),
      value: formatNullableValue(publisher?.encoderTargetBitrateKbps, 'kbps'),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.diagnostics_available_bitrate'),
      value: formatNullableValue(publisher?.availableOutgoingBitrateKbps, 'kbps'),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.diagnostics_encode_time'),
      value: formatNullableValue(publisher?.averageEncodeTimeMs, 'ms'),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.diagnostics_transport'),
      value: [publisher?.transportProtocol, publisher?.localCandidateType, publisher?.remoteCandidateType]
        .filter(Boolean)
        .join(' / ') || '--',
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.live_detail_capture_frame_rate'),
      value: formatNullableValue(publisher?.captureFrameRate, 'fps'),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.health_actual_frame_rate'),
      value: formatNullableValue(publisher?.encodedFrameRate, 'fps'),
    },
    {
      group: t('stream.diagnostics_sender'),
      label: t('stream.health_send_bitrate'),
      value: formatNullableValue(publisher?.bitrateKbps, 'kbps'),
    },
    {
      group: t('stream.diagnostics_sfu_ingress'),
      label: t('stream.diagnostics_mode'),
      value:
        diagnostics?.mediaMode === 'p2p'
          ? t('stream.diagnostics_not_applicable')
          : formatNullableValue(diagnostics?.mediaMode?.toUpperCase()),
    },
    {
      group: t('stream.diagnostics_sfu_ingress'),
      label: t('stream.popup_stats_bitrate'),
      value: formatNullableValue(ingress?.bitrateKbps, 'kbps'),
    },
    {
      group: t('stream.diagnostics_sfu_ingress'),
      label: t('stream.diagnostics_score'),
      value: formatNullableValue(ingress?.score),
    },
    {
      group: t('stream.diagnostics_sfu_ingress'),
      label: t('stream.popup_stats_packet_loss'),
      value: formatNullableValue(ingress?.windowPacketsLost ?? ingress?.packetsLost),
    },
    {
      group: t('stream.diagnostics_sfu_ingress'),
      label: t('stream.diagnostics_transport'),
      value: [ingress?.transportProtocol, ingress?.iceState, ingress?.dtlsState].filter(Boolean).join(' / ') || '--',
    },
    {
      group: t('stream.diagnostics_server'),
      label: t('stream.diagnostics_worker_cpu'),
      value: formatNullableValue(diagnostics?.sfu?.workerCpuPct, '%'),
    },
    {
      group: t('stream.diagnostics_server'),
      label: t('stream.diagnostics_query_latency'),
      value: formatNullableValue(diagnostics?.sfu?.queryLatencyMs, 'ms'),
    },
    {
      group: t('stream.diagnostics_server'),
      label: t('stream.diagnostics_egress_bitrate'),
      value: formatNullableValue(egress?.bitrateKbps, 'kbps'),
    },
    {
      group: t('stream.diagnostics_server'),
      label: t('stream.diagnostics_available_bitrate'),
      value: formatNullableValue(egress?.availableOutgoingBitrateKbps, 'kbps'),
    },
    {
      group: t('stream.diagnostics_server'),
      label: t('stream.diagnostics_transport'),
      value: [egress?.transportProtocol, egress?.iceState, egress?.dtlsState].filter(Boolean).join(' / ') || '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.popup_stats_bitrate'),
      value: formatNullableValue(activeStats?.bitrateKbps, 'kbps'),
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.popup_stats_frame_rate'),
      value: formatNullableValue(activeStats?.frameRate, 'fps'),
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_acceleration'),
      value:
        statsState.kind === 'watched'
          ? accelerationLabel(t, statsState.stats?.decoderAcceleration)
          : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_implementation'),
      value: statsState.kind === 'watched' ? formatNullableValue(statsState.stats?.decoderImplementation) : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_available_bitrate'),
      value: statsState.kind === 'watched'
        ? formatNullableValue(statsState.stats?.availableIncomingBitrateKbps, 'kbps')
        : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_receive_frame_rate'),
      value: statsState.kind === 'watched' ? formatNullableValue(statsState.stats?.receiveFrameRate, 'fps') : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_decode_frame_rate'),
      value: statsState.kind === 'watched' ? formatNullableValue(statsState.stats?.decodeFrameRate, 'fps') : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_render_frame_rate'),
      value: statsState.kind === 'watched' ? formatNullableValue(statsState.stats?.renderFrameRate, 'fps') : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_transport'),
      value: statsState.kind === 'watched'
        ? [statsState.stats?.transportProtocol, statsState.stats?.localCandidateType, statsState.stats?.remoteCandidateType]
            .filter(Boolean)
            .join(' / ') || '--'
        : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.popup_stats_packet_loss'),
      value:
        watchedPacketLossPct === null
          ? '--'
          : `${watchedPacketLossPct.toFixed(1)}%`,
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.popup_stats_jitter'),
      value:
        statsState.kind === 'watched'
          ? formatNullableValue(statsState.stats?.jitterMs, 'ms')
          : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_jitter_buffer'),
      value:
        statsState.kind === 'watched'
          ? formatNullableValue(statsState.stats?.jitterBufferDelayMs, 'ms')
          : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_freezes'),
      value:
        statsState.kind === 'watched'
          ? `${formatNullableValue(statsState.stats?.freezeCount)} / ${formatNullableValue(statsState.stats?.freezeDurationMs, 'ms')}`
          : '--',
    },
    {
      group: t('stream.diagnostics_receiver'),
      label: t('stream.diagnostics_decode_time'),
      value:
        statsState.kind === 'watched'
          ? formatNullableValue(statsState.stats?.averageDecodeTimeMs, 'ms')
          : '--',
    },
  ];

  if (!hasLiveData) {
    return null;
  }

  return (
    <section className={'stream-section stream-dashboard-section stream-dashboard-section--live'}>
      <div className={'stream-live-detail-bubble'}>
        {streamOptions.length > 1 ? (
          <label className="stream-diagnostics-selector">
            <span>{t('stream.live_detail_title')}</span>
            <select value={selectedStreamId ?? ''} onChange={(event) => setSelectedStreamId(event.target.value)}>
              {streamOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </label>
        ) : null}
        <header className={'stream-live-detail-header'}>
          <h2 className={'stream-section-title'}>{t('stream.live_detail_title')}</h2>
          <div className="stream-live-detail-actions">
            <span className={'stream-pill'}>{liveStatus}</span>
            <NetworkStatusButton
              detailsLabel={t('stream.network_details')}
              label={t('stream.network_status')}
              level={streamNetworkLevel}
              metrics={streamNetworkMetrics}
              summary={streamNetworkSummary}
            />
          </div>
        </header>

        <StreamDiagnosticsSummary
          diagnosis={diagnosis}
          diagnostics={diagnostics}
          history={history}
          receiver={statsState.kind === 'watched' ? statsState.stats : null}
          showHistory
        />

        <dl className={'stream-live-detail-list'}>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.live_detail_source')}</dt>
            <dd>
              {sourceLabel(
                t,
                activeOwnedStream?.sourceType ?? watchedStream?.sourceType ?? null,
              )}
            </dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.live_detail_viewers')}</dt>
            <dd>
              {activeOwnedStream?.viewers.length ??
                watchedStream?.viewers.length ??
                0}
            </dd>
          </div>
        {activeOwnedStream ? (
          <>
            <div className={'stream-live-detail-row'}>
              <dt>{t('stream.hdr_correction')}</dt>
              <dd>{t(`stream.hdr_${getStreamHdrStatus(activeOwnedStream.localPreviewStream)}`)}</dd>
            </div>
            <div className={'stream-live-detail-row'}>
              <dt>{t('stream.live_detail_target_quality')}</dt>
              <dd>{`${activeOwnedStream.quality.resolution} / ${activeOwnedStream.quality.frameRate} fps / ${activeOwnedStream.quality.bitrateKbps} kbps`}</dd>
            </div>
            <div className={'stream-live-detail-row'}>
              <dt>{t('stream.live_detail_capture_frame_rate')}</dt>
                <dd
                  className={
                    captureBelowTarget
                      ? 'stream-live-detail-warning'
                      : undefined
                  }
                >
                {formatNullableValue(captureFrameRate, 'fps')}
              </dd>
            </div>
          </>
        ) : watchedStream ? (
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.popup_stream_volume')}</dt>
            <dd>{formatVolumeLabel(watchedStream.playbackVolume)}</dd>
          </div>
        ) : null}
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.health_preferred_codec')}</dt>
            <dd>
              {formatNullableValue(
                publisher?.requestedCodec?.toUpperCase() ??
                  activeOwnedStream?.codecPreference.toUpperCase(),
              )}
            </dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.popup_stats_codec')}</dt>
            <dd>{formatNullableValue(activeStats?.codec)}</dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.diagnostics_acceleration')}</dt>
            <dd>
              {statsState.kind === 'owned'
                ? accelerationLabel(t, statsState.stats?.encoderAcceleration)
                : statsState.kind === 'watched'
                  ? accelerationLabel(t, statsState.stats?.decoderAcceleration)
                  : '--'}
            </dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.popup_stats_resolution')}</dt>
            <dd>{formatNullableValue(activeStats?.resolution)}</dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.popup_stats_frame_rate')}</dt>
            <dd>{formatNullableValue(activeStats?.frameRate, 'fps')}</dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.popup_stats_bitrate')}</dt>
            <dd>{formatNullableValue(activeStats?.bitrateKbps, 'kbps')}</dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.popup_stats_packet_loss')}</dt>
            <dd>
              {statsState.kind === 'watched'
                ? formatPacketLoss(statsState.stats)
                : '--'}
            </dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.popup_stats_jitter')}</dt>
            <dd>
              {statsState.kind === 'watched'
                ? formatNullableValue(statsState.stats?.jitterMs, 'ms')
                : '--'}
            </dd>
          </div>
          <div className={'stream-live-detail-row'}>
            <dt>{t('stream.popup_stats_frames_dropped')}</dt>
            <dd>
              {statsState.kind === 'watched'
                ? formatNullableValue(statsState.stats?.framesDropped)
                : '--'}
            </dd>
          </div>
        {statsState.kind === 'owned' ? (
          <>
            <div className={'stream-live-detail-row'}>
              <dt>{t('stream.health_active_peers')}</dt>
              <dd>{statsState.stats?.activePeerCount ?? 0}</dd>
            </div>
            <div className={'stream-live-detail-row'}>
              <dt>{t('stream.health_limitation_reason')}</dt>
                <dd>
                  {limitationReasonLabel(
                    t,
                    statsState.stats?.qualityLimitationReason,
                  )}
                </dd>
            </div>
          </>
        ) : null}
        </dl>
      </div>
    </section>
  );
}

export interface StreamPanelProps {
  showDashboard: boolean;
}

export function StreamPanel({ showDashboard }: StreamPanelProps) {
  const { t } = useTranslation();
  return (
    showDashboard ? (
      <aside className={'stream-panel stream-dashboard-panel'} aria-label={t('stream.streams_label')}>
        <VoiceHealthPanel />
        <LiveDetailPanel />
      </aside>
    ) : null
  );
}
