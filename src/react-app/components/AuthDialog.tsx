import { useState } from 'react';
import { api, rpc } from '../api.ts';
import type { Session } from '../../shared/api-types.ts';
import { CopyButton, Dialog, Icon, Notice } from './ui.tsx';

export function AuthDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (session: Session) => void;
}) {
  const [mode, setMode] = useState<'choose' | 'login' | 'saved'>('choose');
  const [key, setKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newSession, setNewSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function create() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(rpc.api.spaces.$post());
      setNewKey(result.key);
      setNewSession({ spaceId: result.spaceId, expiresAt: result.expiresAt });
      setMode('saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true);
    setError('');
    try {
      const session = await api(rpc.api.login.$post({ json: { key: key.trim() } }));
      onDone(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={mode === 'saved' ? '保存你的发码 Key' : '开始发放兑换码'}
      onClose={onClose}
      locked={busy || mode === 'saved'}
    >
      <Notice>{error}</Notice>
      {mode === 'choose' && (
        <>
          <p className="muted">无需注册，一个 Key 就是你的独立发码空间。</p>
          <div className="auth-options">
            <button className="option" onClick={create} disabled={busy}>
              <span className="tile-icon">
                <Icon name="plus" />
              </span>
              <span>
                <strong>{busy ? '正在创建…' : '生成新 Key'}</strong>
                <small>创建一个全新的发码空间</small>
              </span>
              <Icon name="arrow" />
            </button>
            <button
              className="option"
              onClick={() => {
                setError('');
                setMode('login');
              }}
              disabled={busy}
            >
              <span className="tile-icon neutral">
                <Icon name="key" />
              </span>
              <span>
                <strong>使用已有 Key</strong>
                <small>返回你的发码空间</small>
              </span>
              <Icon name="arrow" />
            </button>
          </div>
        </>
      )}
      {mode === 'login' && (
        <form onSubmit={login}>
          <p className="muted">输入创建空间时保存的发码 Key。</p>
          <label htmlFor="distributor-key">发码 Key</label>
          <input
            id="distributor-key"
            type="password"
            autoComplete="off"
            placeholder="d_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            autoFocus
          />
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setMode('choose');
                setError('');
              }}
            >
              返回
            </button>
            <button className="button primary" disabled={busy || !key.trim()}>
              {busy ? '登录中…' : '进入管理页面'}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </form>
      )}
      {mode === 'saved' && (
        <>
          <p className="muted">这是重新登录此空间的唯一凭证，只在这里展示一次。</p>
          <div className="secret-box">
            <code>{newKey}</code>
            <CopyButton value={newKey} label="复制发码 Key" />
          </div>
          <Notice kind="info">
            请保存在安全的地方。Key 丢失后无法找回，也不要将它作为领码 Key 分享。
          </Notice>
          <label className="checkbox-label">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            我已妥善保存发码 Key
          </label>
          <button
            className="button primary full"
            disabled={!saved || !newSession}
            onClick={() => newSession && onDone(newSession)}
          >
            进入管理页面
            <Icon name="arrow" size={17} />
          </button>
        </>
      )}
    </Dialog>
  );
}
