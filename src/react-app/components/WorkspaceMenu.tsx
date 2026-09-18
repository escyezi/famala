import { useTranslation, Trans } from 'react-i18next';
import { useEffect, useId, useRef, useState } from 'react';
import type { Session } from '../../shared/api-types.ts';
import { Icon } from './ui.tsx';

export function WorkspaceMenu({
  session,
  busy,
  onLogout,
}: {
  session: Session | null;
  busy: boolean;
  onLogout: () => void;
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

  return (
    <div
      className="workspace-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="workspace-menu-trigger"
        ref={trigger}
        aria-label={t('auth.workspace')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{t('auth.workspaceShort')}</span>
        <span className="workspace-menu-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="workspace-menu-panel" id={panelId}>
          <strong>{t('auth.workspace')}</strong>
          <p className="workspace-menu-id">
            <Trans
              i18nKey="auth.workspaceId"
              values={{ id: session ? session.spaceId : t('common.connecting') }}
              components={{ id: <code /> }}
            />
          </p>
          <div className="workspace-menu-note">
            <Icon name="key" size={16} />
            <p>
              {t('auth.rememberKey')}
              <small>{t('auth.sessionDuration')}</small>
            </p>
          </div>
          <button className="workspace-menu-logout" onClick={onLogout} disabled={busy}>
            <Icon name="logout" size={17} />
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
