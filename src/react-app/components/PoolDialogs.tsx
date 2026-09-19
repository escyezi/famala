import { useFormat } from '../i18n/format.ts';
import { useTranslation, Trans } from 'react-i18next';
import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, rpc } from '../api.ts';
import {
  parseImport,
  codePointLength,
  MAX_POOLS_PER_SPACE,
  MAX_CODES_PER_POOL,
  MAX_POOL_NAME_LENGTH,
  MAX_POOL_DESCRIPTION_LENGTH,
} from '../../shared/contracts.ts';
import type {
  CodeRow,
  DeleteCodesResult,
  ImportResult,
  RedeemedImportResult,
  Pool,
} from '../../shared/api-types.ts';
import { Dialog, Icon, Notice } from './ui.tsx';

// Dialog writes can outlive browser navigation. Give each effect setup its own
// cancellation scope so late responses cannot publish results or expire a new session.
function useDialogRequest() {
  const lifetime = useRef<{ active: boolean; request: AbortController | null } | null>(null);
  useEffect(() => {
    const scope = { active: true, request: null as AbortController | null };
    lifetime.current = scope;
    return () => {
      scope.active = false;
      scope.request?.abort();
    };
  }, []);
  return () => {
    const scope = lifetime.current;
    if (!scope?.active || scope.request) return null;
    const controller = new AbortController();
    scope.request = controller;
    return {
      init: { signal: controller.signal },
      isCurrent: () => scope.active && lifetime.current === scope && !controller.signal.aborted,
      finish: () => {
        if (scope.request === controller) scope.request = null;
      },
    };
  };
}

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

export function ImportDialog({
  pool,
  onClose,
  onImported,
  mode = 'codes',
}: {
  pool: Pick<Pool, 'id' | 'name'>;
  onClose: () => void;
  onImported: () => void;
  mode?: 'codes' | 'redeemed';
}) {
  const { number, message } = useFormat();
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const startRequest = useDialogRequest();
  const [error, setError] = useState<Message | null>(null);
  const [result, setResult] = useState<ImportResult | RedeemedImportResult | null>(null);
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
    const request = startRequest();
    if (!request) return;
    setBusy(true);
    try {
      const input = { param: { id: String(pool.id) }, json: { text } };
      const result =
        mode === 'redeemed'
          ? await api(rpc.api.manage.pools[':id'].redeemed.import.$post(input, request))
          : await api(rpc.api.manage.pools[':id'].import.$post(input, request));
      if (!request.isCurrent()) return;
      setResult(result);
      onImported();
    } catch (e) {
      if (request.isCurrent()) setError(toMessage(e));
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  }
  return (
    <Dialog
      title={t(mode === 'redeemed' ? 'manage.importRedeemed' : 'manage.import')}
      onClose={onClose}
      locked={busy}
      wide
    >
      <p className="muted">
        <Trans
          i18nKey={mode === 'redeemed' ? 'manage.importRedeemedHelp' : 'manage.importHelp'}
          values={{ name: pool.name, limit: MAX_CODES_PER_POOL }}
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
              {'marked' in result
                ? t('manage.redeemedImportResult', {
                    marked: number(result.marked),
                    already: number(result.alreadyRedeemed),
                    removed: number(result.removedFromAvailable),
                    failed: number(result.failed),
                  })
                : t('manage.importResult', {
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
            {busy
              ? t('manage.importing')
              : t(mode === 'redeemed' ? 'manage.startRedeemedImport' : 'manage.startImport')}
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
