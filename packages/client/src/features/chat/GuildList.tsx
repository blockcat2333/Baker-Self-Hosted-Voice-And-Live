import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from './chat-store';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { useLongPressMenu } from './useLongPressMenu';

export function GuildList() {
  const { t } = useTranslation();
  const guilds = useChatStore((s) => s.guilds);
  const activeGuildId = useChatStore((s) => s.activeGuildId);
  const setActiveGuild = useChatStore((s) => s.setActiveGuild);
  const [menu, setMenu] = useState<{ guildId: string; x: number; y: number } | null>(null);
  const [notificationMode, setNotificationMode] = useState<'all' | 'mentions' | 'none'>('mentions');
  const getGuildLongPressProps = useLongPressMenu<string>((guildId, x, y) => {
    setMenu({ guildId, x, y });
  });

  const menuGuild = guilds.find((guild) => guild.id === menu?.guildId);

  function getMenuItems(): ContextMenuEntry[] {
    if (!menuGuild) return [];

    const notificationItems: ContextMenuEntry[] = [
      {
        checked: notificationMode === 'all',
        id: 'notify-all',
        label: t('context.notifications_all'),
        onSelect: () => setNotificationMode('all'),
      },
      {
        checked: notificationMode === 'mentions',
        id: 'notify-mentions',
        label: t('context.notifications_mentions'),
        onSelect: () => setNotificationMode('mentions'),
      },
      {
        checked: notificationMode === 'none',
        id: 'notify-none',
        label: t('context.notifications_none'),
        onSelect: () => setNotificationMode('none'),
      },
    ];

    return [
      { disabled: true, id: 'mark-read', label: t('context.mark_read') },
      { id: 'guild-divider-1', type: 'separator' },
      {
        hint:
          notificationMode === 'all'
            ? t('context.notifications_all')
            : notificationMode === 'none'
              ? t('context.notifications_none')
              : t('context.notifications_mentions'),
        id: 'notifications',
        label: t('context.notification_settings'),
        subItems: notificationItems,
      },
      { id: 'guild-divider-2', type: 'separator' },
      {
        id: 'copy-name',
        label: t('context.copy_name'),
        onSelect: () => void navigator.clipboard.writeText(menuGuild.name),
      },
      {
        id: 'copy-id',
        label: t('context.copy_id'),
        onSelect: () => void navigator.clipboard.writeText(menuGuild.id),
      },
    ];
  }

  return (
    <>
      <nav className="guild-list" aria-label={t('chat.guilds_aria')}>
        <div className="guild-home-mark" aria-hidden="true">
          B
        </div>
        <div className="guild-list-divider" aria-hidden="true" />
        {guilds.map((guild) => (
          <button
            key={guild.id}
            type="button"
            {...getGuildLongPressProps(guild.id)}
            className={`guild-btn${activeGuildId === guild.id ? ' active' : ''}`}
            aria-label={guild.name}
            title={guild.name}
            aria-current={activeGuildId === guild.id ? 'page' : undefined}
            onClick={() => setActiveGuild(guild.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ guildId: guild.id, x: event.clientX, y: event.clientY });
            }}
          >
            <span className="guild-active-pill" aria-hidden="true" />
            {guild.name.slice(0, 2).toUpperCase()}
          </button>
        ))}
      </nav>
      {menu && menuGuild ? (
        <ContextMenu
          ariaLabel={t('context.server_actions')}
          items={getMenuItems()}
          onClose={() => setMenu(null)}
          x={menu.x}
          y={menu.y}
        />
      ) : null}
    </>
  );
}

