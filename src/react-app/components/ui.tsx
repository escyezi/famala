import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function Icon({
  name,
  size = 20,
}: {
  name:
    | 'gift'
    | 'arrow'
    | 'plus'
    | 'copy'
    | 'check'
    | 'grid'
    | 'key'
    | 'history'
    | 'logout'
    | 'close'
    | 'box';
  size?: number;
}) {
  const paths = {
    gift: (
      <>
        <path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13" />
        <path d="M12 8H7.5A2.5 2.5 0 1 1 10 5.5L12 8Zm0 0h4.5A2.5 2.5 0 1 0 14 5.5L12 8Z" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
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
        <circle cx="8" cy="9" r="5" />
        <path d="m12 13 8 8m-4-4 3-3m-6 0 3-3" />
      </>
    ),
    history: (
      <>
        <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" />
      </>
    ),
    logout: <path d="M9 3H4v18h5m-1-9h13m-5-5 5 5-5 5" />,
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
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
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
  children: ReactNode;
  kind?: 'error' | 'info' | 'success';
}) {
  return children ? (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  ) : null;
}
export function CopyButton({
  value,
  label = '复制',
  className = 'button secondary small',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState('');
  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => setState(''), 2500);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <span className="copy-action">
      <button
        className={className}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState('已复制');
          } catch {
            setState('复制失败，请手动选择文本复制');
          }
        }}
      >
        <Icon name={state === '已复制' ? 'check' : 'copy'} size={15} />
        {state === '已复制' ? state : label}
      </button>
      {state && state !== '已复制' && (
        <span className="field-error" role="alert">
          {state}
        </span>
      )}
    </span>
  );
}
