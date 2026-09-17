import { useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { dateTime } from '../api.ts';
import { usePoolDetails } from '../hooks/usePoolDetails.ts';
import { CopyButton, Icon, Notice } from './ui.tsx';
import { DeletePoolDialog, ImportDialog, PoolNameDialog } from './PoolDialogs.tsx';

// Manager keys this component by pool ID: drafts, filters and pages belong to one pool.
export function PoolDetail({
  pool,
  error: poolsError,
  onRefresh,
  onNavigate,
  onDeleted,
}: {
  pool: Pool;
  error: string;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  onDeleted: () => void;
}) {
  const [dialog, setDialog] = useState<'rename' | 'import' | 'delete' | null>(null);
  const {
    codes,
    codesError,
    page,
    filter,
    changePage,
    changeFilter,
    refresh,
    imported,
    status,
    busy,
    error,
  } = usePoolDetails(pool, onRefresh);
  return (
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
          <h1>{pool.name}</h1>
          <p className="muted">创建于 {dateTime(pool.createdAt)}</p>
        </div>
        <div className="heading-actions">
          <button className="text-button" onClick={refresh}>
            刷新数据
          </button>
          <button
            className="button danger small"
            disabled={busy}
            onClick={() => setDialog('delete')}
          >
            删除码池
          </button>
        </div>
      </div>
      <Notice>{error || poolsError}</Notice>
      <section className="pool-detail">
        <div className="section-heading">
          <div>
            <h2>领取明细与分享设置</h2>
          </div>
          <div className="actions">
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => setDialog('rename')}
            >
              修改名称
            </button>
            <button className="button secondary small" disabled={busy} onClick={status}>
              {pool.status === 'active' ? '停止发放' : '恢复发放'}
            </button>
            <button
              className="button primary small"
              disabled={busy}
              onClick={() => setDialog('import')}
            >
              <Icon name="plus" size={16} />
              导入兑换码
            </button>
          </div>
        </div>
        <div className="share-panel">
          <div className="share-stat">
            <span className="field-help">发放状态</span>
            <span
              className={`status ${pool.status === 'stopped' ? 'stopped' : pool.total === 0 ? '' : pool.remaining > 0 ? 'active' : 'exhausted'}`}
            >
              {pool.status === 'stopped'
                ? '已停止'
                : pool.total === 0
                  ? '待导入'
                  : pool.remaining > 0
                    ? '发放中'
                    : '已领完'}
            </span>
          </div>
          <div className="share-stat">
            <span className="field-help">已领取 / 总数</span>
            <strong>
              {pool.claimed} / {pool.total}
            </strong>
          </div>
          <div className="share-key">
            <span className="field-help">领码 Key</span>
            <code>{pool.claimKey}</code>
          </div>
          <div className="actions">
            <CopyButton value={pool.claimKey} label="复制 Key" />
            <CopyButton
              value={`${location.origin}/claim?key=${encodeURIComponent(pool.claimKey)}`}
              label="复制领码链接"
            />
          </div>
        </div>
        {pool.status === 'stopped' && (
          <Notice kind="info">此码池已停止发放。追加兑换码不会自动恢复发放。</Notice>
        )}
        <div className="table-toolbar">
          <div className="tabs">
            {(
              [
                ['all', '全部'],
                ['unclaimed', '未领取'],
                ['claimed', '已领取'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                onClick={() => {
                  if (filter === value) return;
                  changeFilter(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="muted small-text">共 {codes?.total ?? '—'} 条</span>
        </div>
        <Notice>{codesError}</Notice>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>兑换码</th>
                <th>领取状态</th>
                <th>领取时间</th>
                <th>领取备注</th>
                <th>使用标记</th>
              </tr>
            </thead>
            <tbody>
              {codes?.items.map((row) => (
                <tr key={row.id}>
                  <td className="code-cell">
                    <code>{row.code}</code>
                    <CopyButton value={row.code} label="复制" className="text-button compact" />
                  </td>
                  <td>
                    <span className={`status ${row.claimStatus}`}>
                      {row.claimStatus === 'claimed' ? '已领取' : '未领取'}
                    </span>
                  </td>
                  <td className="date-cell">{dateTime(row.claimedAt)}</td>
                  <td className="remark-cell">{row.remark ?? '—'}</td>
                  <td>
                    {row.userMarkedUsed ? (
                      <>
                        <span className="used-label">
                          <Icon name="check" size={14} />
                          已标记使用
                        </span>
                        <small className="muted">{dateTime(row.userMarkedUsedAt)}</small>
                      </>
                    ) : (
                      <span className="muted">未标记</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(!codes || !codes.items.length) && (
          <div className="table-empty">
            {codes ? '暂无兑换码记录' : codesError ? '未能加载领取明细' : '正在加载…'}
          </div>
        )}
        <div className="pagination">
          <span className="muted">使用标记仅为用户声明，实际使用情况请自行验证。</span>
          <div className="actions">
            <button
              className="button secondary small"
              disabled={page === 1}
              onClick={() => {
                changePage(page - 1);
              }}
            >
              上一页
            </button>
            <span>
              {page} / {codes ? Math.max(1, Math.ceil(codes.total / codes.pageSize)) : '—'}
            </span>
            <button
              className="button secondary small"
              disabled={!codes || page * codes.pageSize >= codes.total}
              onClick={() => {
                changePage(page + 1);
              }}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

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
    </>
  );
}
