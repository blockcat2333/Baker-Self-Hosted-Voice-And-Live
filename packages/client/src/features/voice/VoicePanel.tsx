import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../auth/auth-store';
import { sendCommandAwaitAck, sendRawCommand, useGatewayStore } from '../gateway/gateway-store';
import { useStreamStore } from '../stream/stream-store';
import {
  DEFAULT_VOICE_PARTICIPANT_VOLUME,
  toVoiceVolumePercent,
} from './voice-audio';
import { useVoiceStore } from './voice-store';

export function VoicePanel() {
  const { t } = useTranslation();
  const status = useVoiceStore((s) => s.status);
  const voiceError = useVoiceStore((s) => s.error);
  const connectionIssue = useVoiceStore((s) => s.connectionIssue);
  const channelId = useVoiceStore((s) => s.channelId);
  const participants = useVoiceStore((s) => s.participants);
  const speakingUserIds = useVoiceStore((s) => s.speakingUserIds);
  const peerNetwork = useVoiceStore((s) => s.peerNetwork);
  const localMediaSelfLossPct = useVoiceStore((s) => s.localMediaSelfLossPct);
  const localMediaSelfUpdatedAt = useVoiceStore((s) => s.localMediaSelfUpdatedAt);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const inputVolume = useVoiceStore((s) => s.inputVolume);
  const playbackVolume = useVoiceStore((s) => s.playbackVolume);
  const participantPlaybackVolume = useVoiceStore((s) => s.participantPlaybackVolume);
  const setInputVolume = useVoiceStore((s) => s.setInputVolume);
  const setPlaybackVolume = useVoiceStore((s) => s.setPlaybackVolume);
  const setParticipantPlaybackVolume = useVoiceStore((s) => s.setParticipantPlaybackVolume);
  const leaveVoiceChannel = useVoiceStore((s) => s.leaveVoiceChannel);
  const clearError = useVoiceStore((s) => s.clearError);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const disconnectCurrentStream = useStreamStore((s) => s.disconnectCurrentStream);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const presenceMap = useGatewayStore((s) => s.presenceMap);
  const voiceNetworkByChannel = useGatewayStore((s) => s.voiceNetworkByChannel);

  const participantNameById = useMemo(() => {
    const names: Record<string, string> = {};
    for (const participant of participants) {
      if (participant.userId === myUserId) {
        names[participant.userId] = t('common.you');
        continue;
      }
      names[participant.userId] = presenceMap[participant.userId]?.username ?? participant.userId;
    }
    return names;
  }, [myUserId, participants, presenceMap, t]);

  if (status === 'idle') return null;

  if (status === 'error') {
    let errorMessage: string;
    if (voiceError === 'insecure_context') {
      errorMessage = t('voice.error_insecure_context');
    } else if (voiceError === 'mic_denied') {
      errorMessage = t('voice.error_mic_denied');
    } else if (voiceError === 'not_connected') {
      errorMessage = t('voice.error_not_connected');
    } else {
      errorMessage = voiceError ?? t('voice.error_mic_denied');
    }

    return (
      <div className="voice-panel voice-panel--error">
        <div className="voice-panel-header">
          <span className="voice-panel-icon">!</span>
          <span className="voice-panel-label voice-panel-label--error">{t('voice.error_title')}</span>
        </div>
        <p className="voice-panel-error-msg">{errorMessage}</p>
        <button
          type="button"
          className="btn-ghost voice-panel-dismiss-btn"
          onClick={clearError}
        >
          {t('voice.error_dismiss')}
        </button>
      </div>
    );
  }

  if (!channelId) return null;

  const isConnecting =
    status === 'requesting_mic' || status === 'joining' || status === 'reconnecting' || status === 'leaving';

  function handleLeave() {
    void (async () => {
      await disconnectCurrentStream(sendCommandAwaitAck);
      await leaveVoiceChannel(sendCommandAwaitAck);
    })();
  }

  function handleMute() {
    toggleMute(sendRawCommand);
  }

  return (
    <div className="voice-panel">
      <div className="voice-panel-header">
        <span className="voice-panel-icon">VC</span>
        <span className="voice-panel-label">
          {isConnecting ? t('voice.status_connecting') : t('voice.status_connected')}
        </span>
      </div>

      {connectionIssue ? (
        <p className="voice-panel-warning" role="alert">
          {t('voice.error_connection_issue')}
        </p>
      ) : null}

      <div className="voice-audio-controls">
        <label className="voice-audio-control">
          <span className="voice-audio-control-label">{t('voice.mic_input')}</span>
          <div className="voice-audio-control-row">
            <input
              type="range"
              className="voice-volume-slider"
              min={0}
              max={200}
              value={Math.round(inputVolume * 100)}
              onChange={(event) => setInputVolume(Number(event.target.value) / 100)}
            />
            <span className="voice-volume-value">{Math.round(inputVolume * 100)}%</span>
          </div>
        </label>

        <label className="voice-audio-control">
          <span className="voice-audio-control-label">{t('voice.playback')}</span>
          <div className="voice-audio-control-row">
            <input
              type="range"
              className="voice-volume-slider"
              min={0}
              max={100}
              value={Math.round(playbackVolume * 100)}
              onChange={(event) => setPlaybackVolume(Number(event.target.value) / 100)}
            />
            <span className="voice-volume-value">{toVoiceVolumePercent(playbackVolume)}%</span>
          </div>
        </label>
      </div>

      <ul className="voice-participant-list">
        {participants.map((participant) => {
          const isMe = participant.userId === myUserId;
          const isSpeaking = speakingUserIds.has(participant.userId);
          const displayName = participantNameById[participant.userId] ?? participant.userId;
          const participantVolume = participantPlaybackVolume[participant.userId] ?? DEFAULT_VOICE_PARTICIPANT_VOLUME;
          const connState = peerNetwork[participant.userId]?.connectionState;
          const connSuffix = connState && connState !== 'connected' ? ` [${connState}]` : '';
          const networkSnapshot = voiceNetworkByChannel[channelId]?.[participant.userId];
          const gatewayRttText =
            networkSnapshot?.gatewayRttMs === null || networkSnapshot?.gatewayRttMs === undefined
              ? '--'
              : `${Math.max(0, Math.round(networkSnapshot.gatewayRttMs))}ms`;
          const gatewayLossText =
            networkSnapshot?.gatewayLossPct === null || networkSnapshot?.gatewayLossPct === undefined
              ? '--'
              : `${Math.max(0, Math.round(networkSnapshot.gatewayLossPct))}%`;
          const mediaLossRaw =
            networkSnapshot?.mediaSelfLossPct ?? (isMe ? localMediaSelfLossPct : null);
          const mediaLossText =
            mediaLossRaw === null || mediaLossRaw === undefined
              ? '--'
              : `${Math.max(0, Math.round(mediaLossRaw))}%`;
          const localMetricStale =
            isMe && localMediaSelfUpdatedAt !== null
              ? Date.now() - localMediaSelfUpdatedAt > 15_000
              : true;
          const stale = networkSnapshot?.stale ?? localMetricStale;
          const localFallback = !networkSnapshot && isMe && localMediaSelfLossPct !== null;
          const netLabel = `${t('voice.net_label_gw_rtt')} ${gatewayRttText} · ${t('voice.net_label_gw_loss')} ${gatewayLossText} · ${t('voice.net_label_media_loss')} ${mediaLossText}${stale ? ` · ${t('voice.net_label_stale')}` : ''}${localFallback ? ` · ${t('voice.net_label_local')}` : ''}${connSuffix}`;

          return (
            <li
              key={participant.userId}
              className={[
                'voice-participant',
                isSpeaking ? 'voice-participant--speaking' : '',
                participant.isMuted ? 'voice-participant--muted' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="voice-participant-row">
                <span className="voice-participant-name" title={displayName}>
                  {displayName}
                </span>
                {!isMe ? (
                  <span className="voice-participant-volume">
                    {toVoiceVolumePercent(participantVolume)}%
                  </span>
                ) : null}
                {participant.isMuted ? (
                  <span className="voice-participant-badge">{t('voice.badge_muted')}</span>
                ) : null}
                {isSpeaking && !participant.isMuted ? (
                  <span className="voice-participant-badge">{t('voice.badge_speaking')}</span>
                ) : null}
              </div>
              <div className="voice-participant-meta-row">
                <span className="voice-participant-net" title={netLabel}>
                  {netLabel}
                </span>
              </div>
              {!isMe ? (
                <label className="voice-participant-slider-row">
                  <span className="voice-participant-slider-label">{t('voice.volume')}</span>
                  <input
                    type="range"
                    className="voice-volume-slider"
                    min={0}
                    max={100}
                    value={Math.round(participantVolume * 100)}
                    onChange={(event) =>
                      setParticipantPlaybackVolume(participant.userId, Number(event.target.value) / 100)
                    }
                  />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="voice-panel-controls">
        <button
          type="button"
          className={`btn-ghost voice-mute-btn${isMuted ? ' voice-mute-btn--muted' : ''}`}
          onClick={handleMute}
          disabled={isConnecting}
          title={isMuted ? t('voice.unmute_title') : t('voice.mute_title')}
        >
          {isMuted ? t('voice.muted_label') : t('voice.mic_on_label')}
        </button>
        <button
          type="button"
          className="btn-ghost voice-leave-btn"
          onClick={handleLeave}
          disabled={isConnecting}
          title={t('voice.leave_title')}
        >
          {t('voice.leave')}
        </button>
      </div>
    </div>
  );
}
