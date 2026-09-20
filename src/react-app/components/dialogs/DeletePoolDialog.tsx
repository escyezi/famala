import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Pool } from '../../../shared/api-types.ts';
import type { Message } from '../../../shared/messages.ts';
import { toMessage } from '../../../shared/messages.ts';
import { api, ApiError, rpc } from '../../api.ts';
import { useDialogRequest } from '../../hooks/useDialogRequest.ts';
import { Dialog, Notice } from '../ui.tsx';

export function DeletePoolDialog({
  pool,
  onClose,
  onDeleted,
}: {
  pool: Pool;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const startRequest = useDialogRequest();
  const [error, setError] = useState<Message | null>(null);
  async function remove() {
    if (busy) return;
    const request = startRequest();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await api(rpc.api.manage.pools[':id'].$delete({ param: { id: String(pool.id) } }, request));
      if (!request.isCurrent()) return;
      onDeleted();
    } catch (e) {
      if (!request.isCurrent()) return;
      // A retry after a lost response, or deletion in another tab, is already complete.
      if (e instanceof ApiError && e.status === 404) onDeleted();
      else setError(toMessage(e));
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  }
  return (
    <Dialog title={t('manage.delete')} onClose={onClose} locked={busy}>
      <p className="muted">{t('manage.deleteConfirm', { name: pool.name })}</p>
      <p className="delete-pool-note">{t('manage.deleteNote')}</p>
      <p className="field-help">{t('manage.deleteHistory')}</p>
      <Notice>{error}</Notice>
      <div className="dialog-actions">
        <button className="button secondary" autoFocus disabled={busy} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="button danger" disabled={busy} onClick={() => void remove()}>
          {busy ? t('manage.deleting') : t('manage.confirmDelete')}
        </button>
      </div>
    </Dialog>
  );
}
