import { useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { dateTime } from '../api.ts';
import { CopyButton, Icon, Notice } from './ui.tsx';
import { ImportDialog, PoolNameDialog } from './PoolDialogs.tsx';

export function PoolList({
  pools,
  error,
  onRefresh,
  onNavigate,
}: {
  pools: Pool[] | null;
  error: string;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [importingPool, setImportingPool] = useState<Pick<Pool, 'id' | 'name'> | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DISTRIBUTOR WORKSPACE</div>
          <h1>我的空间</h1>
          <p className="muted">创建、分享，轻松管理每一次发放。</p>
        </div>
        <div className="heading-actions">
          <button className="button primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} />
            新建兑换码池
          </button>
        </div>
      </div>
      <Notice>{error}</Notice>
      <div className="section-heading">
        <h2>
          我的码池 <span className="count-badge">{pools?.length ?? 0}</span>
        </h2>
        <button
          type="button"
          className="text-button refresh-button"
          aria-label="刷新数据"
          title="刷新数据"
          onClick={onRefresh}
        >
          <Icon name="refresh" size={18} />
        </button>
      </div>
      {!pools ? (
        <div className="empty-state">
          {error ? '数据加载失败，请点击刷新数据重试。' : '正在加载你的码池…'}
        </div>
      ) : pools.length === 0 ? (
        <div className="empty-state bordered">
          <span className="empty-icon">
            <Icon name="box" size={32} />
          </span>
          <h3>从第一个码池开始</h3>
          <button className="button secondary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
            新建兑换码池
          </button>
        </div>
      ) : (
        <div className="pool-grid">
          {pools.map((p) => (
            <article className="pool-card" key={p.id} aria-labelledby={`pool-name-${p.id}`}>
              <a
                className="pool-card-main"
                href={`/manage/pools/${p.id}`}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onNavigate(`/manage/pools/${p.id}`);
                }}
              >
                <div className="pool-card-top">
                  <h3 id={`pool-name-${p.id}`} title={p.name}>
                    {p.name}
                  </h3>
                  <span
                    className={`status ${p.status === 'stopped' ? 'stopped' : p.total === 0 ? 'pending' : p.remaining > 0 ? 'active' : 'exhausted'}`}
                  >
                    {p.status === 'stopped'
                      ? '已停止'
                      : p.total === 0
                        ? '待导入'
                        : p.remaining > 0
                          ? '发放中'
                          : '已领完'}
                  </span>
                </div>
                <p>创建于 {dateTime(p.createdAt)}</p>
                {p.total === 0 ? (
                  <div className="pool-card-empty">
                    <span>暂无兑换码</span>
                    <small>
                      {p.status === 'stopped'
                        ? '导入后需在详情中恢复发放'
                        : '导入兑换码后即可分享发放'}
                    </small>
                  </div>
                ) : (
                  <>
                    <div className="pool-progress">
                      <span style={{ width: `${(p.claimed / p.total) * 100}%` }} />
                    </div>
                    <div className="pool-counts">
                      <span>
                        已领取 <b>{p.claimed}</b> / {p.total}
                      </span>
                      <span>
                        剩余 <b>{p.remaining}</b>
                      </span>
                    </div>
                  </>
                )}
              </a>
              <div className="pool-card-actions">
                <button className="button primary small" onClick={() => setImportingPool(p)}>
                  <Icon name="plus" size={15} />
                  导入兑换码
                </button>
                <CopyButton
                  value={`${location.origin}/claim?key=${encodeURIComponent(p.claimKey)}`}
                  label="复制领码链接"
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {importingPool && (
        <ImportDialog
          pool={importingPool}
          onClose={() => setImportingPool(null)}
          onImported={onRefresh}
        />
      )}

      {creating && (
        <PoolNameDialog
          onClose={() => setCreating(false)}
          onImport={(pool) => {
            setCreating(false);
            setImportingPool(pool);
            onRefresh();
          }}
          onSaved={(id) => {
            setCreating(false);
            onRefresh();
            onNavigate(`/manage/pools/${id}`);
          }}
        />
      )}
    </>
  );
}
