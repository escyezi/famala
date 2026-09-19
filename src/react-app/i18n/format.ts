import { useTranslation } from 'react-i18next';
import type { Message } from '../../shared/messages.ts';
import { MAX_POOL_NAME_LENGTH, MAX_POOL_DESCRIPTION_LENGTH } from '../../shared/contracts.ts';
import { zh } from './zh-CN.ts';

export function useFormat() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'zh-CN';
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const dateTime = (time: number | null) =>
    time === null
      ? '—'
      : new Intl.DateTimeFormat(locale, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(time);
  const compactDateTime = (time: number | null) =>
    time === null
      ? '—'
      : new Intl.DateTimeFormat(locale, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(time);
  const message = (value: Message | null | undefined) => {
    if (!value) return '';
    const code =
      value.code === 'TURNSTILE_FAILED' && value.status === 503
        ? 'TURNSTILE_UNAVAILABLE'
        : value.code;
    const key = Object.prototype.hasOwnProperty.call(zh.errors, code)
      ? (code as keyof typeof zh.errors)
      : 'REQUEST_FAILED';
    if (key === 'DUPLICATE_IN_BATCH')
      return t('errors.DUPLICATE_IN_BATCH', { firstLine: value.params?.firstLine ?? '—' });
    if (key === 'POOL_NAME_TOO_LONG' || key === 'POOL_DESCRIPTION_TOO_LONG')
      return t(`errors.${key}`, {
        limit:
          value.params?.limit ??
          (key === 'POOL_NAME_TOO_LONG' ? MAX_POOL_NAME_LENGTH : MAX_POOL_DESCRIPTION_LENGTH),
      });
    return t(`errors.${key}`);
  };
  return { number, dateTime, compactDateTime, message };
}
