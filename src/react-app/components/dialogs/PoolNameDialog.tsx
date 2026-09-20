import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Pool } from '../../../shared/api-types.ts';
import {
  codePointLength,
  MAX_POOL_DESCRIPTION_LENGTH,
  MAX_POOL_NAME_LENGTH,
  MAX_POOLS_PER_SPACE,
} from '../../../shared/contracts.ts';
import type { Message } from '../../../shared/messages.ts';
import { toMessage } from '../../../shared/messages.ts';
import { api, rpc } from '../../api.ts';
import { useDialogRequest } from '../../hooks/useDialogRequest.ts';
import { Dialog, Icon, Notice } from '../ui.tsx';

export function PoolNameDialog({
  pool,
  onClose,
  onSaved,
  onImport,
}: {
  pool?: Pool;
  onClose: () => void;
  onSaved: (id: number) => void;
  onImport?: (pool: Pick<Pool, 'id' | 'name'>) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(pool?.name ?? '');
  const [description, setDescription] = useState(pool?.description ?? '');
  const nameLength = codePointLength(name.trim());
  const descriptionLength = codePointLength(description.trim());
  const nameTooLong = nameLength > MAX_POOL_NAME_LENGTH;
  const descriptionTooLong = descriptionLength > MAX_POOL_DESCRIPTION_LENGTH;
  const invalid = !nameLength || nameTooLong || descriptionTooLong;
  const [busy, setBusy] = useState(false);
  const startRequest = useDialogRequest();
  const [error, setError] = useState<Message | null>(null);
  async function save(importNext: boolean) {
    if (busy || invalid) return;
    const request = startRequest();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const json = { name: name.trim(), description: description.trim() || null };
      const result = pool
        ? await api(
            rpc.api.manage.pools[':id'].name.$post(
              { param: { id: String(pool.id) }, json },
              request,
            ),
          )
        : await api(rpc.api.manage.pools.$post({ json }, request));
      if (!request.isCurrent()) return;
      if (!pool && importNext && onImport) onImport({ id: result.id, name: json.name });
      else onSaved(result.id);
    } catch (e) {
      if (request.isCurrent()) setError(toMessage(e));
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  }
  return (
    <Dialog
      title={pool ? t('manage.renameTitle') : t('manage.create')}
      onClose={onClose}
      locked={busy}
    >
      <p className="muted">
        {pool ? t('manage.renameHelp') : t('manage.createHelp', { limit: MAX_POOLS_PER_SPACE })}
      </p>
      <Notice>{error}</Notice>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
      >
        <label htmlFor="pool-name">{t('manage.name')}</label>
        <input
          id="pool-name"
          aria-invalid={nameTooLong || undefined}
          aria-describedby="pool-name-help"
          autoFocus
          placeholder={t('manage.nameExample')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={busy}
        />
        <p id="pool-name-help" className="field-help">
          {t('manage.nameHelp')}{' '}
          {t('manage.poolTextLength', { count: nameLength, limit: MAX_POOL_NAME_LENGTH })}
        </p>
        {nameTooLong && (
          <Notice>{{ code: 'POOL_NAME_TOO_LONG', params: { limit: MAX_POOL_NAME_LENGTH } }}</Notice>
        )}
        <label htmlFor="pool-description">{t('manage.description')}</label>
        <textarea
          id="pool-description"
          aria-invalid={descriptionTooLong || undefined}
          rows={4}
          placeholder={t('manage.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          aria-describedby="pool-description-help"
        />
        <p id="pool-description-help" className="field-help">
          {t('manage.descriptionHelp')}{' '}
          {t('manage.poolTextLength', {
            count: descriptionLength,
            limit: MAX_POOL_DESCRIPTION_LENGTH,
          })}
        </p>
        {descriptionTooLong && (
          <Notice>
            {{ code: 'POOL_DESCRIPTION_TOO_LONG', params: { limit: MAX_POOL_DESCRIPTION_LENGTH } }}
          </Notice>
        )}
        <div className={`dialog-actions${!pool && onImport ? ' create-pool-actions' : ''}`}>
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          {!pool && onImport && (
            <button
              type="button"
              className="button secondary"
              disabled={busy || invalid}
              onClick={() => void save(false)}
            >
              {t('manage.importLater')}
            </button>
          )}
          <button
            className="button primary"
            disabled={
              busy ||
              invalid ||
              (name.trim() === pool?.name && description.trim() === (pool?.description ?? ''))
            }
          >
            {busy
              ? t('manage.saving')
              : pool
                ? t('manage.saveName')
                : onImport
                  ? t('manage.createImport')
                  : t('manage.createEmpty')}
            <Icon name={pool ? 'check' : onImport ? 'arrow' : 'plus'} size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
