import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@baker/sdk';

import { useChatStore } from './chat-store';

export interface SendBoxProps {
  api: ApiClient;
  channelId: string;
}

export function SendBox({ api, channelId }: SendBoxProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const sendMessage = useChatStore((s) => s.sendMessage);

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
      <textarea
        className="send-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('chat.message_placeholder')}
        rows={1}
      />
      <button type="submit" className="send-btn" disabled={!text.trim()}>
        {t('common.send')}
      </button>
    </form>
  );
}

