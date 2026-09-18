import { useTranslation } from 'react-i18next';
import { useEffect, useId, useRef, useState } from 'react';

export function PoolActionsMenu({
  stopped,
  busy,
  onRename,
  onStatus,
  onDelete,
}: {
  stopped: boolean;
  busy: boolean;
  onRename: () => void;
  onStatus: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action();
  }

  return (
    <div
      className="pool-actions-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="button secondary small"
        ref={trigger}
        disabled={busy}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {t('manage.more')}
      </button>
      {open && (
        <div
          className="pool-actions-panel"
          id={panelId}
          role="group"
          aria-label={t('manage.actions')}
        >
          <button disabled={busy} onClick={() => choose(onRename)}>
            {t('manage.rename')}
          </button>
          <button disabled={busy} onClick={() => choose(onStatus)}>
            {stopped ? t('manage.resume') : t('manage.stop')}
          </button>
          <div className="pool-actions-danger">
            <button disabled={busy} onClick={() => choose(onDelete)}>
              {t('manage.delete')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
