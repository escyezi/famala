import { CODE_PAGE_SIZES, isCodePageSize } from '../../shared/contracts.ts';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../i18n/format.ts';
import type { PoolDetails } from '../hooks/usePoolDetails.ts';
import { Icon } from './ui.tsx';

export function RecordsPagination({ details }: { details: PoolDetails }) {
  const { t } = useTranslation();
  const { number } = useFormat();
  const { codes, page, pageSize, controlsLocked, changePage, changePageSize } = details;
  return (
    <div className="records-pagination">
      <span className="muted">
        {codes
          ? t('manage.recordRange', {
              start: codes.total ? (page - 1) * codes.pageSize + 1 : 0,
              end: Math.min(page * codes.pageSize, codes.total),
              total: codes.total,
            })
          : '—'}
      </span>
      <div className="actions">
        <select
          aria-label={t('manage.pageSize')}
          value={pageSize}
          disabled={controlsLocked}
          onChange={(event) => {
            if (isCodePageSize(event.target.value)) changePageSize(event.target.value);
          }}
        >
          {CODE_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {t('manage.pageRows', { count: Number(size) })}
            </option>
          ))}
        </select>
        <button
          className="records-icon"
          aria-label={t('manage.previous')}
          disabled={controlsLocked || !codes || page === 1}
          onClick={() => changePage(page - 1)}
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <span aria-live="polite">
          {number(page)} /{' '}
          {codes ? number(Math.max(1, Math.ceil(codes.total / codes.pageSize))) : '—'}
        </span>
        <button
          className="records-icon"
          aria-label={t('manage.next')}
          disabled={controlsLocked || !codes || page * codes.pageSize >= codes.total}
          onClick={() => changePage(page + 1)}
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>
    </div>
  );
}
