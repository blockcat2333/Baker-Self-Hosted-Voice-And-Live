import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../auth/auth-store';
import { useGatewayStore } from '../gateway/gateway-store';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function MemberList() {
  const { t } = useTranslation();
  const currentUser = useAuthStore((s) => s.user);
  const presenceMap = useGatewayStore((s) => s.presenceMap);

  const members = Object.entries(presenceMap)
    .filter(([, presence]) => presence.status === 'online' && presence.connectionCount > 0)
    .map(([userId, presence]) => ({
      name: presence.username ?? (userId === currentUser?.id ? currentUser.username : userId.slice(0, 8)),
      userId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (
    currentUser &&
    !members.some((member) => member.userId === currentUser.id)
  ) {
    members.unshift({ name: currentUser.username, userId: currentUser.id });
  }

  return (
    <aside className="member-list" aria-label={t('chat.members_aria')}>
      <h2 className="member-list-heading">
        {t('common.online')} — {members.length}
      </h2>
      <ul className="member-list-items">
        {members.map((member, index) => (
          <li key={member.userId} className="member-list-item">
            <span className={`member-avatar member-avatar--${index % 5}`} aria-hidden="true">
              {getInitials(member.name)}
              <span className="member-status-dot" />
            </span>
            <span className="member-list-name">{member.name}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
