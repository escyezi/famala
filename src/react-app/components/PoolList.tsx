import { useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { dateTime } from '../api.ts';
import { Icon, Notice } from './ui.tsx';
import { PoolNameDialog } from './PoolDialogs.tsx';

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
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DISTRIBUTOR WORKSPACE</div>
          <h1>兑换码池</h1>
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
        <button className="text-button" onClick={onRefresh}>
          刷新数据
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
          <p>为你的活动创建一个码池，再导入兑换码。</p>
          <button className="button secondary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
            新建兑换码池
          </button>
        </div>
      ) : (
        <div className="pool-grid">
          {pools.map((p) => (
            <a
              className="pool-card"
              key={p.id}
              href={`/manage/pools/${p.id}`}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onNavigate(`/manage/pools/${p.id}`);
              }}
            >
              <div className="pool-card-top">
                <h3 title={p.name}>{p.name}</h3>
                {p.total > 0 && (
                  <span
                    className={`status ${p.status === 'stopped' ? 'stopped' : p.remaining > 0 ? 'active' : 'exhausted'}`}
                  >
                    {p.status === 'stopped' ? '已停止' : p.remaining > 0 ? '发放中' : '已领完'}
                  </span>
                )}
              </div>
              <p>创建于 {dateTime(p.createdAt)}</p>
              <div className="pool-progress">
                <span style={{ width: `${p.total ? (p.claimed / p.total) * 100 : 0}%` }} />
              </div>
              <div className="pool-counts">
                <span>
                  已领取 <b>{p.claimed}</b> / {p.total}
                </span>
                <span>
                  剩余 <b>{p.remaining}</b>
                </span>
              </div>
            </a>
          ))}
        </div>
      )}

      {creating && (
        <PoolNameDialog
          onClose={() => setCreating(false)}
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
