import { useFormat } from '../i18n/format.ts';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../shared/messages.ts';
import { useId, useState } from 'react';
import type { CodePage, CodeRow, DeleteCodesResult, Pool } from '../../shared/api-types.ts';
import { usePoolDetails } from '../hooks/usePoolDetails.ts';
import { CopyButton, Icon, Notice } from './ui.tsx';
import {
  DeleteCodeDialog,
  DeleteCodesDialog,
  DeletePoolDialog,
  ImportDialog,
  PoolNameDialog,
} from './PoolDialogs.tsx';
import { PoolActionsMenu } from './PoolActionsMenu.tsx';

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
  const [dialog, setDialog] = useState<'rename' | 'import' | 'delete' | null>(null);
  const [deletingCode, setDeletingCode] = useState<CodeRow | null>(null);
  const [selection, setSelection] = useState<{ page: CodePage; ids: number[] } | null>(null);
  const [deletingCodes, setDeletingCodes] = useState<CodeRow[] | null>(null);
  const [bulkResult, setBulkResult] = useState<DeleteCodesResult | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const keyPanelId = useId();
  const {
    codes,
    codesError,
    page,
    pageSize,
    filter,
    changePage,
    changeFilter,
    changePageSize,
    refresh,
    imported,
    status,
    busy,
    error,
  } = usePoolDetails(pool, onRefresh);
  // Selections belong to one loaded page; a refresh, page size change or tab switch clears them.
  const selectedIds =
    codes && selection?.page === codes && filter === 'unclaimed' ? selection.ids : [];
  const selectableCodes = codes?.items.filter((row) => row.claimStatus === 'unclaimed') ?? [];
  const allSelected = selectableCodes.length > 0 && selectedIds.length === selectableCodes.length;
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
              className={`status ${pool.status === 'stopped' ? 'stopped' : pool.total === 0 ? '' : pool.remaining > 0 ? 'active' : 'exhausted'}`}
            >
              {pool.status === 'stopped'
                ? t('manage.stopped')
                : pool.total === 0
                  ? t('manage.pending')
                  : pool.remaining > 0
                    ? t('manage.active')
                    : t('manage.empty')}
            </span>
          </div>
          <p className="muted">{t('common.createdAt', { date: dateTime(pool.createdAt) })}</p>
        </div>
        <button
          type="button"
          className="text-button refresh-button pool-refresh"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          onClick={refresh}
        >
          <Icon name="refresh" size={18} />
        </button>
      </header>
      <Notice>{error || poolsError}</Notice>
      <section className="pool-detail pool-overview" aria-label={t('manage.statistics')}>
        <div className="pool-overview-main">
          <dl className="pool-stats">
            <div className="remaining-stat">
              <dt>{t('manage.remaining')}</dt>
              <dd>{number(pool.remaining)}</dd>
            </div>
            <div>
              <dt>{t('common.claimed')}</dt>
              <dd>{number(pool.claimed)}</dd>
            </div>
            <div>
              <dt>{t('manage.total')}</dt>
              <dd>{number(pool.total)}</dd>
            </div>
          </dl>
          <div className="pool-overview-tools">
            <div className="actions">
              <button
                className="button primary small pool-main-action"
                disabled={busy}
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
              <button
                type="button"
                className="button secondary small pool-key-toggle"
                aria-label={t('manage.viewKey')}
                title={t('manage.viewKey')}
                aria-expanded={keyVisible}
                aria-controls={keyPanelId}
                onClick={() => setKeyVisible((visible) => !visible)}
              >
                <Icon name="key" size={16} />
              </button>
              <PoolActionsMenu
                stopped={pool.status === 'stopped'}
                busy={busy}
                onRename={() => setDialog('rename')}
                onStatus={() => void status()}
                onDelete={() => setDialog('delete')}
              />
            </div>
          </div>
        </div>
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
      <section className="pool-detail pool-records" aria-labelledby="pool-records-title">
        <div className="table-toolbar">
          <div className="records-heading">
            <h2 id="pool-records-title">{t('manage.records')}</h2>
            <span className="muted records-count">
              {codes ? t('manage.recordCount', { count: codes.total }) : '—'}
            </span>
          </div>
          <div className="tabs">
            {(
              [
                ['all', t('manage.all')],
                ['unclaimed', t('common.unclaimed')],
                ['unused', t('manage.unused')],
                ['used', t('manage.used')],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                aria-pressed={filter === value}
                onClick={() => {
                  if (filter === value) return;
                  setBulkResult(null);
                  changeFilter(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="table-pagination">
            <label className="page-size-control">
              {t('manage.perPage')}
              <select
                aria-label={t('manage.pageSize')}
                value={pageSize}
                onChange={(event) => changePageSize(event.target.value === '50' ? '50' : '20')}
              >
                <option value="20">{t('manage.pageRows', { count: 20 })}</option>
                <option value="50">{t('manage.pageRows', { count: 50 })}</option>
              </select>
            </label>
            <div className="actions">
              <button
                className="button secondary small"
                disabled={!codes || page === 1}
                onClick={() => changePage(page - 1)}
              >
                {t('manage.previous')}
              </button>
              <span aria-live="polite">
                {number(page)} /{' '}
                {codes ? number(Math.max(1, Math.ceil(codes.total / codes.pageSize))) : '—'}
              </span>
              <button
                className="button secondary small"
                disabled={!codes || page * codes.pageSize >= codes.total}
                onClick={() => changePage(page + 1)}
              >
                {t('manage.next')}
              </button>
            </div>
          </div>
        </div>
        {filter === 'unclaimed' && (
          <div className="bulk-code-toolbar">
            <span className="muted" aria-live="polite">
              {t('manage.selectedCount', { count: selectedIds.length })}
            </span>
            <button
              type="button"
              className="button secondary small bulk-delete-button"
              disabled={!selectedIds.length}
              onClick={() => {
                setBulkResult(null);
                setDeletingCodes(selectableCodes.filter((row) => selectedIds.includes(row.id)));
              }}
            >
              <Icon name="trash" size={15} />
              {t('manage.bulkDelete')}
            </button>
          </div>
        )}
        {bulkResult && (
          <Notice kind={bulkResult.skipped ? 'info' : 'success'}>
            {bulkResult.skipped
              ? t('manage.bulkDeleteSkipped', bulkResult)
              : t('manage.bulkDeleted', { count: bulkResult.deleted })}
          </Notice>
        )}
        <Notice>{codesError}</Notice>
        <div
          className="table-scroll pool-codes-scroll"
          key={`${page}-${pageSize}-${filter}`}
          role="region"
          aria-label={t('manage.table')}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {filter === 'unclaimed' && (
                  <th className="code-select-cell">
                    <input
                      type="checkbox"
                      aria-label={t('manage.selectPage')}
                      checked={allSelected}
                      disabled={!selectableCodes.length}
                      ref={(node) => {
                        if (node) node.indeterminate = selectedIds.length > 0 && !allSelected;
                      }}
                      onChange={() => {
                        if (codes)
                          setSelection({
                            page: codes,
                            ids: allSelected ? [] : selectableCodes.map((row) => row.id),
                          });
                      }}
                    />
                  </th>
                )}
                <th>{t('manage.code')}</th>
                <th>{t('manage.codeStatus')}</th>
                <th>{t('manage.claimedAt')}</th>
                <th>{t('manage.remark')}</th>
                <th>{t('manage.usedAt')}</th>
                <th className="code-actions-cell">{t('manage.codeActions')}</th>
              </tr>
            </thead>
            <tbody>
              {codes?.items.map((row) => (
                <tr
                  key={row.id}
                  className={selectedIds.includes(row.id) ? 'code-selected' : undefined}
                >
                  {filter === 'unclaimed' && (
                    <td className="code-select-cell">
                      <input
                        type="checkbox"
                        aria-label={t('manage.selectCode', { code: row.code })}
                        disabled={row.claimStatus !== 'unclaimed'}
                        checked={selectedIds.includes(row.id)}
                        onChange={() => {
                          if (codes)
                            setSelection({
                              page: codes,
                              ids: selectedIds.includes(row.id)
                                ? selectedIds.filter((id) => id !== row.id)
                                : [...selectedIds, row.id],
                            });
                        }}
                      />
                    </td>
                  )}
                  <td className="code-cell">
                    <div className="code-inline">
                      <code>{row.code}</code>
                      <CopyButton
                        value={row.code}
                        label={t('common.copy')}
                        className="text-button compact"
                      />
                    </div>
                  </td>
                  <td>
                    <span
                      className={`status ${row.claimStatus === 'unclaimed' ? 'unclaimed' : row.userMarkedUsed ? 'used' : 'unused'}`}
                    >
                      {row.claimStatus === 'unclaimed'
                        ? t('common.unclaimed')
                        : row.userMarkedUsed
                          ? t('manage.used')
                          : t('manage.unused')}
                    </span>
                  </td>
                  <td className="date-cell">{dateTime(row.claimedAt)}</td>
                  <td className="remark-cell">{row.remark ?? '—'}</td>
                  <td className="date-cell">{dateTime(row.userMarkedUsedAt)}</td>
                  <td className="code-actions-cell">
                    {row.claimStatus === 'unclaimed' ? (
                      <button
                        type="button"
                        className="code-delete-button"
                        aria-label={t('manage.deleteCode')}
                        title={t('manage.deleteCode')}
                        onClick={() => setDeletingCode(row)}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(!codes || !codes.items.length) && (
            <div className="table-empty">
              {codes
                ? t('manage.noRecords')
                : codesError
                  ? t('manage.recordsFailed')
                  : t('common.loading')}
            </div>
          )}
        </div>
        <p className="field-help records-note">{t('manage.usageNote')}</p>
      </section>

      {deletingCodes && (
        <DeleteCodesDialog
          pool={pool}
          codes={deletingCodes}
          onClose={() => setDeletingCodes(null)}
          onDeleted={(result) => {
            setDeletingCodes(null);
            setSelection(null);
            setBulkResult(result);
            refresh();
          }}
        />
      )}
      {deletingCode && (
        <DeleteCodeDialog
          pool={pool}
          code={deletingCode}
          onClose={() => setDeletingCode(null)}
          onRefresh={refresh}
          onDeleted={() => {
            setDeletingCode(null);
            refresh();
          }}
        />
      )}
      {dialog === 'rename' && (
        <PoolNameDialog
          pool={pool}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog === 'import' && (
        <ImportDialog pool={pool} onClose={() => setDialog(null)} onImported={imported} />
      )}
      {dialog === 'delete' && (
        <DeletePoolDialog pool={pool} onClose={() => setDialog(null)} onDeleted={onDeleted} />
      )}
    </div>
  );
}
