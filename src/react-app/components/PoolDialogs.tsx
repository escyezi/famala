import { useFormat } from '../i18n/format.ts';
import { useTranslation, Trans } from 'react-i18next';
import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useState } from 'react';
import { api, ApiError, rpc } from '../api.ts';
import { parseImport } from '../../shared/contracts.ts';
import type { CodeRow, DeleteCodesResult, ImportResult, Pool } from '../../shared/api-types.ts';
import { Dialog, Icon, Notice } from './ui.tsx';

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
  const [error, setError] = useState<Message | null>(null);
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(rpc.api.manage.pools[':id'].$delete({ param: { id: String(pool.id) } }));
      onDeleted();
    } catch (e) {
      // A retry after a lost response, or deletion in another tab, is already complete.
      if (e instanceof ApiError && e.status === 404) onDeleted();
      else setError(toMessage(e));
    } finally {
      setBusy(false);
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
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  async function remove() {
    if (busy || claimed) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        rpc.api.manage.pools[':id'].codes[':codeId'].$delete({
          param: { id: String(pool.id), codeId: String(code.id) },
        }),
      );
      onDeleted();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CODE_NOT_FOUND') onDeleted();
      else {
        setError(toMessage(e));
        if (e instanceof ApiError && e.code === 'CODE_ALREADY_CLAIMED') {
          setClaimed(true);
          onRefresh();
        }
      }
    } finally {
      setBusy(false);
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
        <button className="button danger" disabled={busy || claimed} onClick={() => void remove()}>
          {busy ? t('manage.deleting') : t('manage.confirmDelete')}
        </button>
      </div>
    </Dialog>
  );
}

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
  const [error, setError] = useState<Message | null>(null);
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onDeleted(
        await api(
          rpc.api.manage.pools[':id'].codes.$delete({
            param: { id: String(pool.id) },
            json: { ids: codes.map((code) => code.id) },
          }),
        ),
      );
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
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

export function ImportDialog({
  pool,
  onClose,
  onImported,
}: {
  pool: Pick<Pool, 'id' | 'name'>;
  onClose: () => void;
  onImported: () => void;
}) {
  const { number, message } = useFormat();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const count = text.split(/\r\n|\n|\r/).filter((line) => line.trim()).length;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setResult(null);
    try {
      parseImport(text);
    } catch (e) {
      setError(toMessage(e));
      return;
    }
    setBusy(true);
    try {
      setResult(
        await api(
          rpc.api.manage.pools[':id'].import.$post({
            param: { id: String(pool.id) },
            json: { text },
          }),
        ),
      );
      onImported();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={t('manage.import')} onClose={onClose} locked={busy} wide>
      <p className="muted">
        <Trans
          i18nKey="manage.importHelp"
          values={{ name: pool.name }}
          components={{ strong: <strong /> }}
        />
      </p>
      <Notice>{error}</Notice>
      <form onSubmit={submit}>
        <label htmlFor="codes-input">
          {t('manage.codeInput')}
          <span className={count > 500 ? 'field-error' : 'muted'}>
            {t('manage.importLimit', { count })}
          </span>
        </label>
        <textarea
          id="codes-input"
          className="code-input"
          placeholder={'WELCOME-2026-001\nWELCOME-2026-002\nWELCOME-2026-003'}
          rows={9}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          disabled={busy}
        />
        <p className="field-help">{t('manage.importRules')}</p>
        {result && (
          <div className="import-result">
            <Notice kind={result.failed ? 'info' : 'success'}>
              {t('manage.importResult', {
                succeeded: number(result.succeeded),
                failed: number(result.failed),
              })}
            </Notice>
            {result.failures.length > 0 && (
              <div className="table-scroll failures">
                <table>
                  <thead>
                    <tr>
                      <th>{t('manage.originalLine')}</th>
                      <th>{t('manage.code')}</th>
                      <th>{t('manage.failureReason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failures.map((row) => (
                      <tr key={row.line}>
                        <td>{t('manage.line', { line: number(row.line) })}</td>
                        <td>
                          <code>{row.code}</code>
                        </td>
                        <td>{message({ code: row.reasonCode, params: row.params })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            {t('common.close')}
          </button>
          <button
            className="button primary"
            disabled={busy || count === 0 || count > 500 || result !== null}
          >
            {busy ? t('manage.importing') : t('manage.startImport')}
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  async function save(importNext: boolean) {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const json = { name: name.trim() };
      const result = pool
        ? await api(
            rpc.api.manage.pools[':id'].name.$post({ param: { id: String(pool.id) }, json }),
          )
        : await api(rpc.api.manage.pools.$post({ json }));
      if (!pool && importNext && onImport) onImport({ id: result.id, name: json.name });
      else onSaved(result.id);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={pool ? t('manage.renameTitle') : t('manage.create')}
      onClose={onClose}
      locked={busy}
    >
      <p className="muted">{pool ? t('manage.renameHelp') : t('manage.createHelp')}</p>
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
          autoFocus
          placeholder={t('manage.nameExample')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={busy}
        />
        <p className="field-help">{t('manage.nameHelp')}</p>
        <div className={`dialog-actions${!pool && onImport ? ' create-pool-actions' : ''}`}>
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          {!pool && onImport && (
            <button
              type="button"
              className="button secondary"
              disabled={busy || !name.trim()}
              onClick={() => void save(false)}
            >
              {t('manage.importLater')}
            </button>
          )}
          <button
            className="button primary"
            disabled={busy || !name.trim() || name.trim() === pool?.name}
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
