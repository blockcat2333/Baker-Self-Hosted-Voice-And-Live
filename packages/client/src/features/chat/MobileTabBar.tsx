import { useTranslation } from 'react-i18next';

export type MobileTab = 'channels' | 'chat' | 'voice' | 'more';

interface MobileTabBarProps {
  tab: MobileTab;
  onChange: (next: MobileTab) => void;
  voiceActive: boolean;
  streamActive: boolean;
  notifyVoice: boolean;
}

export function MobileTabBar({ tab, onChange, voiceActive, streamActive, notifyVoice }: MobileTabBarProps) {
  const { t } = useTranslation();

  const tabs: Array<{
    key: MobileTab;
    label: string;
    glyph: string;
    ariaLabel?: string;
    showDot?: boolean;
  }> = [
    { key: 'channels', label: t('chat.tab_channels'), glyph: '#' },
    { key: 'chat', label: t('chat.tab_chat'), glyph: '◇' },
    {
      key: 'voice',
      label: t('chat.tab_voice'),
      glyph: '◉',
      ariaLabel: voiceActive ? t('chat.tab_voice_active_aria') : undefined,
      showDot: notifyVoice,
    },
    { key: 'more', label: t('chat.tab_more'), glyph: '⋯' },
  ];

  void streamActive; // reserved for future stream-only badge differentiation

  return (
    <nav className="mobile-tabbar" aria-label={t('chat.mobile_nav_aria')}>
      {tabs.map((entry) => {
        const isActive = entry.key === tab;
        return (
          <button
            key={entry.key}
            type="button"
            className={`mobile-tabbar-btn${isActive ? ' mobile-tabbar-btn--active' : ''}${
              entry.key === 'voice' && voiceActive ? ' mobile-tabbar-btn--voice-live' : ''
            }`}
            aria-pressed={isActive}
            aria-label={entry.ariaLabel ?? entry.label}
            onClick={() => onChange(entry.key)}
          >
            <span className="mobile-tabbar-glyph" aria-hidden="true">
              {entry.glyph}
              {entry.showDot ? <span className="mobile-tabbar-dot" aria-hidden="true" /> : null}
            </span>
            <span className="mobile-tabbar-label">{entry.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
