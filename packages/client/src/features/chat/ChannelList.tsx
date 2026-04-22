import { useTranslation } from 'react-i18next';

import type { ChannelSummary } from '@baker/protocol';

import { useAuthStore } from '../auth/auth-store';
import { sendCommandAwaitAck, sendRawCommand, useGatewayStore } from '../gateway/gateway-store';
import { useStreamStore } from '../stream/stream-store';
import { useVoiceStore } from '../voice/voice-store';
import { useChatStore } from './chat-store';

export interface ChannelListProps {
  onAfterPick?: (kind: 'text' | 'voice') => void;
}

export function ChannelList({ onAfterPick }: ChannelListProps = {}) {
  const { t } = useTranslation();
  const activeGuildId = useChatStore((s) => s.activeGuildId);
  const channelsByGuild = useChatStore((s) => s.channelsByGuild);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const joinVoiceChannel = useVoiceStore((s) => s.joinVoiceChannel);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const roomStateByChannel = useStreamStore((s) => s.roomStateByChannel);
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const watchedStreamsById = useStreamStore((s) => s.watchedStreamsById);
  const disconnectCurrentStream = useStreamStore((s) => s.disconnectCurrentStream);
  const voiceRosterByChannel = useGatewayStore((s) => s.voiceRosterByChannel);
  const presenceMap = useGatewayStore((s) => s.presenceMap);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);

  const channels = activeGuildId ? (channelsByGuild[activeGuildId] ?? []) : [];

  function handleTextSelect(channelId: string) {
    if (channelId !== activeChannelId) {
      setActiveChannel(channelId);
    }
    onAfterPick?.('text');
  }

  async function handleVoiceSelect(channelId: string) {
    if (channelId === voiceChannelId) {
      onAfterPick?.('voice');
      return;
    }
    if (ownedStream || Object.keys(watchedStreamsById).length > 0) {
      await disconnectCurrentStream(sendCommandAwaitAck);
    }
    void joinVoiceChannel(channelId, sendCommandAwaitAck, sendRawCommand);
    onAfterPick?.('voice');
  }

  const textChannels = channels.filter((c) => c.type !== 'voice');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  function renderChannel(channel: ChannelSummary) {
    const isVoice = channel.type === 'voice';
    const isActive = isVoice ? channel.id === voiceChannelId : channel.id === activeChannelId;
    const hasLiveStream = isVoice && Object.keys(roomStateByChannel[channel.id] ?? {}).length > 0;
    const voiceRoster = isVoice ? voiceRosterByChannel[channel.id] ?? [] : [];

    return (
      <div key={channel.id} className={`channel-row${isVoice ? ' channel-row--voice' : ''}`}>
        <button
          type="button"
          className={`channel-btn${isActive ? ' active' : ''}${isVoice ? ' channel-btn--voice' : ''}${hasLiveStream ? ' channel-btn--live' : ''}`}
          onClick={() => {
            if (isVoice) {
              void handleVoiceSelect(channel.id);
            } else {
              handleTextSelect(channel.id);
            }
          }}
        >
          <span className="channel-btn-left">
            <span className="channel-icon" aria-hidden="true">
              {isVoice ? 'VC' : '#'}
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

              return (
                <div
                  key={participant.sessionId}
                  className={`channel-voice-member${participant.isMuted ? ' channel-voice-member--muted' : ''}`}
                  title={displayName}
                >
                  <span className="channel-voice-member-name">{displayName}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <nav className="channel-list" aria-label={t('chat.channels_aria')}>
      {textChannels.length > 0 && (
        <>
          {voiceChannels.length > 0 && (
            <div className="channel-section-label" aria-hidden="true">{t('chat.section_text')}</div>
          )}
          {textChannels.map(renderChannel)}
        </>
      )}
      {voiceChannels.length > 0 && (
        <>
          <div className="channel-section-label" aria-hidden="true">{t('chat.section_voice')}</div>
          {voiceChannels.map(renderChannel)}
        </>
      )}
    </nav>
  );
}
