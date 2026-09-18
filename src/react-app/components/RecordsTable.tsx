import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodeRow } from '../../shared/api-types.ts';
import type { PoolDetails } from '../hooks/usePoolDetails.ts';
import { useFormat } from '../i18n/format.ts';
import { CopyButton, Icon } from './ui.tsx';

export function RecordsTable({
  details,
  selectedIds,
  onSelect,
  onDelete,
}: {
  details: PoolDetails;
  selectedIds: number[];
  onSelect: (ids: number[]) => void;
  onDelete: (row: CodeRow) => void;
}) {
  const { t } = useTranslation();
  const { dateTime, compactDateTime } = useFormat();
  const { codes, filter, page, pageSize, pending, codesError, actionsDisabled } = details;
  const queryKey = `${filter}:${page}:${pageSize}`;
  const [expansion, setExpansion] = useState<{ query: string; id: number } | null>(null);
  // Reset on a committed query, including a cache hit. A same-query refresh keeps detail open.
  const [lastQuery, setLastQuery] = useState(queryKey);
  if (lastQuery !== queryKey) {
    setLastQuery(queryKey);
    setExpansion(null);
  }
  if (expansion && codes && !codes.items.some((row) => row.id === expansion.id)) setExpansion(null);
  const expanded = expansion?.query === queryKey ? expansion.id : null;
  const scroll = useRef<HTMLDivElement>(null);
  const prefix = useId();
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [queryKey]);
  const compact = filter === 'unclaimed';
  const selectable =
    codes?.items.filter((row) => row.claimStatus === 'unclaimed').map((row) => row.id) ?? [];
  const allSelected = selectable.length > 0 && selectable.every((id) => selectedIds.includes(id));
  return (
    <div
      ref={scroll}
      className="table-scroll pool-codes-scroll"
      role="region"
      aria-label={t('manage.table')}
      aria-busy={pending}
      tabIndex={0}
    >
      <table className={compact ? 'records-table unclaimed-table' : 'records-table'}>
        <colgroup>
          {compact && <col className="records-select-col" />}
          <col className="records-code-col" />
          <col className="records-status-col" />
          {!compact && (
            <>
              <col className="records-time-col" />
              <col className="records-remark-col" />
            </>
          )}
          <col className="records-detail-col" />
        </colgroup>
        <thead>
          <tr>
            {compact && (
              <th className="code-select-cell">
                <input
                  type="checkbox"
                  aria-label={t('manage.selectPage')}
                  disabled={actionsDisabled || !selectable.length}
                  checked={allSelected}
                  ref={(node) => {
                    if (node) node.indeterminate = selectedIds.length > 0 && !allSelected;
                  }}
                  onChange={() => onSelect(allSelected ? [] : selectable)}
                />
              </th>
            )}
            <th>{t('manage.code')}</th>
            <th>{t('manage.codeStatus')}</th>
            {!compact && (
              <>
                <th>{t('manage.claimedAt')}</th>
                <th>{t('manage.remark')}</th>
              </>
            )}
            <th>{t('manage.recordDetails')}</th>
          </tr>
        </thead>
        <tbody>
          {codes?.items.map((row) => (
            <Fragment key={row.id}>
              <tr className={selectedIds.includes(row.id) ? 'code-selected' : undefined}>
                {compact && (
                  <td className="code-select-cell">
                    <input
                      type="checkbox"
                      aria-label={t('manage.selectCode', { code: row.code })}
                      disabled={actionsDisabled || row.claimStatus !== 'unclaimed'}
                      checked={selectedIds.includes(row.id)}
                      onChange={() =>
                        onSelect(
                          selectedIds.includes(row.id)
                            ? selectedIds.filter((id) => id !== row.id)
                            : [...selectedIds, row.id],
                        )
                      }
                    />
                  </td>
                )}
                <td>
                  <div className="records-code-inline">
                    <code>{row.code}</code>
                    <CopyButton
                      value={row.code}
                      label={t('common.copy')}
                      className="records-icon records-copy"
                    />
                  </div>
                </td>
                <td>
                  <span
                    className={`record-status ${row.claimStatus === 'unclaimed' ? 'unclaimed' : row.userMarkedUsed ? 'used' : 'unused'}`}
                  >
                    {row.claimStatus === 'unclaimed'
                      ? t('common.unclaimed')
                      : row.userMarkedUsed
                        ? t('manage.used')
                        : t('manage.unused')}
                  </span>
                </td>
                {!compact && (
                  <>
                    <td className="records-time">{compactDateTime(row.claimedAt)}</td>
                    <td>
                      <div className="records-remark">{row.remark ?? '—'}</div>
                    </td>
                  </>
                )}
                <td>
                  <button
                    className="records-icon"
                    aria-label={t(
                      expanded === row.id ? 'manage.collapseRecord' : 'manage.expandRecord',
                      { code: row.code },
                    )}
                    aria-expanded={expanded === row.id}
                    aria-controls={expanded === row.id ? `${prefix}-${row.id}` : undefined}
                    onClick={() =>
                      setExpansion(expanded === row.id ? null : { query: queryKey, id: row.id })
                    }
                  >
                    <Icon name={expanded === row.id ? 'chevronUp' : 'chevronDown'} size={16} />
                  </button>
                </td>
              </tr>
              {expanded === row.id && (
                <tr className="records-expanded" id={`${prefix}-${row.id}`}>
                  <td colSpan={compact ? 4 : 5}>
                    <dl>
                      <div className="records-full">
                        <dt>{t('manage.code')}</dt>
                        <dd>
                          <code>{row.code}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>{t('manage.claimedAt')}</dt>
                        <dd>{dateTime(row.claimedAt)}</dd>
                      </div>
                      <div>
                        <dt>{t('manage.usedAt')}</dt>
                        <dd>{dateTime(row.userMarkedUsedAt)}</dd>
                      </div>
                      <div className="records-full">
                        <dt>{t('manage.remark')}</dt>
                        <dd className="records-full-remark">{row.remark ?? '—'}</dd>
                      </div>
                    </dl>
                    {row.claimStatus === 'unclaimed' && (
                      <button
                        className="button secondary small bulk-delete-button"
                        disabled={actionsDisabled}
                        onClick={() => onDelete(row)}
                      >
                        <Icon name="trash" size={15} />
                        {t('manage.deleteCode')}
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {!codes && pending && (
        <div className="records-skeleton" aria-label={t('common.loading')}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      )}
      {!codes && !pending && codesError && (
        <div className="table-empty">{t('manage.recordsFailed')}</div>
      )}
      {codes && !codes.items.length && <div className="table-empty">{t('manage.noRecords')}</div>}
    </div>
  );
}
