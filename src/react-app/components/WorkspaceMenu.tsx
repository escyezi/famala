import { useEffect, useId, useRef, useState } from 'react';
import type { Session } from '../../shared/contracts.ts';
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
        aria-label="我的发码空间"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <span className="workspace-menu-label-prefix">我的发码</span>空间
        </span>
        <span className="workspace-menu-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="workspace-menu-panel" id={panelId}>
          <strong>我的发码空间</strong>
          <p className="workspace-menu-id">
            空间编号{' '}
            <code>{session ? session.spaceId.slice(0, 8).toUpperCase() : '正在连接…'}</code>
          </p>
          <div className="workspace-menu-note">
            <Icon name="key" size={16} />
            <p>
              记得保管好发码 Key<small>登录态有效期为 7 天</small>
            </p>
          </div>
          <button className="workspace-menu-logout" onClick={onLogout} disabled={busy}>
            <Icon name="logout" size={17} />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
