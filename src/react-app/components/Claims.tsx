import { useEffect, useRef, useState } from 'react';
import { api, ApiError, dateTime } from '../api.ts';
import { readRecords, saveClaim, saveUsed, subscribeRecords } from '../storage.ts';
import { normalizeRemark, codePointLength } from '../../shared/contracts.ts';
import type { ClaimRecord, PublicConfig, PublicPool, UsedResult } from '../../shared/contracts.ts';
import { CopyButton, Dialog, Icon, Notice } from './ui.tsx';
import { Turnstile } from './Turnstile.tsx';

function RecordCard({
  record,
  onMarked,
}: {
  record: ClaimRecord;
  onMarked?: (record: ClaimRecord) => void;
}) {
  const [used, setUsed] = useState<UsedResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const marked = record.userMarkedUsed || used !== null;
  async function mark() {
    if (busy || marked) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<UsedResult>('/api/claim/used', {
        claimKey: record.claimKey,
        code: record.code,
      });
      setUsed(result);
      onMarked?.({ ...record, ...result });
      setWarning(await saveUsed(record, result));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="record-card">
      <div className="record-head">
        <div>
          <h3>{record.poolName}</h3>
          <span className="muted small-text">领取于 {dateTime(record.claimedAt)}</span>
        </div>
        <span className="status claimed">已领取</span>
      </div>
      <div className="claimed-code">
        <code>{record.code}</code>
        <CopyButton value={record.code} label="复制兑换码" />
      </div>
      <Notice>{error}</Notice>
      <Notice kind="info">{warning}</Notice>
      <div className="record-footer">
        <button
          className={`button ${marked ? 'secondary' : 'primary'} small`}
          onClick={mark}
          disabled={marked || busy}
        >
          <Icon name="check" size={16} />
          {marked ? '已标记使用' : busy ? '正在标记…' : '我已使用'}
        </button>
        {marked && (
          <span className="muted small-text">
            {dateTime(used?.userMarkedUsedAt ?? record.userMarkedUsedAt)}
          </span>
        )}
      </div>
    </article>
  );
}
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState(readRecords);
  useEffect(() => subscribeRecords(() => setSnapshot(readRecords())), []);
  return (
    <Dialog title="已领取的兑换码" onClose={onClose} wide>
      <p className="muted">仅保存在当前浏览器，清除浏览器数据后无法恢复。</p>
      <Notice kind="info">{snapshot.warning}</Notice>
      <div className="history-list">
        {snapshot.records.length ? (
          [...snapshot.records]
            .sort((a, b) => b.claimedAt - a.claimedAt)
            .map((record) => <RecordCard key={record.claimKey} record={record} />)
        ) : (
          <div className="empty-state">
            <Icon name="history" size={36} />
            <h3>暂无已领取的兑换码</h3>
            <p>领取成功后，你的兑换码会保存在这里。</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
export function ClaimKeyDialog({
  onClose,
  onValidated,
}: {
  onClose: () => void;
  onValidated: (key: string) => void;
}) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/claim/validate', { claimKey: key.trim() });
      onValidated(key.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="领取你的兑换码" onClose={onClose} locked={busy}>
      <p className="muted">输入发码者分享的领码 Key，即可前往领取。</p>
      <Notice>{error}</Notice>
      <form onSubmit={submit}>
        <label htmlFor="claim-key">领码 Key</label>
        <input
          id="claim-key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="c_…"
          required
        />
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" disabled={busy || !key.trim()}>
            {busy ? '校验中…' : '前往领取'}
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ClaimPage({ claimKey, onEnterKey }: { claimKey: string; onEnterKey: () => void }) {
  const [pool, setPool] = useState<PublicPool | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [snapshot, setSnapshot] = useState(readRecords);
  const [result, setResult] = useState<ClaimRecord | null>(null);
  const [remark, setRemark] = useState('');
  const [token, setToken] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeRecords(() => setSnapshot(readRecords())), []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<PublicPool>('/api/claim/validate', { claimKey }, controller.signal),
      api<PublicConfig>('/api/config', undefined, controller.signal),
    ])
      .then(([p, conf]) => {
        setPool(p);
        setConfig(conf);
        setError('');
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, [claimKey, revision]);
  const record = result ?? snapshot.records.find((r) => r.claimKey === claimKey);
  const available = pool?.status === 'active' && pool.remaining > 0;
  const length = codePointLength(remark.trim());
  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || record) return;
    const current = readRecords();
    const existing = current.records.find((r) => r.claimKey === claimKey);
    if (existing) {
      setResult(existing);
      return;
    }
    if (!token || !available) return;
    try {
      normalizeRemark(remark);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const claimed = await api<ClaimRecord>('/api/claim', {
        claimKey,
        remark,
        turnstileToken: token,
      });
      setResult(claimed);
      setWarning(await saveClaim(claimed));
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.code === 'POOL_STOPPED')
        setPool((p) => p && { ...p, status: 'stopped' });
      if (e instanceof ApiError && e.code === 'POOL_EMPTY')
        setPool((p) => p && { ...p, remaining: 0 });
    } finally {
      setToken('');
      setAttempt((v) => v + 1);
      setBusy(false);
      submitting.current = false;
    }
  }
  return (
    <main className="claim-main">
      <div className="claim-intro">
        <span className="hero-icon">
          <Icon name={record ? 'check' : 'gift'} size={34} />
        </span>
        <div className="eyebrow">A LITTLE SOMETHING FOR YOU</div>
        <h1>{record && pool ? '兑换码已为你保留' : '领取一份小美好'}</h1>
        {record && pool && <p className="muted">复制兑换码，前往对应平台使用。</p>}
      </div>
      <Notice>{error}</Notice>
      <Notice kind="info">{warning || snapshot.warning}</Notice>
      {!loaded ? (
        <div className="empty-state">正在查找兑换码池…</div>
      ) : !pool ? (
        <div className="claim-panel">
          <p>暂时无法打开这个码池。</p>
          <div className="actions">
            <button className="button secondary" onClick={() => setRevision((v) => v + 1)}>
              重试
            </button>
            <button className="button primary" onClick={onEnterKey}>
              重新输入领码 Key
            </button>
          </div>
        </div>
      ) : record ? (
        <RecordCard
          key={`${record.claimKey}:${record.code}`}
          record={record}
          onMarked={setResult}
        />
      ) : (
        <section className="claim-panel">
          <div className="claim-pool-title">
            <div>
              <span className="field-help">当前兑换码池</span>
              <h2>{pool.name}</h2>
            </div>
            <span className={`status ${pool.status}`}>
              {pool.status === 'stopped' ? '已停止' : pool.remaining ? '发放中' : '已领完'}
            </span>
          </div>
          <div className="inventory">
            <span>剩余兑换码</span>
            <strong>
              {pool.remaining}
              <small>份</small>
            </strong>
          </div>
          <form onSubmit={claim}>
            <label htmlFor="remark">
              备注 <span className="muted">选填 · {length}/500</span>
            </label>
            <textarea
              id="remark"
              rows={3}
              placeholder="可以留下你的昵称或想对发码者说的话"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              disabled={busy}
            />
            <p className="field-help">备注将提供给发码者查看；不填写也可正常领取。</p>
            {length > 500 && <Notice>备注最多 500 字，请修改后领取。</Notice>}
            {available && config?.turnstileSiteKey && (
              <Turnstile key={attempt} siteKey={config.turnstileSiteKey} onToken={setToken} />
            )}
            {available && config && !config.turnstileSiteKey && (
              <Notice>人机验证暂未配置，暂时无法领取，请联系发码者。</Notice>
            )}
            <button
              className="button primary full claim-button"
              disabled={!available || !token || busy || length > 500}
            >
              {pool.status === 'stopped'
                ? '该兑换码池已停止发放'
                : !pool.remaining
                  ? '兑换码已领完'
                  : busy
                    ? '正在领取，请稍候…'
                    : '领取兑换码'}
              {available && !busy && <Icon name="arrow" size={18} />}
            </button>
          </form>
          {!available && (
            <button className="text-button full" onClick={() => setRevision((v) => v + 1)}>
              刷新码池状态
            </button>
          )}
        </section>
      )}
      <p className="claim-footnote">
        <Icon name="history" size={15} />
        领取记录仅保存在当前浏览器，请及时复制保存。
      </p>
    </main>
  );
}
