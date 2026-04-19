import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

import { AccountPanel } from '../auth/AccountPanel';
import { useAuthStore } from '../auth/auth-store';
import { useGatewayStore } from '../gateway/gateway-store';
import { StreamPanel } from '../stream/StreamPanel';
import { StreamPopupHost } from '../stream/StreamPopupHost';
import { useVoiceStore } from '../voice/voice-store';
import { VoicePanel } from '../voice/VoicePanel';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { useChatStore } from './chat-store';
import { GuildList } from './GuildList';
import { ChannelList } from './ChannelList';
import { MessagePanel } from './MessagePanel';
import { PresenceBar } from './PresenceBar';

export interface ChatShellProps {
  api: ApiClient;
  gatewayUrl: string;
  serverName: string;
}

export function ChatShell({ api, gatewayUrl, serverName }: ChatShellProps) {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const activeGuildId = useChatStore((s) => s.activeGuildId);
  const loadGuilds = useChatStore((s) => s.loadGuilds);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const messagesByChannel = useChatStore((s) => s.messagesByChannel);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const isLoadingGuilds = useChatStore((s) => s.isLoadingGuilds);
  const isLoadingChannels = useChatStore((s) => s.isLoadingChannels);
  const chatError = useChatStore((s) => s.error);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const gatewayError = useGatewayStore((s) => s.error);
  const reconnectAttempt = useGatewayStore((s) => s.reconnectAttempt);
  const connect = useGatewayStore((s) => s.connect);
  const voiceStatus = useVoiceStore((s) => s.status);

  // Load guilds once on mount
  useEffect(() => {
    void loadGuilds(api);
  }, [api, loadGuilds]);

  // Load channels whenever the active guild changes
  useEffect(() => {
    if (activeGuildId) {
      void loadChannels(api, activeGuildId);
    }
  }, [api, activeGuildId, loadChannels]);

  // Load messages when the active channel changes, but only if not already
  // loaded this session (avoids clobbering older-message history on re-select).
  useEffect(() => {
    if (!activeChannelId) return;
    if (messagesByChannel[activeChannelId] !== undefined) return;
    void loadMessages(api, activeChannelId);
  }, [activeChannelId, api, loadMessages, messagesByChannel]);

  const bannerByStatus: Record<string, { label: string; className: string }> = {
    authenticating: { className: 'gateway-banner--info', label: t('gateway.authenticating') },
    connecting: { className: 'gateway-banner--info', label: t('gateway.connecting') },
    reconnecting: { className: 'gateway-banner--warn', label: t('gateway.reconnecting') },
    error: { className: 'gateway-banner--error', label: t('gateway.connection_error') },
  };

  const banner = bannerByStatus[gatewayStatus];

  const reconnectLabel =
    gatewayStatus === 'reconnecting' && reconnectAttempt > 0
      ? t('gateway.reconnecting_attempt', { attempt: String(reconnectAttempt) })
      : banner?.label;

  return (
    <div className="chat-shell">
      <GuildList />

      <div className="sidebar">
        <div className="sidebar-header">{isLoadingGuilds && <span className="sidebar-title">{t('common.loading')}</span>}</div>
        <div className="sidebar-channels">
          {isLoadingChannels ? (
            <div className="channel-loading">{t('chat.loading_channels')}</div>
          ) : (
            <ChannelList />
          )}
        </div>
        <div className="sidebar-bottom">
          <PresenceBar />
          {(voiceStatus === 'active' ||
            voiceStatus === 'requesting_mic' ||
            voiceStatus === 'joining' ||
            voiceStatus === 'reconnecting' ||
            voiceStatus === 'leaving' ||
            voiceStatus === 'error') && <VoicePanel />}
          <div className="sidebar-footer">
            <AccountPanel api={api} />
            <div className="sidebar-footer-actions">
              <LanguageSwitcher className="language-switcher" />
              <button type="button" className="btn-ghost sidebar-footer-signout" onClick={() => void logout(api)}>
                {t('common.sign_out')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="chat-main">
        <header className="chat-main-header">
          <div>
            <p className="chat-main-eyebrow">{t('common.server')}</p>
            <h1 className="chat-main-title">{serverName}</h1>
          </div>
        </header>

        {/* Gateway status banner */}
        {banner && (
          <div className={`gateway-banner ${banner.className}`}>
            <span>{gatewayError && gatewayStatus === 'error' ? gatewayError : reconnectLabel}</span>
            {gatewayStatus === 'error' && (
              <button type="button" className="gateway-banner-retry" onClick={() => connect(api, gatewayUrl)}>
                {t('common.retry')}
              </button>
            )}
          </div>
        )}

        {/* Chat-layer error (HTTP errors) */}
        {chatError && <div className="chat-error">{chatError}</div>}

        <div className={'chat-main-body'}>
          <MessagePanel api={api} />
          <StreamPanel />
        </div>
      </main>

      <StreamPopupHost />
    </div>
  );
}
