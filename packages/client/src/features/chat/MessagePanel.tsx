import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

import { useChatStore } from './chat-store';
import { MessageList } from './MessageList';
import { SendBox } from './SendBox';

export interface MessagePanelProps {
  api: ApiClient;
}

export function MessagePanel({ api }: MessagePanelProps) {
  const { t } = useTranslation();
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const messagesByChannel = useChatStore((s) => s.messagesByChannel);
  const hasMoreByChannel = useChatStore((s) => s.hasMoreByChannel);
  const isLoadingMessages = useChatStore((s) => s.isLoadingMessages);
  const isLoadingOlder = useChatStore((s) => s.isLoadingOlder);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Captured scroll height before prepending older messages
  const prevScrollHeightRef = useRef<number>(0);
  const isPrependingRef = useRef(false);

  // After older messages are prepended, restore scroll position
  useLayoutEffect(() => {
    if (!isPrependingRef.current) return;
    isPrependingRef.current = false;
    const el = scrollRef.current;
    if (!el) return;
    const delta = el.scrollHeight - prevScrollHeightRef.current;
    el.scrollTop += delta;
  });

  if (!activeChannelId) {
    return <div className="message-panel-empty">{t('chat.select_channel_prompt')}</div>;
  }

  const messages = messagesByChannel[activeChannelId] ?? [];
  const hasMore = hasMoreByChannel[activeChannelId] ?? false;

  function handleLoadOlder() {
    if (!activeChannelId) return;
    const el = scrollRef.current;
    prevScrollHeightRef.current = el?.scrollHeight ?? 0;
    isPrependingRef.current = true;
    void loadOlderMessages(api, activeChannelId);
  }

  return (
    <div className="message-panel">
      <div className="message-scroll" ref={scrollRef}>
        {isLoadingMessages ? (
          <div className="message-empty">{t('common.loading')}</div>
        ) : (
          <>
            {hasMore && (
              <div className="load-older-row">
                <button
                  type="button"
                  className="btn-load-older"
                  onClick={handleLoadOlder}
                  disabled={isLoadingOlder}
                >
                  {isLoadingOlder ? t('common.loading') : t('chat.load_older_messages')}
                </button>
              </div>
            )}
            {!hasMore && messages.length > 0 && (
              <div className="channel-start-sentinel">{t('chat.beginning_of_channel')}</div>
            )}
            <MessageList messages={messages} />
          </>
        )}
      </div>
      <SendBox api={api} channelId={activeChannelId} />
    </div>
  );
}

