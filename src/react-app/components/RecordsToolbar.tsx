import { useTranslation } from 'react-i18next';
import { useFormat } from '../i18n/format.ts';
import type { PoolDetails } from '../hooks/usePoolDetails.ts';
import { Icon } from './ui.tsx';

export function RecordsToolbar({
  details,
  selectedCount,
  onDelete,
  onFilter,
  onExport,
}: {
  details: PoolDetails;
  selectedCount: number;
  onDelete: () => void;
  onFilter: PoolDetails['changeFilter'];
  onExport: () => void;
}) {
  const { t } = useTranslation();
  const { number } = useFormat();
  return (
    <div className="records-toolbar">
      <h2 id="pool-records-title">{t('manage.records')}</h2>
      <div className="tabs" aria-label={t('manage.recordFilters')}>
        {(
          [
            ['all', t('manage.all')],
            ['unclaimed', t('common.unclaimed')],
            ['claimed', t('common.claimed')],
            ['redeemed', t('manage.redeemed')],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            className={details.filter === value ? 'active' : ''}
            aria-pressed={details.filter === value}
            disabled={details.controlsLocked}
            onClick={() => onFilter(value)}
          >
            {label}
            <span className="records-tab-count">
              {details.codes && (!details.invalidated || details.pending)
                ? number(details.codes.counts[value])
                : '—'}
            </span>
            {details.pending && details.requestedQuery.filter === value && (
              <span className="records-spinner" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      <div className="records-bulk-slot">
        <button
          type="button"
          className="button secondary small"
          disabled={details.controlsLocked}
          onClick={onExport}
        >
          {t('exports.singlePool')}
        </button>
        {details.filter === 'unclaimed' && (
          <>
            <span className="muted" aria-live="polite">
              {t('manage.selectedCount', { count: selectedCount })}
            </span>
            <button
              type="button"
              className="button secondary small bulk-delete-button"
              disabled={details.actionsDisabled || !selectedCount}
              onClick={onDelete}
            >
              <Icon name="trash" size={14} />
              {t('manage.bulkDelete')}
            </button>
          </>
        )}
        <button
          type="button"
          className="text-button refresh-button"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          disabled={details.controlsLocked}
          onClick={details.refresh}
        >
          <Icon name="refresh" size={18} />
        </button>
      </div>
    </div>
  );
}
