import { useTranslation } from 'react-i18next';

import type { StreamDiagnosticsGetAckData } from '@baker/protocol';

import type { StreamDiagnosis } from './stream-diagnostics';
import type { WatchedStreamVideoStats } from './stream-store';

export interface StreamBitrateHistoryPoint {
  at: number;
  egress: number | null;
  ingress: number | null;
  receiver: number | null;
  sender: number | null;
}

function value(value: number | null | undefined) {
  return value === null || value === undefined ? '--' : `${Math.max(0, Math.round(value))} kbps`;
}

function gapLabel(from: number | null | undefined, to: number | null | undefined) {
  if (from === null || from === undefined || to === null || to === undefined || from <= 0) return null;
  const retained = Math.round((to / from) * 100);
  return retained < 90 ? `${retained}%` : null;
}

function retainedPercent(from: number | null | undefined, to: number | null | undefined) {
  if (from === null || from === undefined || to === null || to === undefined || from <= 0) return null;
  return Math.round((to / from) * 100);
}

function Sparkline({ color, max, values }: { color: string; max: number; values: Array<number | null> }) {
  const available = values.filter((entry): entry is number => entry !== null);
  if (available.length < 2) return null;
  const points = values
    .map((entry, index) => {
      if (entry === null) return null;
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 28 - (entry / max) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join(' ');
  return <polyline fill="none" points={points} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />;
}

export function StreamDiagnosticsSummary({
  diagnosis,
  diagnostics,
  history = [],
  receiver,
  showHistory = false,
}: {
  diagnosis: StreamDiagnosis;
  diagnostics: StreamDiagnosticsGetAckData | null;
  history?: StreamBitrateHistoryPoint[];
  receiver: WatchedStreamVideoStats | null;
  showHistory?: boolean;
}) {
  const { t } = useTranslation();
  const publisher = diagnostics?.publisher;
  const ingress = diagnostics?.sfu?.ingress;
  const egress = diagnostics?.sfu?.egress;
  const ageMs = diagnostics?.publisherSampledAt === null || diagnostics?.publisherSampledAt === undefined
    ? null
    : Math.max(0, Date.now() - diagnostics.publisherSampledAt);
  const senderToIngress = gapLabel(publisher?.bitrateKbps, ingress?.bitrateKbps);
  const ingressToEgress = gapLabel(ingress?.bitrateKbps, egress?.bitrateKbps);
  const egressToReceiver = gapLabel(egress?.bitrateKbps, receiver?.bitrateKbps);
  const firstDegradedBoundary = [
    {
      label: `${t('stream.diagnostics_sender')} → ${t('stream.diagnostics_sfu_ingress')}`,
      retained: retainedPercent(publisher?.bitrateKbps, ingress?.bitrateKbps),
    },
    {
      label: `${t('stream.diagnostics_sfu_ingress')} → ${t('stream.diagnostics_server')}`,
      retained: retainedPercent(ingress?.bitrateKbps, egress?.bitrateKbps),
    },
    {
      label: `${t('stream.diagnostics_server')} → ${t('stream.diagnostics_receiver')}`,
      retained: retainedPercent(egress?.bitrateKbps, receiver?.bitrateKbps),
    },
  ].find((entry) => entry.retained !== null && entry.retained < 90);
  const historyMax = Math.max(
    1,
    ...history.flatMap((entry) => [entry.sender, entry.ingress, entry.egress, entry.receiver])
      .filter((entry): entry is number => entry !== null),
  );

  return (
    <section className={`stream-path-summary stream-path-summary--${diagnosis}`} aria-label={t('stream.diagnostics_path_title')}>
      <header className="stream-path-summary-header">
        <strong>{t(`stream.diagnosis_${diagnosis}` as const)}</strong>
        <span>{ageMs === null ? t('stream.diagnostics_age_unknown') : t('stream.diagnostics_age', { seconds: String(Math.round(ageMs / 1000)) })}</span>
      </header>
      <div className="stream-path-stages">
        <div><span>{t('stream.diagnostics_sender')}</span><strong>{value(publisher?.bitrateKbps)}</strong></div>
        <i className={senderToIngress ? 'degraded' : ''}>{senderToIngress ?? '→'}</i>
        <div><span>{t('stream.diagnostics_sfu_ingress')}</span><strong>{value(ingress?.bitrateKbps)}</strong></div>
        <i className={ingressToEgress ? 'degraded' : ''}>{ingressToEgress ?? '→'}</i>
        <div><span>{t('stream.diagnostics_server')}</span><strong>{value(egress?.bitrateKbps)}</strong></div>
        <i className={egressToReceiver ? 'degraded' : ''}>{egressToReceiver ?? '→'}</i>
        <div><span>{t('stream.diagnostics_receiver')}</span><strong>{value(receiver?.bitrateKbps)}</strong></div>
      </div>
      {firstDegradedBoundary ? (
        <p className="stream-path-boundary">
          {t('stream.diagnostics_first_boundary', {
            boundary: firstDegradedBoundary.label,
            percent: String(firstDegradedBoundary.retained),
          })}
        </p>
      ) : null}
      {showHistory && history.length > 1 ? (
        <div className="stream-path-history">
          <div className="stream-path-history-legend">
            <span className="sender">{t('stream.diagnostics_sender')}</span>
            <span className="ingress">{t('stream.diagnostics_sfu_ingress')}</span>
            <span className="egress">{t('stream.diagnostics_server')}</span>
            <span className="receiver">{t('stream.diagnostics_receiver')}</span>
          </div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={t('stream.diagnostics_history')}>
            <Sparkline color="#a78bfa" max={historyMax} values={history.map((entry) => entry.sender)} />
            <Sparkline color="#38bdf8" max={historyMax} values={history.map((entry) => entry.ingress)} />
            <Sparkline color="#34d399" max={historyMax} values={history.map((entry) => entry.egress)} />
            <Sparkline color="#fb923c" max={historyMax} values={history.map((entry) => entry.receiver)} />
          </svg>
        </div>
      ) : null}
    </section>
  );
}
