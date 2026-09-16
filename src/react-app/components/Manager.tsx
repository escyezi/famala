import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, rpc, dateTime } from '../api.ts';
import { parseImport } from '../../shared/contracts.ts';
import type { CodePage, CodeFilter, ImportResult, Pool, Session } from '../../shared/api-types.ts';
import { CopyButton, Dialog, Icon, Notice } from './ui.tsx';
import { WorkspaceMenu } from './WorkspaceMenu.tsx';

function ImportDialog({
  pool,
  onClose,
  onImported,
}: {
  pool: Pool;
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const count = text.split(/\r\n|\n|\r/).filter((line) => line.trim()).length;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setResult(null);
    try {
      parseImport(text);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      setResult(
        await api(
          rpc.api.manage.pools[':id'].import.$post({ param: { id: pool.id }, json: { text } }),
        ),
      );
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="导入兑换码" onClose={onClose} locked={busy} wide>
      <p className="muted">
        导入至 <strong>{pool.name}</strong>。每行一个兑换码，错误行会跳过，其余正常导入。
      </p>
      <Notice>{error}</Notice>
      <form onSubmit={submit}>
        <label htmlFor="codes-input">
          兑换码内容<span className={count > 500 ? 'field-error' : 'muted'}>{count} / 500 条</span>
        </label>
        <textarea
          id="codes-input"
          className="code-input"
          placeholder={'WELCOME-2026-001\nWELCOME-2026-002\nWELCOME-2026-003'}
          rows={9}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          disabled={busy}
        />
        <p className="field-help">每条最长 100 字；忽略空行和首尾空白，区分大小写。</p>
        {result && (
          <div className="import-result">
            <Notice kind={result.failed ? 'info' : 'success'}>
              导入完成：成功 {result.succeeded} 条，失败 {result.failed} 条。
            </Notice>
            {result.failures.length > 0 && (
              <div className="table-scroll failures">
                <table>
                  <thead>
                    <tr>
                      <th>原始行号</th>
                      <th>兑换码</th>
                      <th>失败原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failures.map((row) => (
                      <tr key={row.line}>
                        <td>第 {row.line} 行</td>
                        <td>
                          <code>{row.code}</code>
                        </td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            关闭
          </button>
          <button
            className="button primary"
            disabled={busy || count === 0 || count > 500 || result !== null}
          >
            {busy ? '正在导入…' : '开始导入'}
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function PoolNameDialog({
  pool,
  onClose,
  onSaved,
}: {
  pool?: Pool;
  onClose: () => void;
  onSaved: (id: string, name: string) => void;
}) {
  const [name, setName] = useState(pool?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const json = { name: name.trim() };
      const result = pool
        ? await api(rpc.api.manage.pools[':id'].name.$post({ param: { id: pool.id }, json }))
        : await api(rpc.api.manage.pools.$post({ json }));
      onSaved(result.id, name.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={pool ? '修改码池名称' : '新建兑换码池'} onClose={onClose} locked={busy}>
      <p className="muted">
        {pool
          ? '修改后原领码 Key 和链接继续有效，已有兑换码和领取记录不受影响。'
          : '为这次发放起个名字。创建后可随时导入兑换码。'}
      </p>
      <Notice>{error}</Notice>
      <form onSubmit={submit}>
        <label htmlFor="pool-name">码池名称</label>
        <input
          id="pool-name"
          autoFocus
          placeholder="例如：九月会员福利"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={busy}
        />
        <p className="field-help">名称不能为空，也不能与当前空间的其他码池重名。</p>
        <div className="dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            disabled={busy || !name.trim() || name.trim() === pool?.name}
          >
            {busy ? '保存中…' : pool ? '保存名称' : '创建空池'}
            <Icon name={pool ? 'check' : 'plus'} size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Manager({
  onLogout,
  menuTarget,
  poolId,
  onNavigate,
}: {
  onLogout: () => void;
  menuTarget: HTMLElement | null;
  poolId?: string;
  onNavigate: (path: string) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<CodeFilter>('all');
  const [codes, setCodes] = useState<CodePage | null>(null);
  const [codesError, setCodesError] = useState('');
  const pool = pools?.find((p) => p.id === poolId);
  const loadedPoolId = pool?.id;
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api(rpc.api.manage.session.$get(undefined, { init: { signal: controller.signal } })),
      api(rpc.api.manage.pools.$get(undefined, { init: { signal: controller.signal } })),
    ])
      .then(([s, result]) => {
        if (controller.signal.aborted) return;
        setSession(s);
        setPools(result.items);
        setError('');
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!loadedPoolId) return;
    const controller = new AbortController();
    api(
      rpc.api.manage.pools[':id'].codes.$get(
        { param: { id: loadedPoolId }, query: { page: String(page), status: filter } },
        { init: { signal: controller.signal } },
      ),
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setCodes(result);
        setCodesError('');
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setCodesError(e.message);
      });
    return () => controller.abort();
  }, [loadedPoolId, page, filter, revision]);
  function refresh() {
    setCodes(null);
    setCodesError('');
    setError('');
    setRevision((r) => r + 1);
  }
  async function status() {
    if (!pool || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(
        rpc.api.manage.pools[':id'].status.$post({
          param: { id: pool.id },
          json: { status: pool.status === 'active' ? 'stopped' : 'active' },
        }),
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await api(rpc.api.manage.logout.$post());
      onLogout();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace">
      {menuTarget &&
        createPortal(<WorkspaceMenu session={session} busy={busy} onLogout={logout} />, menuTarget)}
      <main className="manager-main">
        {poolId && (
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
        )}
        <div className="page-heading">
          <div>
            <div className="eyebrow">DISTRIBUTOR WORKSPACE</div>
            <h1>{poolId ? (pool?.name ?? '码池详情') : '兑换码池'}</h1>
            <p className="muted">
              {poolId
                ? pool
                  ? `创建于 ${dateTime(pool.createdAt)}`
                  : '查看码池信息、领取明细与分享设置。'
                : '创建、分享，轻松管理每一次发放。'}
            </p>
          </div>
          <div className="heading-actions">
            {poolId ? (
              <button className="text-button" onClick={refresh}>
                刷新数据
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() => setCreating(true)}
                disabled={!session}
              >
                <Icon name="plus" size={18} />
                新建兑换码池
              </button>
            )}
          </div>
        </div>
        <Notice>{error}</Notice>
        {!poolId && (
          <>
            <div className="section-heading">
              <h2>
                我的码池 <span className="count-badge">{pools?.length ?? 0}</span>
              </h2>
              <button className="text-button" onClick={refresh}>
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
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                        return;
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
                          {p.status === 'stopped'
                            ? '已停止'
                            : p.remaining > 0
                              ? '发放中'
                              : '已领完'}
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
          </>
        )}
        {poolId && !pool && (
          <div className="empty-state bordered">
            {!pools
              ? error
                ? '数据加载失败，请点击刷新数据重试。'
                : '正在加载码池详情…'
              : '码池不存在或无权访问。'}
          </div>
        )}
        {pool && (
          <section className="pool-detail">
            <div className="section-heading">
              <div>
                <h2>领取明细与分享设置</h2>
              </div>
              <div className="actions">
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() => setRenaming(true)}
                >
                  修改名称
                </button>
                <button className="button secondary small" disabled={busy} onClick={status}>
                  {pool.status === 'active' ? '停止发放' : '恢复发放'}
                </button>
                <button className="button primary small" onClick={() => setImporting(true)}>
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
                      setFilter(value);
                      setPage(1);
                      setCodes(null);
                      setCodesError('');
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
                    setPage((p) => p - 1);
                    setCodes(null);
                    setCodesError('');
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
                    setPage((p) => p + 1);
                    setCodes(null);
                    setCodesError('');
                  }}
                >
                  下一页
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
      {creating && (
        <PoolNameDialog
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            onNavigate(`/manage/pools/${id}`);
          }}
        />
      )}
      {renaming && pool && (
        <PoolNameDialog
          pool={pool}
          onClose={() => setRenaming(false)}
          onSaved={(id, name) => {
            setRenaming(false);
            setPools(
              (items) => items?.map((item) => (item.id === id ? { ...item, name } : item)) ?? null,
            );
            refresh();
          }}
        />
      )}
      {importing && pool && (
        <ImportDialog
          pool={pool}
          onClose={() => setImporting(false)}
          onImported={() => {
            setPage(1);
            refresh();
          }}
        />
      )}
    </div>
  );
}
