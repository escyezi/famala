import { useTranslation } from 'react-i18next';
import { selectLocale } from '../i18n/index.ts';

export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const english = i18n.resolvedLanguage === 'en';
  const label = t(english ? 'common.switchToChinese' : 'common.switchToEnglish');
  return (
    <button
      type="button"
      className="language-toggle"
      aria-label={label}
      title={label}
      onClick={() => void selectLocale(english ? 'zh-CN' : 'en')}
    >
      <svg className="language-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path
          d="M34 14h21a5 5 0 0 1 5 5v36a5 5 0 0 1-5 5H25l9-46Z"
          fill="var(--color-surface)"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <text x="49" y="39" className="language-icon-back">
          {english ? '文' : 'En'}
        </text>
        <path d="M9 4h22l9 47H9a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5Z" fill="currentColor" />
        <text x="20" y="29" className="language-icon-front">
          {english ? 'En' : '文'}
        </text>
      </svg>
    </button>
  );
}
