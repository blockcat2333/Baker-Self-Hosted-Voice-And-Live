import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { Message } from '@baker/protocol';

export interface MessageListProps {
  messages: Message[];
}

const SCROLL_THRESHOLD_PX = 120;

export function MessageList({ messages }: MessageListProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(messages.length);

  useEffect(() => {
    const prevLength = prevLengthRef.current;
    prevLengthRef.current = messages.length;

    // Only auto-scroll when new messages are appended at the bottom (not when prepending older ones).
    if (messages.length <= prevLength) return;

    const bottom = bottomRef.current;
    if (!bottom) return;

    const scrollParent = bottom.parentElement;
    if (!scrollParent) return;

    const distanceFromBottom =
      scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight;

    if (distanceFromBottom <= SCROLL_THRESHOLD_PX) {
      bottom.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  if (messages.length === 0) {
    return <div className="message-empty">{t('chat.no_messages_yet')}</div>;
  }

  const GROUP_MS = 5 * 60 * 1000; // 5 minutes

  return (
    <ol className="message-list">
      {messages.map((msg, i) => {
        const prev = i > 0 ? messages[i - 1] : undefined;
        const isGrouped =
          prev !== undefined &&
          prev.authorUserId === msg.authorUserId &&
          new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;

        return (
          <li key={msg.id} className={`message-item${isGrouped ? ' message-item--grouped' : ''}`}>
            {!isGrouped && (
              <div className="message-meta">
                <span className="message-author">{msg.authorUsername}</span>
                <time className="message-time" dateTime={msg.createdAt}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
            )}
            <span className="message-content">{msg.content}</span>
          </li>
        );
      })}
      <div ref={bottomRef} />
    </ol>
  );
}

