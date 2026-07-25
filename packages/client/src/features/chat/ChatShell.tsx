import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

import { AccountPanel } from '../auth/AccountPanel';
import { useGatewayStore } from '../gateway/gateway-store';
import { StreamPanel } from '../stream/StreamPanel';
import { StreamPopupHost } from '../stream/StreamPopupHost';
import { useStreamStore } from '../stream/stream-store';
import { useVoiceStore } from '../voice/voice-store';
import { VoiceBottomControlBar, VoiceChannelView, VoicePanel, VoiceSidebarVolumeControls } from '../voice/VoicePanel';
import { loadBooleanPreference, saveClientPreferencesPatch } from '../preferences/client-preferences';
import { syncGatewayChannelSubscription } from './channel-sync';
import { useChatStore } from './chat-store';
import { GuildList } from './GuildList';
import { ChannelList } from './ChannelList';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { MemberList } from './MemberList';
import { MessagePanel } from './MessagePanel';
import { MobileTabBar, type MobileTab } from './MobileTabBar';
import { PresenceBar } from './PresenceBar';
import { SidebarMusicError } from './SidebarMusicError';
import { SettingsDialog } from './SettingsDialog';
import { Tooltip } from './Tooltip';

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
  const guilds = useChatStore((s) => s.guilds);
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
  const [isMemberListOpen, setIsMemberListOpen] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [serverMenu, setServerMenu] = useState<{ x: number; y: number } | null>(null);
  const [serverNotificationMode, setServerNotificationMode] = useState<'all' | 'mentions' | 'none'>(
    'mentions',
  );
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
  const activeGuild = guilds.find((guild) => guild.id === activeGuildId);
  const activeTextChannel = activeGuildChannels.find(
    (channel) => channel.id === activeChannelId && channel.type !== 'voice',
  );
  const selectedVoiceChannel =
    mainChannelSelection.kind === 'voice'
      ? activeGuildChannels.find((channel) => channel.id === mainChannelSelection.channelId && channel.type === 'voice')
      : null;
  const selectedChannel = selectedVoiceChannel ?? activeTextChannel;
  const searchResults = searchQuery.trim()
    ? (activeChannelId ? (messagesByChannel[activeChannelId] ?? []) : [])
        .filter((message) => {
          const query = searchQuery.trim().toLocaleLowerCase();
          return (
            message.content.toLocaleLowerCase().includes(query) ||
            message.authorUsername.toLocaleLowerCase().includes(query)
          );
        })
        .slice(-8)
        .reverse()
    : [];

  const serverMenuItems: ContextMenuEntry[] = [
    { disabled: true, id: 'mark-read', label: t('context.mark_read') },
    { id: 'server-divider-1', type: 'separator' },
    {
      hint:
        serverNotificationMode === 'all'
          ? t('context.notifications_all')
          : serverNotificationMode === 'none'
            ? t('context.notifications_none')
            : t('context.notifications_mentions'),
      id: 'notification-settings',
      label: t('context.notification_settings'),
      subItems: [
        {
          checked: serverNotificationMode === 'all',
          id: 'notify-all',
          label: t('context.notifications_all'),
          onSelect: () => setServerNotificationMode('all'),
        },
        {
          checked: serverNotificationMode === 'mentions',
          id: 'notify-mentions',
          label: t('context.notifications_mentions'),
          onSelect: () => setServerNotificationMode('mentions'),
        },
        {
          checked: serverNotificationMode === 'none',
          id: 'notify-none',
          label: t('context.notifications_none'),
          onSelect: () => setServerNotificationMode('none'),
        },
      ],
    },
    { id: 'server-divider-2', type: 'separator' },
    {
      id: 'copy-server-name',
      label: t('context.copy_name'),
      onSelect: () => void navigator.clipboard.writeText(serverName),
    },
    ...(activeGuildId
      ? [
          {
            id: 'copy-server-id',
            label: t('context.copy_id'),
            onSelect: () => void navigator.clipboard.writeText(activeGuildId),
          } satisfies ContextMenuEntry,
        ]
      : []),
  ];

  return (
    <div className="chat-shell" data-mobile-tab={mobileTab}>
      <GuildList />

      <div className="sidebar" data-on-mobile="channels voice more">
        <div className="sidebar-section sidebar-section--channels" data-on-mobile="channels">
          <div className="sidebar-header">
            <button
              type="button"
              className="sidebar-server-button"
              aria-haspopup="menu"
              aria-expanded={Boolean(serverMenu)}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setServerMenu({ x: rect.left + 8, y: rect.bottom + 4 });
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setServerMenu({ x: event.clientX, y: event.clientY });
              }}
            >
              <span className="sidebar-server-name">
                {isLoadingGuilds ? t('common.loading') : (activeGuild?.name ?? serverName)}
              </span>
              <span className="sidebar-server-chevron" aria-hidden="true">
                {serverMenu ? '×' : '⌄'}
              </span>
            </button>
          </div>
          <div className="sidebar-channels">
            {isLoadingChannels ? (
              <div className="channel-loading">{t('chat.loading_channels')}</div>
            ) : (
              <ChannelList onAfterPick={handleNavigateAfterChannelPick} />
            )}
          </div>
        </div>

        <div className="sidebar-section sidebar-section--voice" data-on-mobile="voice">
          {isVoiceActive ? (
            <VoicePanel />
          ) : (
            <div className="sidebar-voice-idle">
              <p className="sidebar-voice-empty">{t('chat.voice_section_idle')}</p>
            </div>
          )}
        </div>

        <div className="sidebar-section sidebar-section--more" data-on-mobile="more">
          <SidebarMusicError />
          <PresenceBar />
          <div className="sidebar-footer">
            <AccountPanel api={api} />
            <div className="sidebar-footer-actions">
              <Tooltip label={t('settings.open')}>
                <button
                  type="button"
                  className="btn-ghost sidebar-footer-settings"
                  onClick={() => setIsSettingsOpen(true)}
                  aria-label={t('settings.open')}
                >
                  <SettingsIcon />
                </button>
              </Tooltip>
              <VoiceSidebarVolumeControls />
            </div>
          </div>
        </div>
      </div>

      <main className="chat-main" data-on-mobile="chat voice">
        <header className="chat-main-header" data-on-mobile="chat">
          <div className="chat-main-channel-title">
            <span className="chat-main-channel-icon" aria-hidden="true">
              {selectedVoiceChannel ? (
                <svg viewBox="0 0 24 24">
                  <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 1.1a3 3 0 0 1 0 3.8M19 7.5a6 6 0 0 1 0 9" />
                </svg>
              ) : (
                '#'
              )}
            </span>
            <h1 className="chat-main-title">{selectedChannel?.name ?? serverName}</h1>
          </div>
          <div className="chat-main-toolbar">
            <Tooltip label={t('chat.toggle_members')} placement="bottom">
              <button
                type="button"
                className={`chat-toolbar-button${isMemberListOpen ? ' active' : ''}`}
                aria-label={t('chat.toggle_members')}
                aria-pressed={isMemberListOpen}
                onClick={() => setIsMemberListOpen((current) => !current)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8.5 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7-1a3 3 0 1 0 0-6M2.5 19c.5-3.1 2.5-5 6-5s5.5 1.9 6 5m1-6c3 0 5 1.8 5.5 4.5" />
                </svg>
              </button>
            </Tooltip>
            <button
              type="button"
              className="chat-header-search"
              aria-expanded={isSearchOpen}
              aria-haspopup="dialog"
              onClick={() => setIsSearchOpen((current) => !current)}
            >
              <span>{t('chat.search')}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6" />
                <path d="m15 15 5 5" />
              </svg>
            </button>
          </div>
          {isSearchOpen ? (
            <div className="chat-search-popover" role="dialog" aria-label={t('chat.search_messages')}>
              <div className="chat-search-popover-header">
                <input
                  autoFocus
                  type="search"
                  value={searchQuery}
                  placeholder={t('chat.search_messages')}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setIsSearchOpen(false);
                  }}
                />
                <button
                  type="button"
                  aria-label={t('settings.close')}
                  onClick={() => setIsSearchOpen(false)}
                >
                  ×
                </button>
              </div>
              {searchQuery.trim() ? (
                searchResults.length > 0 ? (
                  <ul className="chat-search-results">
                    {searchResults.map((message) => (
                      <li key={message.id}>
                        <strong>{message.authorUsername}</strong>
                        <span>{message.content}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="chat-search-empty">{t('chat.no_search_results')}</p>
                )
              ) : (
                <p className="chat-search-empty">{t('chat.search_hint')}</p>
              )}
            </div>
          ) : null}
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
                  <VoiceChannelView
                    channelId={selectedVoiceChannel.id}
                    channelName={selectedVoiceChannel.name}
                    showConnectionHealth={!showDataDetails}
                  />
                </section>
                <section className="chat-main-split-section chat-main-split-section--messages">
                  <MessagePanel api={api} />
                </section>
              </div>
            ) : (
              <MessagePanel api={api} />
            )}
          </div>
          {isMemberListOpen ? (
            <div className="chat-context-sidebar" data-on-mobile="voice">
              <MemberList />
              {hasAnyStream && showDataDetails ? (
                <StreamPanel
                  isShareDialogOpen={false}
                  onCloseShareDialog={() => setIsStreamShareDialogOpen(false)}
                  showDashboard
                />
              ) : null}
            </div>
          ) : hasAnyStream && showDataDetails ? (
            <div className="chat-main-pane chat-main-pane--stream" data-on-mobile="voice">
              <StreamPanel
                isShareDialogOpen={isStreamShareDialogOpen}
                onCloseShareDialog={() => setIsStreamShareDialogOpen(false)}
                showDashboard={showDataDetails}
              />
            </div>
          ) : null}
        </div>
        <VoiceBottomControlBar onOpenStreamShareDialog={() => setIsStreamShareDialogOpen(true)} />
        {hasAnyStream && showDataDetails ? null : (
          <StreamPanel
            isShareDialogOpen={isStreamShareDialogOpen}
            onCloseShareDialog={() => setIsStreamShareDialogOpen(false)}
            showDashboard={false}
          />
        )}
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

      {serverMenu ? (
        <ContextMenu
          ariaLabel={t('context.server_actions')}
          items={serverMenuItems}
          onClose={() => setServerMenu(null)}
          x={serverMenu.x}
          y={serverMenu.y}
        />
      ) : null}
    </div>
  );
}
