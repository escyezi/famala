import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { ImportResult, Pool, RedeemedImportResult } from '../../../shared/api-types.ts';
import {
  MAX_CODE_LENGTH,
  MAX_CODES_PER_POOL,
  MAX_IMPORT_CODES,
  parseImport,
} from '../../../shared/contracts.ts';
import type { Message } from '../../../shared/messages.ts';
import { toMessage } from '../../../shared/messages.ts';
import { api, ApiError, rpc } from '../../api.ts';
import { useDialogRequest } from '../../hooks/useDialogRequest.ts';
import { useFormat } from '../../i18n/format.ts';
import { Dialog, Icon, Notice } from '../ui.tsx';

export function ImportDialog({
  pool,
  onClose,
  onImported,
  onPartialFailure,
  mode = 'codes',
}: {
  pool: Pick<Pool, 'id' | 'name'>;
  onClose: () => void;
  onImported: () => void;
  onPartialFailure?: () => void;
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
      if (!request.isCurrent()) return;
      setError(toMessage(e));
      // Earlier import batches may have committed before a server failure.
      // Network errors and invalid responses do not establish an HTTP 5xx.
      if (
        mode === 'codes' &&
        e instanceof ApiError &&
        e.status >= 500 &&
        e.status < 600 &&
        e.code !== 'INVALID_RESPONSE'
      )
        onPartialFailure?.();
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
          <span className={count > MAX_IMPORT_CODES ? 'field-error' : 'muted'}>
            {t('manage.importLimit', { count, limit: MAX_IMPORT_CODES })}
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
        <p className="field-help">{t('manage.importRules', { limit: MAX_CODE_LENGTH })}</p>
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
            disabled={busy || count === 0 || count > MAX_IMPORT_CODES || result !== null}
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
