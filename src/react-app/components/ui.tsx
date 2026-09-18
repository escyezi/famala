import { useFormat } from '../i18n/format.ts';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../shared/messages.ts';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function Icon({
  name,
  size = 20,
}: {
  name:
    | 'chevronLeft'
    | 'chevronRight'
    | 'chevronUp'
    | 'chevronDown'
    | 'gift'
    | 'arrow'
    | 'plus'
    | 'copy'
    | 'check'
    | 'grid'
    | 'key'
    | 'history'
    | 'refresh'
    | 'search'
    | 'logout'
    | 'trash'
    | 'close'
    | 'box';
  size?: number;
}) {
  const paths = {
    chevronLeft: <path d="m15 6-6 6 6 6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
    chevronUp: <path d="m6 15 6-6 6 6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    gift: (
      <>
        <path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13" />
        <path d="M12 8H7.5A2.5 2.5 0 1 1 10 5.5L12 8Zm0 0h4.5A2.5 2.5 0 1 0 14 5.5L12 8Z" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    key: (
      <>
        <path d="M13.5 10.4A6 6 0 1 0 10.4 13.5L14 17v3h3v2h4v-4l-7.5-7.6Z" />
        <circle cx="7" cy="7" r="1.5" />
      </>
    ),
    history: (
      <>
        <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" />
      </>
    ),
    refresh: (
      <path d="M20 11a8 8 0 0 0-13.66-4.66L4 9m0-5v5h5M4 13a8 8 0 0 0 13.66 4.66L20 15m0 5v-5h-5" />
    ),
    logout: <path d="M9 3H4v18h5m-1-9h13m-5-5 5 5-5 5" />,
    trash: <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    box: (
      <>
        <path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10M7 5l10 4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  locked = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  locked?: boolean;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog wide' : 'dialog'}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={id}>{title}</h2>
        {!locked && (
          <button className="icon-button" aria-label={t('common.closeDialog')} onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
export function Notice({
  children,
  kind = 'error',
}: {
  children: ReactNode | Message;
  kind?: 'error' | 'info' | 'success';
}) {
  const { message } = useFormat();
  const content =
    children && typeof children === 'object' && 'code' in children ? message(children) : children;
  return content ? (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {content}
    </div>
  ) : null;
}
export function CopyButton({
  value,
  label: providedLabel,
  className = 'button secondary small',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = providedLabel ?? t('common.copy');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const fallbackId = useId();
  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <span className="copy-action">
      <button
        type="button"
        className={className}
        title={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState('copied');
          } catch {
            setState('failed');
          }
        }}
      >
        <Icon name={state === 'copied' ? 'check' : 'copy'} size={15} />
        <span className="copy-button-label" aria-live="polite">
          {state === 'copied' ? t('common.copied') : label}
        </span>
      </button>
      {state === 'failed' && (
        <>
          <span id={fallbackId} className="field-error" role="alert">
            {t('common.copyFailed')}
          </span>
          <input
            className="copy-fallback-input"
            aria-label={t('common.manualCopy', { label })}
            aria-describedby={fallbackId}
            value={value}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
        </>
      )}
    </span>
  );
}
