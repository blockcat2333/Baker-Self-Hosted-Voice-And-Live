import { useTranslation } from 'react-i18next';

export interface LanguageSwitcherProps {
  className?: string;
}

function normalizeLanguage(language: string) {
  return language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const active = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);

  return (
    <div className={className} role="group" aria-label={t('common.language')}>
      <button
        type="button"
        className="btn-ghost"
        aria-pressed={active === 'en'}
        onClick={() => void i18n.changeLanguage('en')}
      >
        EN
      </button>
      <button
        type="button"
        className="btn-ghost"
        aria-pressed={active === 'zh'}
        onClick={() => void i18n.changeLanguage('zh')}
      >
        中文
      </button>
    </div>
  );
}
