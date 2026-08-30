import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

import { useChatStore } from './chat-store';
import { Tooltip } from './Tooltip';

export interface SendBoxProps {
  api: ApiClient;
  channelId: string;
}

export function SendBox({ api, channelId }: SendBoxProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [showAttachmentHint, setShowAttachmentHint] = useState(false);
  const sendMessage = useChatStore((s) => s.sendMessage);

  useEffect(() => {
    if (!showAttachmentHint) return;
    const timer = window.setTimeout(() => setShowAttachmentHint(false), 1_600);
    return () => window.clearTimeout(timer);
  }, [showAttachmentHint]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    setText('');
    try {
      await sendMessage(api, channelId, content);
    } catch {
      // error surfaced in store
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <form className="send-box" onSubmit={handleSubmit}>
      <Tooltip label={t('chat.file_transfer_in_development')} open={showAttachmentHint}>
        <button
          type="button"
          className="send-box-add"
          aria-label={t('chat.file_transfer_in_development')}
          onClick={() => setShowAttachmentHint(true)}
        >
          <span aria-hidden="true">+</span>
        </button>
      </Tooltip>
      <textarea
        className="send-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('chat.message_placeholder')}
        rows={1}
      />
      <button
        type="submit"
        className="send-btn"
        disabled={!text.trim()}
        aria-label={t('common.send')}
        title={t('common.send')}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m4 4 17 8-17 8 3-7 8-1-8-1-3-7Z" />
        </svg>
      </button>
    </form>
  );
}

