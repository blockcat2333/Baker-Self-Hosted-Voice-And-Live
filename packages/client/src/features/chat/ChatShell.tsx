import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

import { AccountPanel } from '../auth/AccountPanel';
import { useGatewayStore } from '../gateway/gateway-store';
import { StreamPanel } from '../stream/StreamPanel';
import { StreamPopupHost } from '../stream/StreamPopupHost';
import { useStreamStore } from '../stream/stream-store';
import { useVoiceStore } from '../voice/voice-store';
import { VoiceBottomControlBar, VoiceChannelView, VoiceSidebarVolumeControls } from '../voice/VoicePanel';
import { loadBooleanPreference, saveClientPreferencesPatch } from '../preferences/client-preferences';
import { syncGatewayChannelSubscription } from './channel-sync';
import { useChatStore } from './chat-store';
import { GuildList } from './GuildList';
import { ChannelList } from './ChannelList';
import { MessagePanel } from './MessagePanel';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { PresenceBar } from './PresenceBar';
import { SettingsDialog } from './SettingsDialog';

export interface ChatShellProps {
  api: ApiClient;
  gatewayUrl: string;
  onChangeServer?: () => void;
  serverName: string;
  versionWarning?: string | null;
}

type MainChannelSelection = {
  channelId: string | null;
  kind: 'text' | 'voice';
};

