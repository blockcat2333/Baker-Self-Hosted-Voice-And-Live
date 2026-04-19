import { useTranslation } from 'react-i18next';

import { useChatStore } from './chat-store';

export function GuildList() {
  const { t } = useTranslation();
  const guilds = useChatStore((s) => s.guilds);
  const activeGuildId = useChatStore((s) => s.activeGuildId);
  const setActiveGuild = useChatStore((s) => s.setActiveGuild);

  return (
    <nav className="guild-list" aria-label={t('chat.guilds_aria')}>
      {guilds.map((guild) => (
        <button
          key={guild.id}
          type="button"
          className={`guild-btn${activeGuildId === guild.id ? ' active' : ''}`}
          title={guild.name}
          onClick={() => setActiveGuild(guild.id)}
        >
          {guild.name.slice(0, 2).toUpperCase()}
        </button>
      ))}
    </nav>
  );
}

