import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { Tooltip } from './Tooltip';
import { useLongPressMenu } from './useLongPressMenu';

export type ServerRailConnectionState =
  | 'available'
  | 'connected'
  | 'connecting'
  | 'error'
  | 'unavailable';

export interface ServerRailEntry {
  address: string;
  id: string;
  name: string;
  state: ServerRailConnectionState;
}

export interface ServerSwitcherModel {
  activeServerId: string | null;
  busyServerId?: string | null;
  entries: ServerRailEntry[];
  onAdd(): void;
  onEdit(serverId: string): void;
  onManage(): void;
  onRemove(serverId: string): void;
  onRetry(serverId: string): void;
  onSelect(serverId: string): void;
}

interface ServerListProps {
  model: ServerSwitcherModel;
}

export function ServerList({ model }: ServerListProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ serverId: string; x: number; y: number } | null>(null);
  const getLongPressProps = useLongPressMenu<string>((serverId, x, y) => {
    setMenu({ serverId, x, y });
  });
  const menuServer = model.entries.find((entry) => entry.id === menu?.serverId) ?? null;

  function stateLabel(state: ServerRailConnectionState) {
    return t(`servers.status_${state}`);
  }

  function menuItems(): ContextMenuEntry[] {
    if (!menuServer) return [];
    return [
      {
        id: 'server-retry',
        label: t('servers.retry'),
        onSelect: () => model.onRetry(menuServer.id),
      },
      {
        id: 'server-edit',
        label: t('servers.edit'),
        onSelect: () => model.onEdit(menuServer.id),
      },
      {
        id: 'server-copy-address',
        label: t('servers.copy_address'),
        onSelect: () => void navigator.clipboard.writeText(menuServer.address),
      },
      { id: 'server-divider', type: 'separator' },
      {
        danger: true,
        id: 'server-remove',
        label: t('servers.remove'),
        onSelect: () => model.onRemove(menuServer.id),
      },
    ];
  }

  return (
    <>
      <nav className="guild-list desktop-server-list" aria-label={t('servers.aria')}>
        <Tooltip label={t('servers.manage')} placement="right">
          <button type="button" className="guild-home-mark desktop-server-home" onClick={model.onManage}>
            B
          </button>
        </Tooltip>
        <div className="guild-list-divider" aria-hidden="true" />
        {model.entries.map((server) => {
          const isActive = model.activeServerId === server.id;
          const isBusy = model.busyServerId === server.id;
          const tooltip = `${server.name} · ${stateLabel(isBusy ? 'connecting' : server.state)} · ${server.address}`;
          return (
            <Tooltip key={server.id} label={tooltip} placement="right">
              <button
                type="button"
                {...getLongPressProps(server.id)}
                className={`guild-btn desktop-server-btn desktop-server-btn--${isBusy ? 'connecting' : server.state}${isActive ? ' active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                aria-label={tooltip}
                onClick={() => {
                  if (!isActive) model.onSelect(server.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ serverId: server.id, x: event.clientX, y: event.clientY });
                }}
              >
                <span className="guild-active-pill" aria-hidden="true" />
                <span className="desktop-server-initials" aria-hidden="true">
                  {server.name.trim().slice(0, 2).toUpperCase() || 'B'}
                </span>
                <span className="desktop-server-status" aria-hidden="true" />
              </button>
            </Tooltip>
          );
        })}
        <span className="desktop-server-list-spacer" aria-hidden="true" />
        <Tooltip label={t('servers.add')} placement="right">
          <button
            type="button"
            className="guild-btn desktop-server-add"
            aria-label={t('servers.add')}
            onClick={model.onAdd}
          >
            +
          </button>
        </Tooltip>
      </nav>
      {menu && menuServer ? (
        <ContextMenu
          ariaLabel={t('servers.actions', { server: menuServer.name })}
          items={menuItems()}
          onClose={() => setMenu(null)}
          x={menu.x}
          y={menu.y}
        />
      ) : null}
    </>
  );
}
