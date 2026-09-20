import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodeRow, Pool } from '../../../shared/api-types.ts';
import type { Message } from '../../../shared/messages.ts';
import { toMessage } from '../../../shared/messages.ts';
import { api, ApiError, rpc } from '../../api.ts';
import { useDialogRequest } from '../../hooks/useDialogRequest.ts';
import { Dialog, Notice } from '../ui.tsx';

export function DeleteCodeDialog({
  pool,
  code,
  onClose,
  onDeleted,
  onRefresh,
}: {
  pool: Pool;
  code: CodeRow;
  onClose: () => void;
  onDeleted: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const startRequest = useDialogRequest();
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  async function remove() {
    if (busy || unavailable) return;
    const request = startRequest();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        rpc.api.manage.pools[':id'].codes[':codeId'].$delete(
          {
            param: { id: String(pool.id), codeId: String(code.id) },
          },
          request,
        ),
      );
      if (!request.isCurrent()) return;
      onDeleted();
    } catch (e) {
      if (!request.isCurrent()) return;
      if (e instanceof ApiError && e.code === 'CODE_NOT_FOUND') onDeleted();
      else {
        setError(toMessage(e));
        if (e instanceof ApiError && e.code === 'CODE_NOT_AVAILABLE') {
          setUnavailable(true);
          onRefresh();
        }
      }
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  }
  return (
    <Dialog title={t('manage.deleteCode')} onClose={onClose} locked={busy}>
      <p className="muted">{t('manage.deleteCodeConfirm')}</p>
      <p className="delete-code-value">
        <code>{code.code}</code>
      </p>
      <p className="field-help">{t('manage.deleteCodeNote')}</p>
      <Notice>{error}</Notice>
      <div className="dialog-actions">
        <button className="button secondary" autoFocus disabled={busy} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          className="button danger"
          disabled={busy || unavailable}
          onClick={() => void remove()}
        >
          {busy ? t('manage.deleting') : t('manage.confirmDelete')}
        </button>
      </div>
    </Dialog>
  );
}
