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
              返回码池列表
            </a>
            <div className="page-heading">
              <div>
                <div className="eyebrow">DISTRIBUTOR WORKSPACE</div>
                <h1>码池详情</h1>
                <p className="muted">查看码池信息、领取明细与分享设置。</p>
              </div>
              <button
                type="button"
                className="text-button refresh-button"
                aria-label="刷新数据"
                title="刷新数据"
                onClick={refresh}
              >
                <Icon name="refresh" size={18} />
              </button>
            </div>
            <Notice>{error}</Notice>
            <div className="empty-state bordered">
              {loading || !pools
                ? error
                  ? '数据加载失败，请点击刷新数据重试。'
                  : '正在加载码池详情…'
                : '码池不存在或无权访问。'}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
