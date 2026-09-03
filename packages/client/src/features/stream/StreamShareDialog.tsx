import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { StreamQualitySettings } from '@baker/protocol';

import { sendCommandAwaitAck, sendRawCommand, useGatewayStore } from '../gateway/gateway-store';
import {
  loadStreamQualityPreference,
  loadStringOptionPreference,
  saveClientPreferencesPatch,
  saveStreamQualityPreference,
} from '../preferences/client-preferences';
import {
  type CameraOption,
  DEFAULT_STREAM_CODEC_PREFERENCE,
  DEFAULT_STREAM_QUALITY,
  getSupportedStreamCodecPreferences,
  STREAM_BITRATE_OPTIONS,
  STREAM_CODEC_OPTIONS,
  STREAM_FRAME_RATE_OPTIONS,
  STREAM_RESOLUTION_OPTIONS,
  type StreamCodecPreference,
} from './stream-media';
import { useStreamStore } from './stream-store';

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

export interface StreamShareDialogProps {
  channelId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function StreamShareDialog({ channelId, isOpen, onClose }: StreamShareDialogProps) {
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
  const [selectedShareSource, setSelectedShareSource] = useState<'camera' | 'screen'>('screen');
  const [isStarting, setIsStarting] = useState(false);
  const supportedCodecPreferences = useMemo(() => getSupportedStreamCodecPreferences(), []);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const streamError = useStreamStore((s) => s.error);
  const cameraOptions = useStreamStore((s) => s.cameraOptions);
  const selectedCameraKey = useStreamStore((s) => s.selectedCameraKey);
  const isRefreshingCameras = useStreamStore((s) => s.isRefreshingCameras);
  const isSwitchingCamera = useStreamStore((s) => s.isSwitchingCamera);
  const refreshCameraOptions = useStreamStore((s) => s.refreshCameraOptions);
  const selectCamera = useStreamStore((s) => s.selectCamera);
  const startSharing = useStreamStore((s) => s.startSharing);

  useEffect(() => {
    if (isOpen) void refreshCameraOptions();
  }, [isOpen, refreshCameraOptions]);

  if (!isOpen) return null;

  const blockingReason = !channelId
    ? t('stream.share_unavailable_channel')
    : gatewayStatus !== 'ready'
      ? t('stream.share_unavailable_gateway')
      : ownedStream
        ? t('stream.share_unavailable_existing')
        : null;

  function handleStreamQualityChange(patch: Partial<StreamQualitySettings>) {
    const nextQuality = { ...streamQuality, ...patch };
    setStreamQuality(nextQuality);
    saveStreamQualityPreference(nextQuality);
  }

  function handleStreamCodecPreferenceChange(codecPreference: StreamCodecPreference) {
    setStreamCodecPreference(codecPreference);
    saveClientPreferencesPatch({ streamCodecPreference: codecPreference });
  }

  async function handleGoLive() {
    if (!channelId || blockingReason || isStarting) return;
    setIsStarting(true);
    useStreamStore.setState({ error: null });
    try {
      await startSharing(
        channelId,
        streamQuality,
        selectedShareSource,
        sendCommandAwaitAck,
        sendRawCommand,
        streamCodecPreference,
      );
      if (useStreamStore.getState().ownedStream) onClose();
    } finally {
      setIsStarting(false);
    }
  }

  const selectValue = selectedCameraKey ?? cameraOptions[0]?.key ?? 'camera-refreshing';

  return (
    <div className={'stream-share-dialog-backdrop'} role={'presentation'} onPointerDown={onClose}>
      <section
        className={'stream-share-dialog'}
        role={'dialog'}
        aria-modal={'true'}
        aria-labelledby={'stream-share-dialog-title'}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className={'stream-share-dialog-header'}>
          <div>
            <p className={'stream-panel-icon stream-share-dialog-kicker'}>LIVE</p>
            <h2 id={'stream-share-dialog-title'} className={'stream-share-dialog-title'}>
              {t('stream.share_dialog_title')}
            </h2>
            <p className={'stream-share-dialog-copy'}>{t('stream.share_dialog_description')}</p>
          </div>
          <button type={'button'} className={'btn-ghost stream-share-dialog-close'} onClick={onClose}>
            {t('stream.share_dialog_close')}
          </button>
        </header>

        <div className={'stream-share-dialog-body'}>
          {blockingReason ? <p className={'stream-panel-error'} role={'alert'}>{blockingReason}</p> : null}
          {!blockingReason && streamError ? <p className={'stream-panel-error'} role={'alert'}>{streamError}</p> : null}
          <fieldset className="stream-source-picker" disabled={!!blockingReason || isStarting}>
            <legend>{t('stream.share_source_title')}</legend>
            <div className="stream-source-options">
              <button
                type="button"
                className={`stream-source-option${selectedShareSource === 'screen' ? ' active' : ''}`}
                role="radio"
                aria-checked={selectedShareSource === 'screen'}
                onClick={() => setSelectedShareSource('screen')}
              >
                <span className="stream-source-option-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M9 21h6M12 17v4" /></svg>
                </span>
                <span><strong>{t('stream.action_share_screen')}</strong><small>{t('stream.source_screen_description')}</small></span>
                <span className="stream-source-option-check" aria-hidden="true">✓</span>
              </button>
              <button
                type="button"
                className={`stream-source-option${selectedShareSource === 'camera' ? ' active' : ''}`}
                role="radio"
                aria-checked={selectedShareSource === 'camera'}
                onClick={() => setSelectedShareSource('camera')}
              >
                <span className="stream-source-option-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></svg>
                </span>
                <span><strong>{t('stream.action_share_camera')}</strong><small>{t('stream.source_camera_description')}</small></span>
                <span className="stream-source-option-check" aria-hidden="true">✓</span>
              </button>
            </div>
          </fieldset>

          <section className="stream-advanced-options" aria-disabled={!!blockingReason || isStarting}>
            <header>
              <div>
                <h3>{t('stream.share_advanced_title')}</h3>
                <p>{`${streamQuality.resolution} · ${streamQuality.frameRate} FPS · ${streamQuality.bitrateKbps} kbps · ${codecPreferenceLabel(t, streamCodecPreference)}`}</p>
              </div>
              <span className="stream-panel-icon">PRO</span>
            </header>
            <div className={'stream-quality-controls'}>
              <label className={'stream-quality-field'}>
                <span className={'stream-quality-label'}>{t('stream.quality_resolution')}</span>
                <select className={'stream-quality-select'} value={streamQuality.resolution} disabled={!!blockingReason || isStarting} onChange={(event) => handleStreamQualityChange({ resolution: event.target.value as StreamQualitySettings['resolution'] })}>
                  {STREAM_RESOLUTION_OPTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                </select>
              </label>
              <label className={'stream-quality-field'}>
                <span className={'stream-quality-label'}>{t('stream.quality_frame_rate')}</span>
                <select className={'stream-quality-select'} value={String(streamQuality.frameRate)} disabled={!!blockingReason || isStarting} onChange={(event) => handleStreamQualityChange({ frameRate: Number(event.target.value) as StreamQualitySettings['frameRate'] })}>
                  {STREAM_FRAME_RATE_OPTIONS.map((frameRate) => <option key={frameRate} value={frameRate}>{frameRate} FPS</option>)}
                </select>
              </label>
              <label className={'stream-quality-field'}>
                <span className={'stream-quality-label'}>{t('stream.quality_bitrate_limit')}</span>
                <select className={'stream-quality-select'} value={String(streamQuality.bitrateKbps)} disabled={!!blockingReason || isStarting} onChange={(event) => handleStreamQualityChange({ bitrateKbps: Number(event.target.value) as StreamQualitySettings['bitrateKbps'] })}>
                  {STREAM_BITRATE_OPTIONS.map((bitrate) => <option key={bitrate} value={bitrate}>{bitrate} kbps</option>)}
                </select>
              </label>
              <label className={'stream-quality-field'}>
                <span className={'stream-quality-label'}>{t('stream.quality_codec')}</span>
                <select className={'stream-quality-select'} value={streamCodecPreference} disabled={!!blockingReason || isStarting} onChange={(event) => handleStreamCodecPreferenceChange(event.target.value as StreamCodecPreference)}>
                  {STREAM_CODEC_OPTIONS.map((codecPreference) => (
                    <option key={codecPreference} value={codecPreference} disabled={!supportedCodecPreferences.includes(codecPreference)}>
                      {codecPreferenceLabel(t, codecPreference)}{!supportedCodecPreferences.includes(codecPreference) ? ` (${t('stream.codec_unsupported')})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedShareSource === 'camera' ? (
              <div className={'stream-camera-controls'}>
                <label className={'stream-quality-field'}>
                  <span className={'stream-quality-label'}>{t('stream.source_camera')}</span>
                  <select className={'stream-quality-select'} value={selectValue} onChange={(event) => void selectCamera(event.target.value)} disabled={!!blockingReason || isStarting || isSwitchingCamera || isRefreshingCameras || cameraOptions.length === 0}>
                    {cameraOptions.length > 0
                      ? cameraOptions.map((option) => <option key={option.key} value={option.key}>{cameraOptionLabel(t, option)}</option>)
                      : <option value={'camera-refreshing'}>{t('common.loading')}</option>}
                  </select>
                </label>
                {isSwitchingCamera ? <p className={'stream-camera-status'}>{t('common.please_wait')}</p> : null}
              </div>
            ) : null}
          </section>
        </div>

        <footer className={'stream-share-dialog-actions'}>
          <button type={'button'} className={'btn-ghost stream-action-btn'} onClick={onClose}>{t('stream.action_cancel')}</button>
          <button type={'button'} className={'btn-ghost stream-action-btn stream-action-btn--primary'} onClick={() => void handleGoLive()} disabled={!!blockingReason || isStarting || (selectedShareSource === 'camera' && isSwitchingCamera)}>
            {isStarting ? t('common.please_wait') : t('stream.action_go_live')}
          </button>
        </footer>
      </section>
    </div>
  );
}
