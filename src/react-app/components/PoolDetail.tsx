import { useId, useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { dateTime } from '../api.ts';
import { usePoolDetails } from '../hooks/usePoolDetails.ts';
import { CopyButton, Icon, Notice } from './ui.tsx';
import { DeletePoolDialog, ImportDialog, PoolNameDialog } from './PoolDialogs.tsx';
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
  error: string;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  onDeleted: () => void;
}) {
  const [dialog, setDialog] = useState<'rename' | 'import' | 'delete' | null>(null);
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
  return (
    <div className="pool-detail-page">
      <header className="pool-page-header">
        <a
          className="text-button pool-back"
          href="/manage"
          aria-label="返回码池列表"
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onNavigate('/manage');
          }}
        >
          <Icon name="arrow" size={16} />
          返回
        </a>
        <div className="pool-page-title">
          <div className="pool-title-line">
            <h1>{pool.name}</h1>
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
          <p className="muted">创建于 {dateTime(pool.createdAt)}</p>
        </div>
        <button
          type="button"
          className="text-button refresh-button pool-refresh"
          aria-label="刷新数据"
          title="刷新数据"
          onClick={refresh}
        >
          <Icon name="refresh" size={18} />
        </button>
      </header>
      <Notice>{error || poolsError}</Notice>
      <section className="pool-detail pool-overview" aria-label="码池统计">
        <div className="pool-overview-main">
          <dl className="pool-stats">
            <div className="remaining-stat">
              <dt>剩余</dt>
              <dd>{pool.remaining}</dd>
            </div>
            <div>
              <dt>已领取</dt>
              <dd>{pool.claimed}</dd>
            </div>
            <div>
              <dt>总数</dt>
              <dd>{pool.total}</dd>
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
                导入兑换码
              </button>
              <CopyButton
                value={`${location.origin}/claim?key=${encodeURIComponent(pool.claimKey)}`}
                label="复制领码链接"
                className="button secondary small pool-main-action"
              />
              <button
                type="button"
                className="button secondary small pool-key-toggle"
                aria-label="查看领码 Key"
                title="查看领码 Key"
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
            <CopyButton value={pool.claimKey} label="复制 Key" className="text-button compact" />
          </div>
        </div>
      </section>
      {pool.status === 'stopped' && (
        <Notice kind="info">此码池已停止发放。追加兑换码不会自动恢复发放。</Notice>
      )}
      <section className="pool-detail pool-records" aria-labelledby="pool-records-title">
        <div className="table-toolbar">
          <div className="records-heading">
            <h2 id="pool-records-title">领取明细</h2>
            <span className="muted records-count">共 {codes?.total ?? '—'} 条</span>
          </div>
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
                aria-pressed={filter === value}
                onClick={() => {
                  if (filter === value) return;
                  changeFilter(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="table-pagination">
            <label className="page-size-control">
              每页
              <select
                aria-label="每页条数"
                value={pageSize}
                onChange={(event) => changePageSize(event.target.value === '50' ? '50' : '20')}
              >
                <option value="20">20 条</option>
                <option value="50">50 条</option>
              </select>
            </label>
            <div className="actions">
              <button
                className="button secondary small"
                disabled={!codes || page === 1}
                onClick={() => changePage(page - 1)}
              >
                上一页
              </button>
              <span aria-live="polite">
                {page} / {codes ? Math.max(1, Math.ceil(codes.total / codes.pageSize)) : '—'}
              </span>
              <button
                className="button secondary small"
                disabled={!codes || page * codes.pageSize >= codes.total}
                onClick={() => changePage(page + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </div>
        <Notice>{codesError}</Notice>
        <div
          className="table-scroll pool-codes-scroll"
          key={`${page}-${pageSize}-${filter}`}
          role="region"
          aria-label="领取明细表格"
          tabIndex={0}
        >
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
                    <div className="code-inline">
                      <code>{row.code}</code>
                      <CopyButton value={row.code} label="复制" className="text-button compact" />
                    </div>
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
          {(!codes || !codes.items.length) && (
            <div className="table-empty">
              {codes ? '暂无兑换码记录' : codesError ? '未能加载领取明细' : '正在加载…'}
            </div>
          )}
        </div>
        <p className="field-help records-note">使用标记仅为用户声明，实际使用情况请自行验证。</p>
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
    </div>
  );
}
