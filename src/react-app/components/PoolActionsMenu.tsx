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
        更多
      </button>
      {open && (
        <div className="pool-actions-panel" id={panelId} role="group" aria-label="码池操作">
          <button disabled={busy} onClick={() => choose(onRename)}>
            修改名称
          </button>
          <button disabled={busy} onClick={() => choose(onStatus)}>
            {stopped ? '恢复发放' : '停止发放'}
          </button>
          <div className="pool-actions-danger">
            <button disabled={busy} onClick={() => choose(onDelete)}>
              删除码池
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
