import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodeRow, DeleteCodesResult, Pool } from '../../../shared/api-types.ts';
import type { Message } from '../../../shared/messages.ts';
import { toMessage } from '../../../shared/messages.ts';
import { api, rpc } from '../../api.ts';
import { useDialogRequest } from '../../hooks/useDialogRequest.ts';
import { Dialog, Notice } from '../ui.tsx';

export function DeleteCodesDialog({
  pool,
  codes,
  onClose,
  onDeleted,
}: {
  pool: Pool;
  codes: CodeRow[];
  onClose: () => void;
  onDeleted: (result: DeleteCodesResult) => void;
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
      const result = await api(
        rpc.api.manage.pools[':id'].codes.$delete(
          {
            param: { id: String(pool.id) },
            json: { ids: codes.map((code) => code.id) },
          },
          request,
        ),
      );
      if (!request.isCurrent()) return;
      onDeleted(result);
    } catch (e) {
      if (request.isCurrent()) setError(toMessage(e));
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  }
  return (
    <Dialog title={t('manage.bulkDelete')} onClose={onClose} locked={busy}>
      <p>{t('manage.bulkDeleteConfirm', { count: codes.length })}</p>
      <ul className="delete-codes-list">
        {codes.map((code) => (
          <li key={code.id}>
            <code>{code.code}</code>
          </li>
        ))}
      </ul>
      <p className="field-help">{t('manage.bulkDeleteNote')}</p>
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
