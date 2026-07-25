import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../auth/auth-store';
import { Tooltip } from '../chat/Tooltip';
import { sendCommandAwaitAck, sendRawCommand, useGatewayStore } from '../gateway/gateway-store';
import { useAudioDeviceStore } from '../media/audio-device-store';
import { useMusicStore } from '../music/music-store';
import { useStreamStore } from '../stream/stream-store';
import { closeStreamPopup, ensureStreamPopupWindow } from '../stream/stream-popup-controller';
import { DEFAULT_VOICE_PARTICIPANT_VOLUME, toVoiceParticipantVolumePercent, toVoiceVolumePercent } from './voice-audio';
import { NetworkStatusButton, type NetworkStatusMetric } from './NetworkStatusButton';
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

function ScreenShareIcon({ className = 'voice-bottom-icon' }: SidebarIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 21h6M12 18v3M9 11l3-3 3 3M12 8v6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function HangupIcon({ className = 'voice-bottom-icon' }: SidebarIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5.1 16.7c1.8-1.5 4.1-2.3 6.9-2.3s5.1.8 6.9 2.3l1.4-2.2c-2.2-2.2-5-3.3-8.3-3.3s-6.1 1.1-8.3 3.3l1.4 2.2Z" fill="currentColor" />
      <path d="M7.2 14.9v3M16.8 14.9v3" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function SlashIcon() {
  return (
    <svg className="voice-bottom-icon-slash" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 4 20 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg className="voice-bottom-chevron-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 14 5-5 5 5" />
    </svg>
  );
}

export interface ParticipantMenuState {
  displayName: string;
  hasLiveStream: boolean;
  isMe: boolean;
  liveStreamId: string | null;
  userId: string;
  x: number;
  y: number;
}

interface VoiceParticipantMenuProps {
  hasCustomVolume: boolean;
  menu: ParticipantMenuState;
  networkMetrics: NetworkStatusMetric[];
  onChangeVolume: (volume: number) => void;
  onClose: () => void;
  onResetVolume: () => void;
  onWatchStream: (streamId: string) => void;
  volumePercent: number;
}

export function VoiceParticipantMenu({
  hasCustomVolume,
  menu,
  networkMetrics,
  onChangeVolume,
  onClose,
  onResetVolume,
  onWatchStream,
  volumePercent,
}: VoiceParticipantMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8)),
    });
    element.focus();
  }, [menu.x, menu.y]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || menuRef.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <>
      <div className="voice-participant-menu-scrim" aria-hidden="true" />
      <section
        ref={menuRef}
        className="voice-participant-menu"
        role="dialog"
        aria-label={t('voice.participant_actions', { user: menu.displayName })}
        style={{ left: position.left, top: position.top }}
        tabIndex={-1}
        onContextMenu={(event) => event.preventDefault()}
      >
        <header className="voice-participant-menu-header">
          <span className="voice-participant-menu-avatar" aria-hidden="true">
            {menu.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{menu.displayName}</strong>
            <span>{t('voice.voice_member')}</span>
          </div>
        </header>

        <div className="voice-participant-menu-section">
          <div className="voice-channel-volume-header">
            <span>{t('voice.participant_volume_title', { user: menu.displayName })}</span>
            <strong>{volumePercent}%</strong>
          </div>
          {menu.isMe ? (
            <p className="voice-channel-volume-note">{t('voice.participant_volume_self_note')}</p>
          ) : (
            <>
              <input
                type="range"
                className="voice-volume-slider voice-participant-menu-slider"
                min={0}
                max={200}
                value={volumePercent}
                aria-label={t('voice.participant_volume_aria', { user: menu.displayName })}
                onChange={(event) => onChangeVolume(Number(event.target.value) / 100)}
              />
              <div className="voice-participant-menu-scale" aria-hidden="true">
                <span>0%</span>
                <span>100%</span>
                <span>200%</span>
              </div>
              <button
                type="button"
                className="context-menu-item voice-participant-menu-action"
                onClick={onResetVolume}
                disabled={!hasCustomVolume}
              >
                {t('voice.reset_volume')}
              </button>
            </>
          )}
        </div>

        <div className="voice-participant-menu-section">
          <p className="voice-participant-menu-section-title">{t('voice.member_network_title')}</p>
          <dl className="voice-participant-menu-network">
            {networkMetrics.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>{metric.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        {menu.hasLiveStream && !menu.isMe && menu.liveStreamId ? (
          <button
            type="button"
            className="voice-participant-menu-live-action"
            onClick={() => {
              onWatchStream(menu.liveStreamId!);
              onClose();
            }}
          >
            <span className="voice-participant-menu-live-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m10 9 5 3-5 3V9Z" />
              </svg>
            </span>
            <span>
              <strong>{t('stream.action_watch_stream')}</strong>
              <small>{t('stream.watch_stream_hint')}</small>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ) : null}
      </section>
    </>,
    document.body,
  );
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
  const [participantMenu, setParticipantMenu] = useState<ParticipantMenuState | null>(null);
  const participantPressRef = useRef<{
    startX: number;
    startY: number;
    timer: number;
  } | null>(null);
  const participantLongPressTriggeredRef = useRef(false);
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
      return { label: t('voice.connection_health_not_connected'), level: 'idle' };
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
  const latencyValue = gatewayRttMs === null ? '--' : `${Math.max(0, Math.round(gatewayRttMs))}ms`;
  const gatewayLossValue = gatewayLossPct === null ? '--' : `${Math.max(0, Math.round(gatewayLossPct))}%`;
  const mediaLossValue = mediaLossPct === null ? '--' : `${Math.max(0, Math.round(mediaLossPct))}%`;
  const voiceNetworkSummary = `${connectionHealth.label} · ${latencyValue} · ${t('voice.network_loss_short', {
    loss: mediaLossValue,
  })}`;
  const voiceNetworkMetrics: NetworkStatusMetric[] = [
    { label: t('stream.voice_health_connection'), value: connectionHealth.label },
    { label: t('stream.voice_health_gateway_rtt'), value: latencyValue },
    { label: t('stream.voice_health_gateway_loss'), value: gatewayLossValue },
    { label: t('stream.voice_health_media_loss'), value: mediaLossValue },
    {
      label: t('stream.voice_health_freshness'),
      value: isStale ? t('stream.voice_health_stale') : t('stream.voice_health_fresh'),
    },
    { label: t('stream.voice_health_members'), value: String(visibleParticipants.length) },
  ];

  function handleWatchStream(streamId: string) {
    if (watchedStreamIds.has(streamId)) {
      ensureStreamPopupWindow(streamId);
      return;
    }

    if (!ensureStreamPopupWindow(streamId)) {
      useStreamStore.setState({ error: t('stream.error_popup_blocked') });
      return;
    }

    void watchStream(channelId, streamId, sendCommandAwaitAck, sendRawCommand).catch(() => {
      closeStreamPopup(streamId);
    });
  }

  function clearParticipantLongPress() {
    if (participantPressRef.current) {
      window.clearTimeout(participantPressRef.current.timer);
      participantPressRef.current = null;
    }
  }

  function openParticipantMenu(
    participant: Omit<ParticipantMenuState, 'x' | 'y'>,
    x: number,
    y: number,
  ) {
    setParticipantMenu({ ...participant, x, y });
  }

  const selectedParticipantNetwork = participantMenu
    ? voiceNetworkByChannel[channelId]?.[participantMenu.userId] ?? null
    : null;

  return (
    <section className="voice-channel-view" aria-label={channelName}>
      <div className="voice-channel-view-header">
        <div>
          <p className="chat-main-eyebrow">{t('chat.section_voice')}</p>
          <h2 className="voice-channel-view-title">{channelName}</h2>
        </div>
        <div className="voice-channel-view-meta">
          <span
            className={`voice-channel-view-dot${isViewingConnectedVoiceChannel ? '' : ' voice-channel-view-dot--idle'}`}
            aria-hidden="true"
          />
          <span>{t('voice.member_count', { count: visibleParticipants.length })}</span>
          <span>{t('voice.public_channel')}</span>
          <NetworkStatusButton
            detailsLabel={t('voice.network_details')}
            label={t('voice.network_status')}
            level={
              connectionHealth.level === 'stable'
                ? 'good'
                : connectionHealth.level === 'danger'
                  ? 'danger'
                  : connectionHealth.level === 'idle'
                    ? 'idle'
                    : 'warn'
            }
            metrics={voiceNetworkMetrics}
            summary={voiceNetworkSummary}
          />
          {showConnectionHealth ? (
            <span className={`voice-channel-connection-health voice-channel-connection-health--${connectionHealth.level}`}>
              {connectionHealth.label}
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
            const liveStream = liveStreamsByUserId[participant.userId] ?? null;
            const participantMenuData: Omit<ParticipantMenuState, 'x' | 'y'> = {
              displayName,
              hasLiveStream: !!liveStream,
              isMe,
              liveStreamId: liveStream?.streamId ?? null,
              userId: participant.userId,
            };

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
                  aria-haspopup="dialog"
                  aria-label={t('voice.participant_actions', { user: displayName })}
                  onClick={(event) => {
                    if (participantLongPressTriggeredRef.current) {
                      participantLongPressTriggeredRef.current = false;
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    openParticipantMenu(participantMenuData, rect.left + 16, rect.bottom + 4);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    clearParticipantLongPress();
                    openParticipantMenu(participantMenuData, event.clientX, event.clientY);
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType === 'mouse') return;
                    clearParticipantLongPress();
                    const startX = event.clientX;
                    const startY = event.clientY;
                    const timer = window.setTimeout(() => {
                      participantLongPressTriggeredRef.current = true;
                      openParticipantMenu(participantMenuData, startX, startY);
                      participantPressRef.current = null;
                    }, 520);
                    participantPressRef.current = { startX, startY, timer };
                  }}
                  onPointerMove={(event) => {
                    const press = participantPressRef.current;
                    if (!press) return;
                    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 10) {
                      clearParticipantLongPress();
                    }
                  }}
                  onPointerUp={clearParticipantLongPress}
                  onPointerCancel={clearParticipantLongPress}
                  onKeyDown={(event) => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openParticipantMenu(participantMenuData, rect.left + 16, rect.bottom + 4);
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
                </button>
                {liveStream ? (
                  isMe ? (
                    <span className="voice-channel-view-live-badge">{t('chat.live_badge')}</span>
                  ) : (
                    <button
                      type="button"
                      className="voice-channel-view-live-action"
                      aria-label={t('stream.watch_user_stream', { user: displayName })}
                      onClick={() => handleWatchStream(liveStream.streamId)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="m10 9 5 3-5 3V9Z" />
                      </svg>
                      <span>{t('chat.live_badge')}</span>
                    </button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="voice-channel-empty">
        <h3>{t('voice.channel_welcome_title', { channel: channelName })}</h3>
      </div>
      {participantMenu ? (
        <VoiceParticipantMenu
          hasCustomVolume={participantPlaybackVolume[participantMenu.userId] !== undefined}
          menu={participantMenu}
          networkMetrics={[
            {
              label: t('stream.voice_health_gateway_rtt'),
              value: selectedParticipantNetwork?.gatewayRttMs === null || selectedParticipantNetwork?.gatewayRttMs === undefined
                ? '--'
                : `${Math.max(0, Math.round(selectedParticipantNetwork.gatewayRttMs))}ms`,
            },
            {
              label: t('stream.voice_health_gateway_loss'),
              value: selectedParticipantNetwork?.gatewayLossPct === null || selectedParticipantNetwork?.gatewayLossPct === undefined
                ? '--'
                : `${Math.max(0, Math.round(selectedParticipantNetwork.gatewayLossPct))}%`,
            },
            {
              label: t('stream.voice_health_media_loss'),
              value: selectedParticipantNetwork?.mediaSelfLossPct === null || selectedParticipantNetwork?.mediaSelfLossPct === undefined
                ? '--'
                : `${Math.max(0, Math.round(selectedParticipantNetwork.mediaSelfLossPct))}%`,
            },
            {
              label: t('stream.voice_health_freshness'),
              value: selectedParticipantNetwork?.stale
                ? t('stream.voice_health_stale')
                : t('stream.voice_health_fresh'),
            },
          ]}
          onChangeVolume={(volume) => setParticipantPlaybackVolume(participantMenu.userId, volume)}
          onClose={() => setParticipantMenu(null)}
          onResetVolume={() => clearParticipantPlaybackVolume(participantMenu.userId)}
          onWatchStream={handleWatchStream}
          volumePercent={toVoiceParticipantVolumePercent(
            participantPlaybackVolume[participantMenu.userId] ?? DEFAULT_VOICE_PARTICIPANT_VOLUME,
          )}
        />
      ) : null}
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
  const inputVolume = useVoiceStore((s) => s.inputVolume);
  const setInputVolume = useVoiceStore((s) => s.setInputVolume);
  const controls = useVoiceControls();
  const lastAudiblePlaybackVolumeRef = useRef(1);
  const [openVolumeControl, setOpenVolumeControl] = useState<'input' | 'output' | null>(null);

  useEffect(() => {
    if (controls.playbackVolume > 0) {
      lastAudiblePlaybackVolumeRef.current = controls.playbackVolume;
    }
  }, [controls.playbackVolume]);

  useEffect(() => {
    if (!openVolumeControl) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;
      if (!target.closest('.voice-bottom-volume-popover') && !target.closest('.voice-bottom-chevron')) {
        setOpenVolumeControl(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenVolumeControl(null);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openVolumeControl]);

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
          <Tooltip label={t('stream.action_stop_sharing')}>
            <button
              type="button"
              className="voice-bottom-btn voice-bottom-btn--danger"
              onClick={() => {
                void stopSharing(sendCommandAwaitAck);
              }}
              disabled={controls.isConnecting || ownedStream.status === 'stopping'}
              aria-label={t('stream.action_stop_sharing')}
            >
              <ScreenShareIcon />
              <SlashIcon />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label={t('stream.action_start_stream')}>
            <button
              type="button"
              className="voice-bottom-btn voice-bottom-btn--stream"
              onClick={onOpenStreamShareDialog}
              disabled={controls.isConnecting}
              aria-label={t('stream.action_start_stream')}
            >
              <ScreenShareIcon />
            </button>
          </Tooltip>
        )}
        <div className="voice-bottom-split">
          <Tooltip label={controls.isMuted ? t('voice.unmute_title') : t('voice.mute_title')}>
            <button
              type="button"
              className={`voice-bottom-btn voice-bottom-btn--split-main${controls.isMuted ? ' voice-bottom-btn--danger' : ''}`}
              onClick={controls.handleMute}
              disabled={controls.isConnecting}
              aria-label={controls.isMuted ? t('voice.unmute_title') : t('voice.mute_title')}
              aria-pressed={controls.isMuted}
            >
              <MicrophoneIcon className="voice-bottom-icon" />
              {controls.isMuted ? <SlashIcon /> : null}
            </button>
          </Tooltip>
          <Tooltip label={t('voice.mic_input')}>
            <button
              type="button"
              className={`voice-bottom-chevron${openVolumeControl === 'input' ? ' active' : ''}`}
              aria-label={t('voice.mic_input')}
              aria-expanded={openVolumeControl === 'input'}
              aria-haspopup="dialog"
              onClick={() => setOpenVolumeControl((current) => (current === 'input' ? null : 'input'))}
            >
              <ChevronUpIcon />
            </button>
          </Tooltip>
          {openVolumeControl === 'input' ? (
            <div className="voice-bottom-volume-popover" role="dialog" aria-label={t('voice.mic_input')}>
              <div className="voice-bottom-volume-header">
                <strong>{t('voice.mic_input')}</strong>
                <span>{Math.round(inputVolume * 100)}%</span>
              </div>
              <input
                className="voice-volume-slider"
                type="range"
                min={0}
                max={200}
                value={Math.round(inputVolume * 100)}
                aria-label={t('voice.mic_input')}
                onChange={(event) => setInputVolume(Number(event.target.value) / 100)}
              />
              <div className="voice-bottom-volume-scale" aria-hidden="true">
                <span>0%</span>
                <span>100%</span>
                <span>200%</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="voice-bottom-split">
          <Tooltip label={isSpeakerMuted ? t('voice.speaker_on_title') : t('voice.speaker_off_title')}>
            <button
              type="button"
              className={`voice-bottom-btn voice-bottom-btn--split-main${isSpeakerMuted ? ' voice-bottom-btn--danger' : ''}`}
              onClick={handleSpeakerToggle}
              disabled={controls.isConnecting}
              aria-label={isSpeakerMuted ? t('voice.speaker_on_title') : t('voice.speaker_off_title')}
              aria-pressed={isSpeakerMuted}
            >
              <SpeakerIcon className="voice-bottom-icon" />
              {isSpeakerMuted ? <SlashIcon /> : null}
            </button>
          </Tooltip>
          <Tooltip label={t('voice.playback')}>
            <button
              type="button"
              className={`voice-bottom-chevron${openVolumeControl === 'output' ? ' active' : ''}`}
              aria-label={t('voice.playback')}
              aria-expanded={openVolumeControl === 'output'}
              aria-haspopup="dialog"
              onClick={() => setOpenVolumeControl((current) => (current === 'output' ? null : 'output'))}
            >
              <ChevronUpIcon />
            </button>
          </Tooltip>
          {openVolumeControl === 'output' ? (
            <div className="voice-bottom-volume-popover" role="dialog" aria-label={t('voice.playback')}>
              <div className="voice-bottom-volume-header">
                <strong>{t('voice.playback')}</strong>
                <span>{toVoiceVolumePercent(controls.playbackVolume)}%</span>
              </div>
              <input
                className="voice-volume-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(controls.playbackVolume * 100)}
                aria-label={t('voice.playback')}
                onChange={(event) => controls.setPlaybackVolume(Number(event.target.value) / 100)}
              />
              <div className="voice-bottom-volume-scale" aria-hidden="true">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          ) : null}
        </div>
        <Tooltip
          label={
            controls.isDesktop
              ? controls.isDesktopMusicCaptureAvailable
                ? controls.publishedMusic
                  ? t('voice.stop_music_share')
                  : t('voice.music_share_title')
                : t('voice.music_share_unavailable_title')
              : t('voice.music_share_web_unavailable_title')
          }
        >
          <button
            type="button"
            className={`voice-bottom-btn${controls.publishedMusic ? ' voice-bottom-btn--active' : ''}`}
            onClick={controls.handleMusicShareToggle}
            disabled={
              controls.isConnecting ||
              !controls.isDesktop ||
              (!controls.publishedMusic && !controls.isDesktopMusicCaptureAvailable) ||
              controls.publishedMusic?.status === 'capturing' ||
              controls.publishedMusic?.status === 'starting' ||
              controls.publishedMusic?.status === 'stopping'
            }
            aria-label={
              controls.isDesktop
                ? controls.publishedMusic
                  ? t('voice.stop_music_share')
                  : t('voice.share_music')
                : t('voice.music_share_web_unavailable_title')
            }
          >
            <MusicNoteIcon className="voice-bottom-icon" />
          </button>
        </Tooltip>
        <Tooltip label={t('voice.leave_title')}>
          <button
            type="button"
            className="voice-bottom-btn voice-bottom-btn--leave"
            onClick={controls.handleLeave}
            disabled={controls.isConnecting}
            aria-label={t('voice.leave_title')}
          >
            <HangupIcon />
          </button>
        </Tooltip>
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
        <Tooltip label={t('voice.mic_input')}>
          <button
            type="button"
            className={`btn-ghost voice-audio-toggle${expandedVolumeControl === 'input' ? ' voice-audio-toggle--active' : ''}`}
            onClick={() => toggleVolumeControl('input')}
            aria-pressed={expandedVolumeControl === 'input'}
            aria-label={t('voice.mic_input')}
          >
            <MicrophoneIcon />
          </button>
        </Tooltip>
        <Tooltip label={t('voice.playback')}>
          <button
            type="button"
            className={`btn-ghost voice-audio-toggle${expandedVolumeControl === 'output' ? ' voice-audio-toggle--active' : ''}`}
            onClick={() => toggleVolumeControl('output')}
            aria-pressed={expandedVolumeControl === 'output'}
            aria-label={t('voice.playback')}
          >
            <SpeakerIcon />
          </button>
        </Tooltip>
        <Tooltip label={t('voice.shared_music')}>
          <button
            type="button"
            className={`btn-ghost voice-audio-toggle${expandedVolumeControl === 'music' ? ' voice-audio-toggle--active' : ''}`}
            onClick={() => toggleVolumeControl('music')}
            aria-pressed={expandedVolumeControl === 'music'}
            aria-label={t('voice.shared_music')}
          >
            <MusicNoteIcon />
          </button>
        </Tooltip>
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
    } else if (voiceError === 'connection_error') {
      errorMessage = t('voice.error_connection_issue');
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