function SettingsIcon() {
  return (
    <svg className="sidebar-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M9.6 3.4 9.2 5.6a7.7 7.7 0 0 0-1.7 1L5.4 5.8 3.8 8.6l1.8 1.4a7 7 0 0 0 0 2l-1.8 1.4 1.6 2.8 2.1-.8a7.7 7.7 0 0 0 1.7 1l.4 2.2h3.2l.4-2.2a7.7 7.7 0 0 0 1.7-1l2.1.8 1.6-2.8-1.8-1.4a7 7 0 0 0 0-2l1.8-1.4-1.6-2.8-2.1.8a7.7 7.7 0 0 0-1.7-1l-.4-2.2H9.6Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ChatShell({ api, gatewayUrl, onChangeServer, serverName, versionWarning }: ChatShellProps) {
  const { t } = useTranslation();
  const activeGuildId = useChatStore((s) => s.activeGuildId);
  const channelsByGuild = useChatStore((s) => s.channelsByGuild);
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
  const switchChannel = useGatewayStore((s) => s.switchChannel);
  const voiceStatus = useVoiceStore((s) => s.status);
  const voiceChannelId = useVoiceStore((s) => s.channelId);
  const ownedStream = useStreamStore((s) => s.ownedStream);
  const watchedStreamsById = useStreamStore((s) => s.watchedStreamsById);

  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isStreamShareDialogOpen, setIsStreamShareDialogOpen] = useState(false);
  const [showDataDetails, setShowDataDetails] = useState(() => loadBooleanPreference('showDataDetails', true));
  const [mainChannelSelection, setMainChannelSelection] = useState<MainChannelSelection>({
    channelId: null,
    kind: 'text',
  });
  const previousActiveChannelIdRef = useRef<string | null>(null);

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

  useEffect(() => {
    syncGatewayChannelSubscription(previousActiveChannelIdRef.current, activeChannelId, switchChannel);
    previousActiveChannelIdRef.current = activeChannelId;
  }, [activeChannelId, switchChannel]);

  // Keep the main pane selection UI-only so voice channels never become the active text channel.
  function handleNavigateAfterChannelPick(kind: 'text' | 'voice', channelId: string) {
    setMainChannelSelection({ channelId, kind });
    if (kind === 'text') {
      setMobileTab('chat');
    } else {
      setMobileTab('voice');
    }
  }

  function handleShowDataDetailsChange(show: boolean) {
    setShowDataDetails(show);
    saveClientPreferencesPatch({ showDataDetails: show });
  }

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

  const isVoiceActive =
    voiceStatus === 'active' ||
    voiceStatus === 'requesting_mic' ||
    voiceStatus === 'joining' ||
    voiceStatus === 'reconnecting' ||
    voiceStatus === 'leaving' ||
    voiceStatus === 'error' ||
    !!voiceChannelId;

  const hasAnyStream = !!ownedStream || Object.keys(watchedStreamsById).length > 0;
  const voiceHasContent = isVoiceActive || hasAnyStream;
  const activeGuildChannels = activeGuildId ? (channelsByGuild[activeGuildId] ?? []) : [];
  const selectedVoiceChannel =
    mainChannelSelection.kind === 'voice'
      ? activeGuildChannels.find((channel) => channel.id === mainChannelSelection.channelId && channel.type === 'voice')
      : null;

  return (
    <div className="chat-shell" data-mobile-tab={mobileTab}>
      <GuildList />

      <div className="sidebar" data-on-mobile="channels voice more">
        <div className="sidebar-section sidebar-section--channels" data-on-mobile="channels">
          <div className="sidebar-header">{isLoadingGuilds && <span className="sidebar-title">{t('common.loading')}</span>}</div>
          <div className="sidebar-channels">
            {isLoadingChannels ? (
              <div className="channel-loading">{t('chat.loading_channels')}</div>
            ) : (
              <ChannelList onAfterPick={handleNavigateAfterChannelPick} />
            )}
          </div>
        </div>

        <div className="sidebar-section sidebar-section--voice" data-on-mobile="voice">
          {!isVoiceActive ? (
            <div className="sidebar-voice-idle">
              <p className="sidebar-voice-empty">{t('chat.voice_section_idle')}</p>
            </div>
          ) : null}
        </div>

        <div className="sidebar-section sidebar-section--more" data-on-mobile="more">
          <PresenceBar />
          <div className="sidebar-footer">
            <AccountPanel api={api} />
            <div className="sidebar-footer-actions">
              <button
                type="button"
                className="btn-ghost sidebar-footer-settings"
                onClick={() => setIsSettingsOpen(true)}
                aria-label={t('settings.open')}
                title={t('settings.open')}
              >
                <SettingsIcon />
              </button>
              <VoiceSidebarVolumeControls />
            </div>
          </div>
        </div>
      </div>

      <main className="chat-main" data-on-mobile="chat voice">
        <header className="chat-main-header" data-on-mobile="chat">
          <div>
            <p className="chat-main-eyebrow">{t('common.server')}</p>
            <h1 className="chat-main-title">{serverName}</h1>
          </div>
        </header>

        {/* Gateway status banner */}
        {banner && (
          <div className={`gateway-banner ${banner.className}`} data-on-mobile="chat voice more">
            <span>{gatewayError && gatewayStatus === 'error' ? gatewayError : reconnectLabel}</span>
            {gatewayStatus === 'error' && (
              <button type="button" className="gateway-banner-retry" onClick={() => connect(api, gatewayUrl)}>
                {t('common.retry')}
              </button>
            )}
          </div>
        )}

        {versionWarning ? (
          <div className="gateway-banner gateway-banner--warn" data-on-mobile="chat voice more">
            <span>{versionWarning}</span>
          </div>
        ) : null}

        {/* Chat-layer error (HTTP errors) */}
        {chatError && <div className="chat-error" data-on-mobile="chat">{chatError}</div>}

        <div className="chat-main-body">
          <div className="chat-main-pane chat-main-pane--messages" data-on-mobile="chat voice">
            {selectedVoiceChannel ? (
              <div className="chat-main-pane-split">
                <section className="chat-main-split-section chat-main-split-section--voice">
                  <VoiceChannelView channelId={selectedVoiceChannel.id} channelName={selectedVoiceChannel.name} />
                </section>
                <section className="chat-main-split-section chat-main-split-section--messages">
                  <MessagePanel api={api} />
                </section>
              </div>
            ) : (
              <MessagePanel api={api} />
            )}
          </div>
          {showDataDetails ? (
            <div className="chat-main-pane chat-main-pane--stream" data-on-mobile="voice">
              <StreamPanel
                isShareDialogOpen={isStreamShareDialogOpen}
                onCloseShareDialog={() => setIsStreamShareDialogOpen(false)}
              />
            </div>
          ) : null}
        </div>
        <VoiceBottomControlBar onOpenStreamShareDialog={() => setIsStreamShareDialogOpen(true)} />
      </main>

      <MobileTabBar
        tab={mobileTab}
        onChange={setMobileTab}
        voiceActive={isVoiceActive}
        streamActive={hasAnyStream}
        notifyVoice={voiceHasContent}
      />

      <StreamPopupHost />

      {isSettingsOpen ? (
        <SettingsDialog
          api={api}
          onChangeServer={onChangeServer}
          onClose={() => setIsSettingsOpen(false)}
          onShowDataDetailsChange={handleShowDataDetailsChange}
          showDataDetails={showDataDetails}
        />
      ) : null}
    </div>
  );
}
