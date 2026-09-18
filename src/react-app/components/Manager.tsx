import { useTranslation } from 'react-i18next';
import { usePools } from '../hooks/usePools.ts';
import { PoolList } from './PoolList.tsx';
import { PoolDetail } from './PoolDetail.tsx';
import { Icon, Notice } from './ui.tsx';

export function Manager({
  poolId,
  onNavigate,
}: {
  poolId?: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { pools, loading, error, refresh, removePool } = usePools(poolId);
  const pool = pools?.find((item) => String(item.id) === poolId);
  return (
    <div className="workspace">
      <main className={`manager-main${pool ? ' manager-detail-main' : ''}`}>
        {!poolId ? (
          <PoolList pools={pools} error={error} onRefresh={refresh} onNavigate={onNavigate} />
        ) : pool ? (
          <PoolDetail
            key={pool.id}
            pool={pool}
            error={error}
            onRefresh={refresh}
            onNavigate={onNavigate}
            onDeleted={() => {
              removePool(pool.id);
              onNavigate('/manage');
            }}
          />
        ) : (
          <>
            <a
              className="text-button pool-back"
              href="/manage"
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onNavigate('/manage');
              }}
            >
              <Icon name="arrow" size={16} />
              {t('manage.backToPools')}
            </a>
            <div className="page-heading">
              <div>
                <div className="eyebrow">{t('manage.eyebrow')}</div>
                <h1>{t('manage.details')}</h1>
                <p className="muted">{t('manage.detailsHelp')}</p>
              </div>
              <button
                type="button"
                className="text-button refresh-button"
                aria-label={t('common.refresh')}
                title={t('common.refresh')}
                onClick={refresh}
              >
                <Icon name="refresh" size={18} />
              </button>
            </div>
            <Notice>{error}</Notice>
            <div className="empty-state bordered">
              {loading || !pools
                ? error
                  ? t('manage.loadFailed')
                  : t('manage.loadingDetails')
                : t('manage.missing')}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
