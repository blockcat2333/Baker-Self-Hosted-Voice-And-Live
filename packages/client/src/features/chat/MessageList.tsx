import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Message } from '@baker/protocol';

import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { useLongPressMenu } from './useLongPressMenu';

export interface MessageListProps {
  messages: Message[];
}

const SCROLL_THRESHOLD_PX = 120;

export function MessageList({ messages }: MessageListProps) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(messages.length);
  const [menu, setMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [unreadFromMessageId, setUnreadFromMessageId] = useState<string | null>(null);
  const [reactionsByMessage, setReactionsByMessage] = useState<Record<string, string[]>>({});
  const getMessageLongPressProps = useLongPressMenu<Message>((message, x, y) => {
    setMenu({ message, x, y });
  });

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

  function toggleReaction(messageId: string, emoji: string) {
    setReactionsByMessage((current) => {
      const reactions = current[messageId] ?? [];
      const nextReactions = reactions.includes(emoji)
        ? reactions.filter((reaction) => reaction !== emoji)
        : [...reactions, emoji];
      return { ...current, [messageId]: nextReactions };
    });
  }

  function messageMenuItems(message: Message): ContextMenuEntry[] {
    return [
      {
        id: 'reaction',
        label: t('context.add_reaction'),
        subItems: ['👍', '❤️', '😂', '🎉'].map((emoji) => ({
          checked: (reactionsByMessage[message.id] ?? []).includes(emoji),
          id: `reaction-${emoji}`,
          label: emoji,
          onSelect: () => toggleReaction(message.id, emoji),
        })),
      },
      { id: 'message-divider-1', type: 'separator' },
      {
        id: 'copy-text',
        label: t('context.copy_text'),
        onSelect: () => void navigator.clipboard.writeText(message.content),
      },
      {
        checked: unreadFromMessageId === message.id,
        id: 'mark-unread',
        label: t('context.mark_unread'),
        onSelect: () => setUnreadFromMessageId(message.id),
      },
      { id: 'message-divider-2', type: 'separator' },
      {
        id: 'copy-id',
        label: t('context.copy_message_id'),
        onSelect: () => void navigator.clipboard.writeText(message.id),
      },
    ];
  }

  return (
    <>
      <ol className="message-list">
        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : undefined;
          const isGrouped =
            prev !== undefined &&
            prev.authorUserId === msg.authorUserId &&
            new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
          const reactions = reactionsByMessage[msg.id] ?? [];

          return (
            <li
              key={msg.id}
              {...getMessageLongPressProps(msg)}
              className={`message-item${isGrouped ? ' message-item--grouped' : ''}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ message: msg, x: event.clientX, y: event.clientY });
              }}
            >
              {unreadFromMessageId === msg.id ? (
                <div className="message-unread-divider" role="separator">
                  <span>{t('chat.new_messages')}</span>
                </div>
              ) : null}
              {!isGrouped ? (
                <span className="message-avatar" aria-hidden="true">
                  {msg.authorUsername.slice(0, 2).toUpperCase()}
                </span>
              ) : (
                <time className="message-grouped-time" dateTime={msg.createdAt}>
                  {new Date(msg.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              )}
              <div className="message-body">
                {!isGrouped && (
                  <div className="message-meta">
                    <span className="message-author">{msg.authorUsername}</span>
                    <time className="message-time" dateTime={msg.createdAt}>
                      {new Date(msg.createdAt).toLocaleString([], {
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        month: 'short',
                      })}
                    </time>
                  </div>
                )}
                <span className="message-content">{msg.content}</span>
                {reactions.length > 0 ? (
                  <div className="message-reactions" aria-label={t('context.reactions')}>
                    {reactions.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="message-reaction message-reaction--active"
                        onClick={() => toggleReaction(msg.id, emoji)}
                      >
                        <span aria-hidden="true">{emoji}</span>
                        <span>1</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
        <div ref={bottomRef} />
      </ol>
      {menu ? (
        <ContextMenu
          ariaLabel={t('context.message_actions')}
          items={messageMenuItems(menu.message)}
          onClose={() => setMenu(null)}
          x={menu.x}
          y={menu.y}
        />
      ) : null}
    </>
  );
}

