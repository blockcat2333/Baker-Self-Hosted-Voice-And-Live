import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChannelSummary } from '@baker/protocol';

import { useAuthStore } from '../auth/auth-store';
import { sendCommandAwaitAck, sendRawCommand, useGatewayStore } from '../gateway/gateway-store';
import { closeStreamPopup, ensureStreamPopupWindow } from '../stream/stream-popup-controller';
import { useStreamStore } from '../stream/stream-store';
import {
  DEFAULT_VOICE_PARTICIPANT_VOLUME,
  toVoiceParticipantVolumePercent,
} from '../voice/voice-audio';
import {
  type ParticipantMenuState,
  VoiceParticipantMenu,
} from '../voice/VoicePanel';
import { useVoiceStore } from '../voice/voice-store';
import { useChatStore } from './chat-store';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { useLongPressMenu } from './useLongPressMenu';

export interface ChannelListProps {
  onAfterPick?: (kind: 'text' | 'voice', channelId: string) => void;
}

export function ChannelList({ onAfterPick }: ChannelListProps = {}) {
  const { t } = useTranslation();
  const activeGuildId = useChatStore((s) => s.activeGuildId);
  const channelsByGuild = useChatStore((s) => s.channelsByGuild);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const joinVoiceChannel = useVoiceStore((s) => s.joinVoiceChannel);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const participantPlaybackVolume = useVoiceStore((s) => s.participantPlaybackVolume);
  const setParticipantPlaybackVolume = useVoiceStore((s) => s.setParticipantPlaybackVolume);
  const clearParticipantPlaybackVolume = useVoiceStore((s) => s.clearParticipantPlaybackVolume);
  const roomStateByChannel = useStreamStore((s) => s.roomStateByChannel);
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const watchedStreamsById = useStreamStore((s) => s.watchedStreamsById);
  const disconnectCurrentStream = useStreamStore((s) => s.disconnectCurrentStream);
  const watchStream = useStreamStore((s) => s.watchStream);
  const voiceRosterByChannel = useGatewayStore((s) => s.voiceRosterByChannel);
  const voiceNetworkByChannel = useGatewayStore((s) => s.voiceNetworkByChannel);
  const presenceMap = useGatewayStore((s) => s.presenceMap);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const [menu, setMenu] = useState<{ channel: ChannelSummary; x: number; y: number } | null>(null);
  const [participantMenu, setParticipantMenu] = useState<{
    channelId: string;
    menu: ParticipantMenuState;
  } | null>(null);
  const [mutedChannels, setMutedChannels] = useState<Record<string, string>>({});
  const [notificationModes, setNotificationModes] = useState<
    Record<string, 'all' | 'mentions' | 'none'>
  >({});
  const getChannelLongPressProps = useLongPressMenu<ChannelSummary>((channel, x, y) => {
    setMenu({ channel, x, y });
  });
  const getParticipantLongPressProps = useLongPressMenu<{
    channelId: string;
    menu: Omit<ParticipantMenuState, 'x' | 'y'>;
  }>((entry, x, y) => {
    setParticipantMenu({
      channelId: entry.channelId,
      menu: { ...entry.menu, x, y },
    });
  });

  const channels = activeGuildId ? (channelsByGuild[activeGuildId] ?? []) : [];

  function handleTextSelect(channelId: string) {
    if (channelId !== activeChannelId) {
      setActiveChannel(channelId);
    }
    onAfterPick?.('text', channelId);
  }

  async function handleVoiceSelect(channelId: string) {
    if (channelId === voiceChannelId) {
      onAfterPick?.('voice', channelId);
      return;
    }
    if (ownedStream || Object.keys(watchedStreamsById).length > 0) {
      await disconnectCurrentStream(sendCommandAwaitAck);
    }
    void joinVoiceChannel(channelId, sendCommandAwaitAck, sendRawCommand);
    onAfterPick?.('voice', channelId);
  }

  function handleWatchStream(channelId: string, streamId: string) {
    if (watchedStreamsById[streamId]) {
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

  const textChannels = channels.filter((c) => c.type !== 'voice');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  function channelMenuItems(channel: ChannelSummary): ContextMenuEntry[] {
    const mode = notificationModes[channel.id] ?? 'all';
    const muteChannel = (duration: string) =>
      setMutedChannels((current) => ({ ...current, [channel.id]: duration }));
    const setNotificationMode = (nextMode: 'all' | 'mentions' | 'none') =>
      setNotificationModes((current) => ({ ...current, [channel.id]: nextMode }));

    return [
      { disabled: true, id: 'mark-read', label: t('context.mark_read') },
      { id: 'channel-divider-1', type: 'separator' },
      {
        id: 'copy-name',
        label: t('context.copy_name'),
        onSelect: () => void navigator.clipboard.writeText(channel.name),
      },
      mutedChannels[channel.id]
        ? {
            id: 'unmute',
            label: t('context.unmute_channel'),
            onSelect: () =>
              setMutedChannels((current) => {
                const next = { ...current };
                delete next[channel.id];
                return next;
              }),
          }
        : {
            id: 'mute',
            label: t('context.mute_channel'),
            subItems: [
              {
                id: 'mute-15m',
                label: t('context.duration_15m'),
                onSelect: () => muteChannel('15m'),
              },
              {
                id: 'mute-1h',
                label: t('context.duration_1h'),
                onSelect: () => muteChannel('1h'),
              },
              {
                id: 'mute-8h',
                label: t('context.duration_8h'),
                onSelect: () => muteChannel('8h'),
              },
              {
                id: 'mute-24h',
                label: t('context.duration_24h'),
                onSelect: () => muteChannel('24h'),
              },
              { id: 'mute-divider', type: 'separator' },
              {
                id: 'mute-forever',
                label: t('context.duration_forever'),
                onSelect: () => muteChannel('forever'),
              },
            ],
          },
      {
        hint:
          mode === 'all'
            ? t('context.notifications_all')
            : mode === 'none'
              ? t('context.notifications_none')
              : t('context.notifications_mentions'),
        id: 'notification-settings',
        label: t('context.notification_settings'),
        subItems: [
          {
            checked: mode === 'all',
            id: 'notify-all',
            label: t('context.notifications_all'),
            onSelect: () => setNotificationMode('all'),
          },
          {
            checked: mode === 'mentions',
            id: 'notify-mentions',
            label: t('context.notifications_mentions'),
            onSelect: () => setNotificationMode('mentions'),
          },
          {
            checked: mode === 'none',
            id: 'notify-none',
            label: t('context.notifications_none'),
            onSelect: () => setNotificationMode('none'),
          },
        ],
      },
      { id: 'channel-divider-2', type: 'separator' },
      {
        id: 'copy-id',
        label: t('context.copy_id'),
        onSelect: () => void navigator.clipboard.writeText(channel.id),
      },
    ];
  }

  function renderChannel(channel: ChannelSummary) {
    const isVoice = channel.type === 'voice';
    const isActive = isVoice ? channel.id === voiceChannelId : channel.id === activeChannelId;
    const hasLiveStream = isVoice && Object.keys(roomStateByChannel[channel.id] ?? {}).length > 0;
    const voiceRoster = isVoice ? voiceRosterByChannel[channel.id] ?? [] : [];
    const isMuted = Boolean(mutedChannels[channel.id]);

    return (
      <div key={channel.id} className={`channel-row${isVoice ? ' channel-row--voice' : ''}`}>
        <button
          type="button"
          {...getChannelLongPressProps(channel)}
          className={`channel-btn${isActive ? ' active' : ''}${isVoice ? ' channel-btn--voice' : ''}${hasLiveStream ? ' channel-btn--live' : ''}${isMuted ? ' channel-btn--muted' : ''}`}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => {
            if (isVoice) {
              void handleVoiceSelect(channel.id);
            } else {
              handleTextSelect(channel.id);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ channel, x: event.clientX, y: event.clientY });
          }}
        >
          <span className="channel-btn-left">
            <span className="channel-icon" aria-hidden="true">
              {isVoice ? (
                <svg viewBox="0 0 24 24">
                  <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 1.1a3 3 0 0 1 0 3.8M19 7.5a6 6 0 0 1 0 9" />
                </svg>
              ) : (
                '#'
              )}
            </span>
            <span className="channel-name">{channel.name}</span>
          </span>
          <span className="channel-btn-right">
            {hasLiveStream ? (
              <span className="channel-badge channel-badge--live">{t('chat.live_badge')}</span>
            ) : null}
          </span>
        </button>
        {isVoice && voiceRoster.length > 0 ? (
          <div className="channel-voice-roster">
            {voiceRoster.map((participant) => {
              const isMe = participant.userId === myUserId;
              const displayName = isMe ? t('common.you') : (presenceMap[participant.userId]?.username ?? participant.userId);
              const liveStream =
                Object.values(roomStateByChannel[channel.id] ?? {}).find(
                  (stream) => stream.hostUserId === participant.userId && stream.status === 'live',
                ) ?? null;
              const participantMenuData: Omit<ParticipantMenuState, 'x' | 'y'> = {
                displayName,
                hasLiveStream: !!liveStream,
                isMe,
                liveStreamId: liveStream?.streamId ?? null,
                userId: participant.userId,
              };

              return (
                <div
                  key={participant.sessionId}
                  className={`channel-voice-member${participant.isMuted ? ' channel-voice-member--muted' : ''}`}
                >
                  <button
                    type="button"
                    {...getParticipantLongPressProps({
                      channelId: channel.id,
                      menu: participantMenuData,
                    })}
                    className="channel-voice-member-main"
                    aria-label={t('voice.participant_actions', { user: displayName })}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setParticipantMenu({
                        channelId: channel.id,
                        menu: { ...participantMenuData, x: rect.left + 12, y: rect.bottom + 4 },
                      });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setParticipantMenu({
                        channelId: channel.id,
                        menu: { ...participantMenuData, x: event.clientX, y: event.clientY },
                      });
                    }}
                  >
                    <span className="channel-voice-member-avatar" aria-hidden="true">
                      {displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="channel-voice-member-name">{displayName}</span>
                  </button>
                  {liveStream ? (
                    isMe ? (
                      <span className="channel-voice-live-label">{t('chat.live_badge')}</span>
                    ) : (
                      <button
                        type="button"
                        className="channel-voice-live-action"
                        aria-label={t('stream.watch_user_stream', { user: displayName })}
                        onClick={() => handleWatchStream(channel.id, liveStream.streamId)}
                      >
                        {t('chat.live_badge')}
                      </button>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <nav className="channel-list" aria-label={t('chat.channels_aria')}>
        {textChannels.length > 0 && (
          <>
            {voiceChannels.length > 0 && (
              <div className="channel-section-label" aria-hidden="true">
                <span>{t('chat.section_text')}</span>
                <span className="channel-section-add" aria-hidden="true">+</span>
              </div>
            )}
            {textChannels.map(renderChannel)}
          </>
        )}
        {voiceChannels.length > 0 && (
          <>
            <div className="channel-section-label" aria-hidden="true">
              <span>{t('chat.section_voice')}</span>
              <span className="channel-section-add" aria-hidden="true">+</span>
            </div>
            {voiceChannels.map(renderChannel)}
          </>
        )}
      </nav>
      {menu ? (
        <ContextMenu
          ariaLabel={t('context.channel_actions')}
          items={channelMenuItems(menu.channel)}
          onClose={() => setMenu(null)}
          x={menu.x}
          y={menu.y}
        />
      ) : null}
      {participantMenu ? (
        <VoiceParticipantMenu
          hasCustomVolume={participantPlaybackVolume[participantMenu.menu.userId] !== undefined}
          menu={participantMenu.menu}
          networkMetrics={[
            {
              label: t('stream.voice_health_gateway_rtt'),
              value:
                voiceNetworkByChannel[participantMenu.channelId]?.[participantMenu.menu.userId]?.gatewayRttMs == null
                  ? '--'
                  : `${Math.max(
                      0,
                      Math.round(
                        voiceNetworkByChannel[participantMenu.channelId]![participantMenu.menu.userId]!.gatewayRttMs!,
                      ),
                    )}ms`,
            },
            {
              label: t('stream.voice_health_gateway_loss'),
              value:
                voiceNetworkByChannel[participantMenu.channelId]?.[participantMenu.menu.userId]?.gatewayLossPct == null
                  ? '--'
                  : `${Math.max(
                      0,
                      Math.round(
                        voiceNetworkByChannel[participantMenu.channelId]![participantMenu.menu.userId]!.gatewayLossPct!,
                      ),
                    )}%`,
            },
            {
              label: t('stream.voice_health_media_loss'),
              value:
                voiceNetworkByChannel[participantMenu.channelId]?.[participantMenu.menu.userId]?.mediaSelfLossPct == null
                  ? '--'
                  : `${Math.max(
                      0,
                      Math.round(
                        voiceNetworkByChannel[participantMenu.channelId]![participantMenu.menu.userId]!.mediaSelfLossPct!,
                      ),
                    )}%`,
            },
            {
              label: t('stream.voice_health_freshness'),
              value: voiceNetworkByChannel[participantMenu.channelId]?.[participantMenu.menu.userId]?.stale
                ? t('stream.voice_health_stale')
                : t('stream.voice_health_fresh'),
            },
          ]}
          onChangeVolume={(volume) => setParticipantPlaybackVolume(participantMenu.menu.userId, volume)}
          onClose={() => setParticipantMenu(null)}
          onResetVolume={() => clearParticipantPlaybackVolume(participantMenu.menu.userId)}
          onWatchStream={(streamId) => handleWatchStream(participantMenu.channelId, streamId)}
          volumePercent={toVoiceParticipantVolumePercent(
            participantPlaybackVolume[participantMenu.menu.userId] ?? DEFAULT_VOICE_PARTICIPANT_VOLUME,
          )}
        />
      ) : null}
    </>
  );
}
