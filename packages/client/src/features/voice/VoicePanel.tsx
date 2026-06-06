import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../auth/auth-store';
import { sendCommandAwaitAck, sendRawCommand, useGatewayStore } from '../gateway/gateway-store';
import { useAudioDeviceStore } from '../media/audio-device-store';
import { useMusicStore } from '../music/music-store';
import { useStreamStore } from '../stream/stream-store';
import { closeStreamPopup, ensureStreamPopupWindow } from '../stream/stream-popup-controller';
import { DEFAULT_VOICE_PARTICIPANT_VOLUME, toVoiceParticipantVolumePercent, toVoiceVolumePercent } from './voice-audio';
import { syncVoiceAudioOutputDevice, useVoiceStore } from './voice-store';

interface VoiceControlsState {
  channelId: string | null;
  isConnecting: boolean;
  isDesktop: boolean;
  isDesktopMusicCaptureAvailable: boolean;
  isMuted: boolean;
  playbackVolume: number;
  publishedMusic: ReturnType<typeof useMusicStore.getState>['publishedMusic'];
  handleLeave(): void;
  handleMusicShareToggle(): void;
  handleMute(): void;
  setPlaybackVolume(volume: number): void;
}

interface SidebarIconProps {
  className?: string;
}

function MicrophoneIcon({ className = 'sidebar-action-icon' }: SidebarIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="9"
        y="3.5"
        width="6"
        height="10"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.4v3.1M8.6 20.5h6.8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SpeakerIcon({ className = 'sidebar-action-icon' }: SidebarIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 9.2h3.2L12 5.4v13.2l-4.8-3.8H4V9.2Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M15.4 8.4a5.6 5.6 0 0 1 0 7.2M18 6.2a8.8 8.8 0 0 1 0 11.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function MusicNoteIcon({ className = 'sidebar-action-icon' }: SidebarIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M10 17.4a2.7 2.7 0 1 1-1.6-2.5L8.4 6l9-1.8v11.2a2.7 2.7 0 1 1-1.6-2.5V8l-7.4 1.5v8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function useVoiceControls(): VoiceControlsState {
  const status = useVoiceStore((s) => s.status);
  const channelId = useVoiceStore((s) => s.channelId);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const playbackVolume = useVoiceStore((s) => s.playbackVolume);
  const setPlaybackVolume = useVoiceStore((s) => s.setPlaybackVolume);
  const leaveVoiceChannel = useVoiceStore((s) => s.leaveVoiceChannel);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const disconnectCurrentStream = useStreamStore((s) => s.disconnectCurrentStream);
  const isDesktopMusicCaptureAvailable = useMusicStore((s) => s.isDesktopCaptureAvailable);
  const publishedMusic = useMusicStore((s) => s.publishedMusic);
  const refreshDesktopCaptureAvailability = useMusicStore((s) => s.refreshDesktopCaptureAvailability);
  const startMusicShare = useMusicStore((s) => s.startMusicShare);
  const stopMusicShare = useMusicStore((s) => s.stopMusicShare);
  const isDesktop = typeof window !== 'undefined' && window.bakerDesktop?.platform === 'desktop';

  useEffect(() => {
    refreshDesktopCaptureAvailability();
  }, [refreshDesktopCaptureAvailability]);

  const isConnecting =
    status === 'requesting_mic' || status === 'joining' || status === 'reconnecting' || status === 'leaving';

  function handleLeave() {
    void (async () => {
      await stopMusicShare(sendCommandAwaitAck);
      await disconnectCurrentStream(sendCommandAwaitAck);
      await leaveVoiceChannel(sendCommandAwaitAck);
    })();
  }

  function handleMute() {
    toggleMute(sendRawCommand);
  }

  function handleMusicShareToggle() {
    if (!channelId || isConnecting) {
      return;
    }

    if (publishedMusic) {
      void stopMusicShare(sendCommandAwaitAck);
      return;
    }

    void startMusicShare(channelId, sendCommandAwaitAck, sendRawCommand);
  }

  return {
    channelId,
    handleLeave,
    handleMusicShareToggle,
    handleMute,
    isConnecting,
    isDesktop,
    isDesktopMusicCaptureAvailable,
    isMuted,
    playbackVolume,
    publishedMusic,
    setPlaybackVolume,
  };
}

export function VoiceAudioDeviceControls() {
  const { t } = useTranslation();
  const audioInputDevices = useAudioDeviceStore((s) => s.audioInputDevices);
  const audioOutputDevices = useAudioDeviceStore((s) => s.audioOutputDevices);
  const deviceError = useAudioDeviceStore((s) => s.error);
  const isRefreshing = useAudioDeviceStore((s) => s.isRefreshing);
  const selectedAudioInputId = useAudioDeviceStore((s) => s.selectedAudioInputId);
  const selectedAudioOutputId = useAudioDeviceStore((s) => s.selectedAudioOutputId);
  const refreshDevices = useAudioDeviceStore((s) => s.refreshDevices);
  const setSelectedAudioInputId = useAudioDeviceStore((s) => s.setSelectedAudioInputId);
  const setSelectedAudioOutputId = useAudioDeviceStore((s) => s.setSelectedAudioOutputId);
  const switchAudioInputDevice = useVoiceStore((s) => s.switchAudioInputDevice);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    void refreshDevices();

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.addEventListener !== 'function'
    ) {
      return;
    }

    const handleDeviceChange = () => {
      void refreshDevices();
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  async function handleAudioInputChange(deviceId: string) {
    setSwitchError(null);
    setSelectedAudioInputId(deviceId || null);

    try {
      await switchAudioInputDevice();
      await refreshDevices();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : t('voice.device_switch_error'));
    }
  }

  function handleAudioOutputChange(deviceId: string) {
    setSwitchError(null);
    setSelectedAudioOutputId(deviceId || null);
    syncVoiceAudioOutputDevice();
  }

  return (
    <div className="voice-device-controls">
      <label className="voice-device-field">
        <span className="voice-device-label">{t('voice.input_device')}</span>
        <select
          className="voice-device-select"
          value={selectedAudioInputId ?? ''}
          disabled={isRefreshing}
          onChange={(event) => {
            void handleAudioInputChange(event.target.value);
          }}
        >
          <option value="">{t('voice.system_default_device')}</option>
          {audioInputDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>

      <label className="voice-device-field">
        <span className="voice-device-label">{t('voice.output_device')}</span>
        <select
          className="voice-device-select"
          value={selectedAudioOutputId ?? ''}
          disabled={isRefreshing}
          onChange={(event) => handleAudioOutputChange(event.target.value)}
        >
          <option value="">{t('voice.system_default_device')}</option>
          {audioOutputDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>

      {deviceError || switchError ? (
        <p className="voice-device-error">{switchError ?? deviceError}</p>
      ) : null}
    </div>
  );
}

export interface VoiceChannelViewProps {
  channelId: string;
  channelName: string;
  showConnectionHealth?: boolean;
}

export function VoiceChannelView({ channelId, channelName, showConnectionHealth = false }: VoiceChannelViewProps) {
  const { t } = useTranslation();
  const connectedChannelId = useVoiceStore((s) => s.channelId);
  const connectionIssue = useVoiceStore((s) => s.connectionIssue);
  const localMediaSelfLossPct = useVoiceStore((s) => s.localMediaSelfLossPct);
  const localMediaSelfUpdatedAt = useVoiceStore((s) => s.localMediaSelfUpdatedAt);
  const participants = useVoiceStore((s) => s.participants);
  const participantPlaybackVolume = useVoiceStore((s) => s.participantPlaybackVolume);
  const speakingUserIds = useVoiceStore((s) => s.speakingUserIds);
  const setParticipantPlaybackVolume = useVoiceStore((s) => s.setParticipantPlaybackVolume);
  const clearParticipantPlaybackVolume = useVoiceStore((s) => s.clearParticipantPlaybackVolume);
  const status = useVoiceStore((s) => s.status);
  const gatewayRttMs = useGatewayStore((s) => s.gatewayRttMs);
  const voiceNetworkByChannel = useGatewayStore((s) => s.voiceNetworkByChannel);
  const voiceRosterByChannel = useGatewayStore((s) => s.voiceRosterByChannel);
  const presenceMap = useGatewayStore((s) => s.presenceMap);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const roomStateByChannel = useStreamStore((s) => s.roomStateByChannel);
  const watchedStreamsById = useStreamStore((s) => s.watchedStreamsById);
  const watchStream = useStreamStore((s) => s.watchStream);
  const [expandedVolumeUserIds, setExpandedVolumeUserIds] = useState<Set<string>>(() => new Set());
  const visibleParticipants = connectedChannelId === channelId ? participants : (voiceRosterByChannel[channelId] ?? []);
  const isViewingConnectedVoiceChannel = connectedChannelId === channelId;
  const networkSnapshot = isViewingConnectedVoiceChannel && myUserId ? voiceNetworkByChannel[channelId]?.[myUserId] : null;
  const gatewayLossPct = networkSnapshot?.gatewayLossPct ?? null;
  const mediaLossPct = isViewingConnectedVoiceChannel
    ? (localMediaSelfLossPct ?? networkSnapshot?.mediaSelfLossPct ?? null)
    : null;
  const localStatsStale =
    isViewingConnectedVoiceChannel && localMediaSelfUpdatedAt !== null && Date.now() - localMediaSelfUpdatedAt > 15_000;
  const isStale = isViewingConnectedVoiceChannel && (networkSnapshot?.stale ?? localStatsStale);
  const connectionHealth = useMemo(() => {
    if (!isViewingConnectedVoiceChannel) {
      return { label: t('voice.connection_health_not_connected'), level: 'warn' };
    }

    if (connectionIssue || status === 'error') {
      return { label: t('voice.connection_health_error'), level: 'danger' };
    }

    if (status === 'reconnecting') {
      return { label: t('voice.connection_health_reconnecting'), level: 'warn' };
    }

    if (status === 'joining' || status === 'requesting_mic') {
      return { label: t('voice.connection_health_connecting'), level: 'warn' };
    }

    if (status === 'leaving') {
      return { label: t('voice.connection_health_leaving'), level: 'warn' };
    }

    if ((gatewayLossPct ?? 0) > 0) {
      return { label: t('voice.connection_health_gateway_loss'), level: (gatewayLossPct ?? 0) >= 5 ? 'danger' : 'warn' };
    }

    if ((mediaLossPct ?? 0) > 0) {
      return { label: t('voice.connection_health_media_loss'), level: (mediaLossPct ?? 0) >= 5 ? 'danger' : 'warn' };
    }

    if (gatewayRttMs !== null && gatewayRttMs > 300) {
      return { label: t('voice.connection_health_bad_latency'), level: 'danger' };
    }

    if (gatewayRttMs !== null && gatewayRttMs >= 150) {
      return { label: t('voice.connection_health_high_latency'), level: 'warn' };
    }

    if (isStale) {
      return { label: t('voice.connection_health_stale'), level: 'warn' };
    }

    return { label: t('voice.connection_health_stable'), level: 'stable' };
  }, [connectionIssue, gatewayLossPct, gatewayRttMs, isStale, isViewingConnectedVoiceChannel, mediaLossPct, status, t]);
  const liveStreamsByUserId = useMemo(() => {
    const next: Record<string, { streamId: string }> = {};
    for (const stream of Object.values(roomStateByChannel[channelId] ?? {})) {
      if (stream.status === 'live') {
        next[stream.hostUserId] = { streamId: stream.streamId };
      }
    }
    return next;
  }, [channelId, roomStateByChannel]);
  const watchedStreamIds = useMemo(() => new Set(Object.keys(watchedStreamsById)), [watchedStreamsById]);

  function handleWatchStream(streamId: string) {
    if (!ensureStreamPopupWindow(streamId)) {
      useStreamStore.setState({ error: t('stream.error_popup_blocked') });
      return;
    }

    void watchStream(channelId, streamId, sendCommandAwaitAck, sendRawCommand).catch(() => {
      closeStreamPopup(streamId);
    });
  }

  return (
    <section className="voice-channel-view" aria-label={channelName}>
      <div className="voice-channel-view-header">
        <div>
          <p className="chat-main-eyebrow">{t('chat.section_voice')}</p>
          <h2 className="voice-channel-view-title">{channelName}</h2>
        </div>
        <div className="voice-channel-view-meta">
          <span className="voice-channel-view-dot" aria-hidden="true" />
          <span>{t('voice.member_count', { count: visibleParticipants.length })}</span>
          <span>{t('voice.public_channel')}</span>
          {showConnectionHealth ? (
            <span className={`voice-channel-connection-health voice-channel-connection-health--${connectionHealth.level}`}>
              {t('voice.connection_health_label', { status: connectionHealth.label })}
            </span>
          ) : null}
        </div>
      </div>

      {visibleParticipants.length > 0 ? (
        <ul className="voice-channel-view-members">
          {visibleParticipants.map((participant) => {
            const isMe = participant.userId === myUserId;
            const displayName = isMe ? t('common.you') : (presenceMap[participant.userId]?.username ?? participant.userId);
            const isSpeaking = speakingUserIds.has(participant.userId);
            const participantVolume =
              participantPlaybackVolume[participant.userId] ?? DEFAULT_VOICE_PARTICIPANT_VOLUME;
            const participantVolumePercent = toVoiceParticipantVolumePercent(participantVolume);
            const isVolumeOpen = expandedVolumeUserIds.has(participant.userId);
            const volumeControlId = `voice-participant-volume-${participant.userId}`;
            const liveStream = liveStreamsByUserId[participant.userId] ?? null;
            const canWatchLiveStream = !!liveStream && !isMe && !watchedStreamIds.has(liveStream.streamId);

            return (
              <li
                key={participant.sessionId}
                className={[
                  'voice-channel-view-member',
                  participant.isMuted ? 'voice-channel-view-member--muted' : '',
                  isSpeaking ? 'voice-channel-view-member--speaking' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className="voice-channel-view-member-button"
                  aria-expanded={isVolumeOpen}
                  aria-controls={isVolumeOpen ? volumeControlId : undefined}
                  onClick={() => {
                    setExpandedVolumeUserIds((current) => {
                      const next = new Set(current);
                      if (next.has(participant.userId)) {
                        next.delete(participant.userId);
                      } else {
                        next.add(participant.userId);
                      }
                      return next;
                    });
                  }}
                >
                  <span className="voice-channel-view-avatar" aria-hidden="true">
                    {displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="voice-channel-view-member-name">{displayName}</span>
                  {participant.isMuted ? <span className="voice-channel-view-badge">{t('voice.badge_muted')}</span> : null}
                  {isSpeaking && !participant.isMuted ? (
                    <span className="voice-channel-view-badge">{t('voice.badge_speaking')}</span>
                  ) : null}
                  {liveStream ? <span className="voice-channel-view-live-badge">{t('chat.live_badge')}</span> : null}
                </button>

                {isVolumeOpen ? (
                  <div id={volumeControlId} className="voice-channel-volume-popover">
                    <div className="voice-channel-volume-header">
                      <span>{t('voice.participant_volume_title', { user: displayName })}</span>
                      <strong>{participantVolumePercent}%</strong>
                    </div>
                    {isMe ? (
                      <p className="voice-channel-volume-note">{t('voice.participant_volume_self_note')}</p>
                    ) : (
                      <div className="voice-channel-volume-row">
                        <input
                          type="range"
                          className="voice-volume-slider"
                          min={0}
                          max={200}
                          value={participantVolumePercent}
                          aria-label={t('voice.participant_volume_aria', { user: displayName })}
                          onChange={(event) => {
                            setParticipantPlaybackVolume(participant.userId, Number(event.target.value) / 100);
                          }}
                        />
                        <button
                          type="button"
                          className="btn-ghost voice-channel-volume-reset"
                          onClick={() => clearParticipantPlaybackVolume(participant.userId)}
                          disabled={participantPlaybackVolume[participant.userId] === undefined}
                        >
                          {t('voice.reset_volume')}
                        </button>
                      </div>
                    )}
                    {canWatchLiveStream ? (
                      <button
                        type="button"
                        className="btn-ghost voice-channel-watch-stream-btn"
                        onClick={() => handleWatchStream(liveStream.streamId)}
                      >
                        {t('stream.action_watch_stream')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="voice-channel-empty">
        <h3>{t('voice.channel_welcome_title', { channel: channelName })}</h3>
      </div>
    </section>
  );
}

export interface VoiceBottomControlBarProps {
  onOpenStreamShareDialog: () => void;
}

export function VoiceBottomControlBar({ onOpenStreamShareDialog }: VoiceBottomControlBarProps) {
  const { t } = useTranslation();
  const gatewayRttMs = useGatewayStore((s) => s.gatewayRttMs);
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const stopSharing = useStreamStore((s) => s.stopSharing);
  const controls = useVoiceControls();
  const lastAudiblePlaybackVolumeRef = useRef(1);

  useEffect(() => {
    if (controls.playbackVolume > 0) {
      lastAudiblePlaybackVolumeRef.current = controls.playbackVolume;
    }
  }, [controls.playbackVolume]);

  if (!controls.channelId) return null;

  const isSpeakerMuted = controls.playbackVolume === 0;
  const latencyLabel = gatewayRttMs === null ? '--' : `${Math.max(0, Math.round(gatewayRttMs))}ms`;

  function handleSpeakerToggle() {
    if (controls.isConnecting) return;
    if (isSpeakerMuted) {
      controls.setPlaybackVolume(lastAudiblePlaybackVolumeRef.current || 1);
      return;
    }
    controls.setPlaybackVolume(0);
  }

  return (
    <div className="voice-bottom-bar" role="region" aria-label={t('voice.controls_aria')}>
      <div className="voice-bottom-status">
        <span className="voice-bottom-status-dot" aria-hidden="true" />
        <span>{controls.isConnecting ? t('voice.status_connecting') : t('voice.connected_short')}</span>
        <span className="voice-bottom-divider" aria-hidden="true" />
        <span>{t('voice.latency_label', { latency: latencyLabel })}</span>
        <span className="voice-bottom-divider" aria-hidden="true" />
        <span>{t('voice.encryption_enabled')}</span>
      </div>

      <div className="voice-bottom-actions">
        {ownedStream ? (
          <button
            type="button"
            className="btn-ghost voice-bottom-btn voice-bottom-btn--danger"
            onClick={() => {
              void stopSharing(sendCommandAwaitAck);
            }}
            disabled={controls.isConnecting || ownedStream.status === 'stopping'}
            title={t('stream.action_stop_sharing')}
          >
            <span aria-hidden="true">X</span>
            <span>{t('stream.action_stop_sharing')}</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost voice-bottom-btn voice-bottom-btn--stream"
            onClick={onOpenStreamShareDialog}
            disabled={controls.isConnecting}
            title={t('stream.action_start_stream')}
          >
            <span aria-hidden="true">LIVE</span>
            <span>{t('stream.action_start_stream')}</span>
          </button>
        )}
        <button
          type="button"
          className={`btn-ghost voice-bottom-btn${controls.isMuted ? ' voice-bottom-btn--danger' : ' voice-bottom-btn--success'}`}
          onClick={controls.handleMute}
          disabled={controls.isConnecting}
          title={controls.isMuted ? t('voice.unmute_title') : t('voice.mute_title')}
        >
          <span aria-hidden="true">{controls.isMuted ? 'M-' : 'M+'}</span>
          <span>{controls.isMuted ? t('voice.muted_label') : t('voice.mic_on_label')}</span>
        </button>
        <button
          type="button"
          className={`btn-ghost voice-bottom-btn${isSpeakerMuted ? ' voice-bottom-btn--danger' : ' voice-bottom-btn--success'}`}
          onClick={handleSpeakerToggle}
          disabled={controls.isConnecting}
          title={isSpeakerMuted ? t('voice.speaker_on_title') : t('voice.speaker_off_title')}
        >
          <span aria-hidden="true">{isSpeakerMuted ? 'S-' : 'S+'}</span>
          <span>{isSpeakerMuted ? t('voice.speaker_muted_label') : t('voice.speaker_on_label')}</span>
        </button>
        <button
          type="button"
          className="btn-ghost voice-bottom-btn"
          onClick={controls.handleMusicShareToggle}
          disabled={
            controls.isConnecting ||
            !controls.isDesktop ||
            (!controls.publishedMusic && !controls.isDesktopMusicCaptureAvailable) ||
            controls.publishedMusic?.status === 'capturing' ||
            controls.publishedMusic?.status === 'starting' ||
            controls.publishedMusic?.status === 'stopping'
          }
          title={controls.isDesktopMusicCaptureAvailable ? t('voice.music_share_title') : t('voice.music_share_unavailable_title')}
        >
          <span aria-hidden="true">MU</span>
          <span>{controls.publishedMusic ? t('voice.stop_music_share') : t('voice.share_music')}</span>
        </button>
        <button
          type="button"
          className="btn-ghost voice-bottom-btn voice-bottom-btn--leave"
          onClick={controls.handleLeave}
          disabled={controls.isConnecting}
          title={t('voice.leave_title')}
        >
          <span aria-hidden="true">X</span>
          <span>{t('voice.leave')}</span>
        </button>
      </div>
    </div>
  );
}

export function VoiceSidebarVolumeControls() {
  const { t } = useTranslation();
  const channelId = useVoiceStore((s) => s.channelId);
  const inputVolume = useVoiceStore((s) => s.inputVolume);
  const setInputVolume = useVoiceStore((s) => s.setInputVolume);
  const musicPlaybackVolume = useMusicStore((s) => s.playbackVolume);
  const setMusicPlaybackVolume = useMusicStore((s) => s.setPlaybackVolume);
  const controls = useVoiceControls();
  const [expandedVolumeControl, setExpandedVolumeControl] = useState<'input' | 'music' | 'output' | null>(null);

  if (!channelId) return null;

  function toggleVolumeControl(control: 'input' | 'music' | 'output') {
    setExpandedVolumeControl((current) => (current === control ? null : control));
  }

  return (
    <div className="voice-sidebar-volume-controls">
      <div className="voice-audio-toggle-row" aria-label={t('common.volume')}>
        <button
          type="button"
          className={`btn-ghost voice-audio-toggle${expandedVolumeControl === 'input' ? ' voice-audio-toggle--active' : ''}`}
          onClick={() => toggleVolumeControl('input')}
          aria-pressed={expandedVolumeControl === 'input'}
          aria-label={t('voice.mic_input')}
          title={t('voice.mic_input')}
        >
          <MicrophoneIcon />
        </button>
        <button
          type="button"
          className={`btn-ghost voice-audio-toggle${expandedVolumeControl === 'output' ? ' voice-audio-toggle--active' : ''}`}
          onClick={() => toggleVolumeControl('output')}
          aria-pressed={expandedVolumeControl === 'output'}
          aria-label={t('voice.playback')}
          title={t('voice.playback')}
        >
          <SpeakerIcon />
        </button>
        <button
          type="button"
          className={`btn-ghost voice-audio-toggle${expandedVolumeControl === 'music' ? ' voice-audio-toggle--active' : ''}`}
          onClick={() => toggleVolumeControl('music')}
          aria-pressed={expandedVolumeControl === 'music'}
          aria-label={t('voice.shared_music')}
          title={t('voice.shared_music')}
        >
          <MusicNoteIcon />
        </button>
      </div>

      {expandedVolumeControl === 'input' ? (
        <label className="voice-audio-control voice-audio-control--expanded voice-sidebar-volume-popover">
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
      ) : null}

      {expandedVolumeControl === 'output' ? (
        <label className="voice-audio-control voice-audio-control--expanded voice-sidebar-volume-popover">
          <span className="voice-audio-control-label">{t('voice.playback')}</span>
          <div className="voice-audio-control-row">
            <input
              type="range"
              className="voice-volume-slider"
              min={0}
              max={100}
              value={Math.round(controls.playbackVolume * 100)}
              onChange={(event) => controls.setPlaybackVolume(Number(event.target.value) / 100)}
            />
            <span className="voice-volume-value">{toVoiceVolumePercent(controls.playbackVolume)}%</span>
          </div>
        </label>
      ) : null}

      {expandedVolumeControl === 'music' ? (
        <label className="voice-audio-control voice-audio-control--expanded voice-sidebar-volume-popover">
          <span className="voice-audio-control-label">{t('voice.shared_music')}</span>
          <div className="voice-audio-control-row">
            <input
              type="range"
              className="voice-volume-slider"
              min={0}
              max={100}
              value={Math.round(musicPlaybackVolume * 100)}
              onChange={(event) => setMusicPlaybackVolume(Number(event.target.value) / 100)}
            />
            <span className="voice-volume-value">{toVoiceVolumePercent(musicPlaybackVolume)}%</span>
          </div>
        </label>
      ) : null}
    </div>
  );
}

export function VoicePanel() {
  const { t } = useTranslation();
  const status = useVoiceStore((s) => s.status);
  const voiceError = useVoiceStore((s) => s.error);
  const clearError = useVoiceStore((s) => s.clearError);

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

  return null;
}
