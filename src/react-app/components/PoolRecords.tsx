import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodeRow, DeleteCodesResult } from '../../shared/api-types.ts';
import type { PoolDetails } from '../hooks/usePoolDetails.ts';
import { useFormat } from '../i18n/format.ts';
import { RecordsToolbar } from './RecordsToolbar.tsx';
import { RecordsTable } from './RecordsTable.tsx';
import { RecordsPagination } from './RecordsPagination.tsx';
import { Notice } from './ui.tsx';

export function PoolRecords({
  details,
  bulkResult,
  onClearResult,
  onDelete,
  onDeleteMany,
}: {
  details: PoolDetails;
  bulkResult: DeleteCodesResult | null;
  onClearResult: () => void;
  onDelete: (row: CodeRow) => void;
  onDeleteMany: (rows: CodeRow[]) => void;
}) {
  const { t } = useTranslation();
  const { message } = useFormat();
  const [selection, setSelection] = useState<{ revision: number; ids: number[] } | null>(null);
  const selectedIds =
    selection?.revision === details.selectionRevision &&
    !details.actionsDisabled &&
    details.filter === 'unclaimed'
      ? selection.ids
      : [];
  const refreshFailed =
    details.failedQuery?.filter === details.filter &&
    details.failedQuery?.page === details.page &&
    details.failedQuery?.pageSize === details.pageSize;
  return (
    <section className="pool-detail pool-records" aria-labelledby="pool-records-title">
      <RecordsToolbar
        details={details}
        selectedCount={selectedIds.length}
        onFilter={(filter) => {
          if (details.controlsLocked) return;
          onClearResult();
          details.changeFilter(filter);
        }}
        onDelete={() => {
          onClearResult();
          onDeleteMany(
            details.codes?.items.filter(
              (row) => selectedIds.includes(row.id) && row.claimStatus === 'unclaimed',
            ) ?? [],
          );
        }}
      />

      {bulkResult && (
        <Notice kind={bulkResult.skipped ? 'info' : 'success'}>
          {bulkResult.skipped
            ? t('manage.bulkDeleteSkipped', bulkResult)
            : t('manage.bulkDeleted', { count: bulkResult.deleted })}
        </Notice>
      )}
      <RecordsTable
        details={details}
        selectedIds={selectedIds}
        onSelect={(ids) => setSelection({ revision: details.selectionRevision, ids })}
        onDelete={onDelete}
      />
      <RecordsPagination details={details} />
      <div className="records-feedback" role="status" aria-live="polite">
        {details.busy ? (
          t('manage.statusUpdating')
        ) : details.pending ? (
          t('manage.recordsUpdating')
        ) : details.codesError ? (
          <>
            <span>
              {details.invalidated
                ? t('manage.recordsInvalidated')
                : refreshFailed && details.codes
                  ? t('manage.recordsRefreshFailed')
                  : t('manage.recordsSwitchFailed', {
                      filter: {
                        all: t('manage.all'),
                        unclaimed: t('common.unclaimed'),
                        unused: t('manage.unused'),
                        used: t('manage.used'),
                        claimed: t('common.claimed'),
                      }[details.failedQuery?.filter ?? details.filter],
                    })}{' '}
              {message(details.codesError)}
            </span>
            <button className="text-button" onClick={details.retry}>
              {t('manage.retryRecords')}
            </button>
          </>
        ) : (
          t('manage.usageNote')
        )}
      </div>
    </section>
  );
}
