import { useFormat } from '../i18n/format.ts';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../shared/messages.ts';
import { useId, useState } from 'react';
import type { CodeRow, DeleteCodesResult, Pool } from '../../shared/api-types.ts';
import { usePoolDetails } from '../hooks/usePoolDetails.ts';
import { CopyButton, Icon, Notice } from './ui.tsx';
import {
  DeleteCodeDialog,
  DeleteCodesDialog,
  DeletePoolDialog,
  ImportDialog,
  PoolNameDialog,
} from './PoolDialogs.tsx';
import { PoolRecords } from './PoolRecords.tsx';
import { PoolActionsMenu } from './PoolActionsMenu.tsx';
import { ExportDialog } from './ExportDialog.tsx';

// Manager keys this component by pool ID: drafts, filters and pages belong to one pool.
export function PoolDetail({
  pool,
  error: poolsError,
  onRefresh,
  onNavigate,
  onDeleted,
}: {
  pool: Pool;
  error: Message | null;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  onDeleted: () => void;
}) {
  const { dateTime, number } = useFormat();
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<'rename' | 'import' | 'redeemed' | 'delete' | null>(null);
  const [deletingCode, setDeletingCode] = useState<CodeRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deletingCodes, setDeletingCodes] = useState<CodeRow[] | null>(null);
  const [bulkResult, setBulkResult] = useState<DeleteCodesResult | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const keyPanelId = useId();
  const details = usePoolDetails(pool, onRefresh);
  const { codes, imported, status, controlsLocked, error } = details;
  const total = codes?.counts.all ?? pool.total;
  const remaining = codes?.counts.unclaimed ?? pool.remaining;
  const claimed = codes ? codes.summary.claimed : pool.claimed;
  const redeemed = codes?.summary.redeemed ?? pool.redeemed;
  const stat = (value: number) => (details.invalidated && !details.pending ? '—' : number(value));
  return (
    <div className="pool-detail-page">
      <header className="pool-page-header">
        <a
          className="text-button pool-back"
          href="/manage"
          aria-label={t('manage.backToPools')}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onNavigate('/manage');
          }}
        >
          <Icon name="arrow" size={16} />
          {t('common.back')}
        </a>
        <div className="pool-page-title">
          <div className="pool-title-line">
            <h1>{pool.name}</h1>
            <span
              className={`status ${pool.status === 'stopped' ? 'stopped' : total === 0 ? '' : remaining > 0 ? 'active' : 'exhausted'}`}
            >
              {pool.status === 'stopped'
                ? t('manage.stopped')
                : total === 0
                  ? t('manage.pending')
                  : remaining > 0
                    ? t('manage.active')
                    : t('manage.empty')}
            </span>
          </div>
        </div>
        <div className="pool-overview-tools">
          <div className="actions">
            <button
              className="button primary small pool-main-action"
              disabled={controlsLocked}
              onClick={() => setDialog('import')}
            >
              <Icon name="plus" size={16} />
              {t('manage.import')}
            </button>
            <CopyButton
              value={`${location.origin}/claim?key=${encodeURIComponent(pool.claimKey)}`}
              label={t('manage.copyLink')}
              className="button secondary small pool-main-action"
            />
            <PoolActionsMenu
              stopped={pool.status === 'stopped'}
              busy={controlsLocked}
              keyVisible={keyVisible}
              keyPanelId={keyPanelId}
              onToggleKey={() => setKeyVisible((visible) => !visible)}
              onImportRedeemed={() => setDialog('redeemed')}
              onRename={() => setDialog('rename')}
              onStatus={() => void status()}
              onDelete={() => setDialog('delete')}
            />
          </div>
        </div>
      </header>
      <Notice>{error || poolsError}</Notice>
      <section className="pool-detail pool-overview" aria-label={t('manage.statistics')}>
        <div className="pool-overview-main">
          <dl className="pool-stats">
            <div className="remaining-stat">
              <dt>{t('manage.remaining')}</dt>
              <dd>{stat(remaining)}</dd>
            </div>
            <div>
              <dt>{t('manage.claimedCumulative')}</dt>
              <dd>{stat(claimed)}</dd>
            </div>
            <div>
              <dt>{t('manage.redeemedTotal')}</dt>
              <dd>{stat(redeemed)}</dd>
            </div>
            <div>
              <dt>{t('manage.total')}</dt>
              <dd>{stat(total)}</dd>
            </div>
          </dl>
          <p className="muted pool-created">
            {t('common.createdAt', { date: dateTime(pool.createdAt) })}
          </p>
        </div>
        <p className="pool-stats-note">{t('manage.claimedSummaryHelp')}</p>
        <div id={keyPanelId} hidden={!keyVisible}>
          <div className="share-key">
            <code>{pool.claimKey}</code>
            <CopyButton
              value={pool.claimKey}
              label={t('common.copyKey')}
              className="text-button compact"
            />
          </div>
        </div>
      </section>
      {pool.status === 'stopped' && <Notice kind="info">{t('manage.stoppedNote')}</Notice>}
      <PoolRecords
        onExport={() => setExporting(true)}
        details={details}
        bulkResult={bulkResult}
        onClearResult={() => setBulkResult(null)}
        onDelete={setDeletingCode}
        onDeleteMany={setDeletingCodes}
      />

      {exporting && (
        <ExportDialog
          poolId={pool.id}
          initialStatus={details.filter}
          onClose={() => setExporting(false)}
        />
      )}
      {deletingCodes && (
        <DeleteCodesDialog
          pool={pool}
          codes={deletingCodes}
          onClose={() => setDeletingCodes(null)}
          onDeleted={(result) => {
            if (!details.isActive()) return;
            setDeletingCodes(null);
            setBulkResult(result);
            details.refreshAfterMutation();
          }}
        />
      )}
      {deletingCode && (
        <DeleteCodeDialog
          pool={pool}
          code={deletingCode}
          onClose={() => setDeletingCode(null)}
          onRefresh={details.refreshAfterMutation}
          onDeleted={() => {
            if (!details.isActive()) return;
            setDeletingCode(null);
            details.refreshAfterMutation();
          }}
        />
      )}
      {dialog === 'rename' && (
        <PoolNameDialog
          pool={pool}
          onClose={() => setDialog(null)}
          onSaved={() => {
            if (!details.isActive()) return;
            setDialog(null);
            details.refreshAfterMutation();
          }}
        />
      )}
      {dialog === 'import' && (
        <ImportDialog pool={pool} onClose={() => setDialog(null)} onImported={imported} />
      )}
      {dialog === 'redeemed' && (
        <ImportDialog
          pool={pool}
          mode="redeemed"
          onClose={() => setDialog(null)}
          onImported={() => {
            if (details.isActive()) {
              setBulkResult(null);
              details.refreshAfterMutation();
            }
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeletePoolDialog
          pool={pool}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            if (details.isActive()) onDeleted();
          }}
        />
      )}
    </div>
  );
}
