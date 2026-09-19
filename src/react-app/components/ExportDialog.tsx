import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodeFilter } from '../../shared/api-types.ts';
import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { resources } from '../i18n/index.ts';
import type { ExportProgress, ExportResult } from '../export/types.ts';
import { Dialog, Notice } from './ui.tsx';

export function ExportDialog({
  poolId,
  initialStatus = 'all',
  onClose,
}: {
  poolId?: number;
  initialStatus?: CodeFilter;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<CodeFilter>(initialStatus);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<Message | null>(null);
  const [result, setResult] = useState<(ExportResult & { url: string }) | null>(null);
  const operation = useRef<AbortController | null>(null);
  const downloadUrl = useRef<string | null>(null);
  const busy = !!progress && progress.stage !== 'done' && !error;
  function release() {
    operation.current?.abort();
    operation.current = null;
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
  }
  useEffect(
    () => () => {
      release();
    },
    [],
  );
  function close() {
    release();
    onClose();
  }
  async function start() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setError(null);
    setResult(null);
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
    setProgress({ stage: 'reading', completed: 0, total: 0, rows: 0 });
    // Capture language once; changing the UI language must not mix file headers.
    const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'zh-CN';
    const labels = { ...resources[locale].translation.exports };
    try {
      const { runExport } = await import('../export/run-export.ts');
      if (controller.signal.aborted) return;
      const file = await runExport({
        poolId,
        status,
        labels,
        signal: controller.signal,
        onProgress: (value) => {
          if (!controller.signal.aborted) setProgress(value);
        },
      });
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(file.blob);
      downloadUrl.current = url;
      setResult({ ...file, url });
    } catch (error) {
      if (!controller.signal.aborted) setError(toMessage(error));
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }
  return (
    <Dialog
      title={t(poolId === undefined ? 'exports.allPools' : 'exports.singlePool')}
      onClose={close}
    >
      <p className="muted">{t(poolId === undefined ? 'exports.scopeAll' : 'exports.scopePool')}</p>
      <div className="export-fields">
        <label>
          {t('exports.filter')}
          <select
            value={status}
            disabled={busy || !!result}
            onChange={(e) => setStatus(e.target.value as CodeFilter)}
          >
            {(['all', 'unclaimed', 'claimed', 'redeemed'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`exports.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="field-help">{t('exports.consistency')}</p>
      {poolId === undefined && <p className="field-help">{t('exports.zipHelp')}</p>}
      <p className="field-help">{t('exports.csvHelp')}</p>
      {progress && !error && (
        <div className="export-progress" role="status" aria-live="polite">
          <strong>{t(`exports.${progress.stage}`)}</strong>
          <p>{t('exports.progress', progress)}</p>
        </div>
      )}
      <Notice>{error}</Notice>
      <div className="dialog-actions">
        <button className="button secondary" onClick={close}>
          {t(busy ? 'common.cancel' : 'common.close')}
        </button>
        {result ? (
          <a className="button primary" href={result.url} download={result.filename}>
            {t('exports.download')}
          </a>
        ) : (
          <button className="button primary" disabled={busy} onClick={() => void start()}>
            {t(error ? 'common.retry' : 'exports.start')}
          </button>
        )}
      </div>
    </Dialog>
  );
}
