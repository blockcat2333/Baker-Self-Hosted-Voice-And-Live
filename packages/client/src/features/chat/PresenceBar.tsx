import { useTranslation } from 'react-i18next';

import { useGatewayStore } from '../gateway/gateway-store';

export function PresenceBar() {
  const { t } = useTranslation();
  const presenceMap = useGatewayStore((s) => s.presenceMap);

  const online = Object.entries(presenceMap).filter(
    ([, entry]) => entry.status === 'online' && entry.connectionCount > 0,
  );

  if (online.length === 0) return null;

  return (
    <div className="presence-bar">
      <div className="presence-bar-header">
        <span className="presence-bar-label">{t('common.online')}</span>
        <span className="presence-count" aria-label={t('common.online')}>
          {online.length}
        </span>
      </div>
      <ul className="presence-list">
        {online.map(([userId, entry]) => (
          <li key={userId} className="presence-item">
            <span className="presence-dot" aria-hidden="true" />
            <span className="presence-name">{entry.username ?? userId.slice(0, 8)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
