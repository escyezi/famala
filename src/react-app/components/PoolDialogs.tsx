import { useState } from 'react';
import { api, rpc } from '../api.ts';
import { parseImport } from '../../shared/contracts.ts';
import type { ImportResult, Pool } from '../../shared/api-types.ts';
import { Dialog, Icon, Notice } from './ui.tsx';

export function ImportDialog({
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
export function PoolNameDialog({
  pool,
  onClose,
  onSaved,
}: {
  pool?: Pool;
  onClose: () => void;
  onSaved: (id: string) => void;
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
      onSaved(result.id);
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
