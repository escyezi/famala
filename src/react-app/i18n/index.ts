import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zh } from './zh-CN.ts';
import { en } from './en.ts';

export type Locale = 'zh-CN' | 'en';
export const LOCALE_KEY = 'famala.locale';
export const resources = { 'zh-CN': { translation: zh }, en: { translation: en } };

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof zh };
    strictKeyChecks: true;
  }
}

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === 'zh-CN' || saved === 'en') return saved;
  } catch {
    /* Storage is optional for language selection. */
  }
  for (const language of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'zh-CN';
}

export const i18n = i18next.createInstance();
export const i18nReady = i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en'],
  load: 'currentOnly',
  initAsync: false,
  interpolation: { escapeValue: false },
});

export function updateDocumentLanguage() {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'zh-CN';
  document.title = i18n.t('common.title');
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute('content', i18n.t('common.description'));
}
i18n.on('languageChanged', updateDocumentLanguage);
void i18nReady.then(updateDocumentLanguage);

export async function selectLocale(locale: Locale) {
  await i18n.changeLanguage(locale);
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* Keep the in-memory preference. */
  }
}
