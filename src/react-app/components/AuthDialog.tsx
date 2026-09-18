import { useTranslation } from 'react-i18next';
import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
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
  const { t } = useTranslation();
  const [mode, setMode] = useState<'choose' | 'login' | 'saved'>('choose');
  const [key, setKey] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newSession, setNewSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  const [saved, setSaved] = useState(false);
  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(rpc.api.spaces.$post());
      setNewKey(result.key);
      setNewSession({ spaceId: result.spaceId, expiresAt: result.expiresAt });
      setMode('saved');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api(rpc.api.login.$post({ json: { key: key.trim() } }));
      onDone(session);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={mode === 'saved' ? t('auth.saveKey') : t('auth.start')}
      onClose={onClose}
      locked={busy || mode === 'saved'}
    >
      <Notice>{error}</Notice>
      {mode === 'choose' && (
        <>
          <p className="muted">{t('auth.intro')}</p>
          <div className="auth-options">
            <button className="option" onClick={create} disabled={busy}>
              <span className="tile-icon">
                <Icon name="plus" />
              </span>
              <span>
                <strong>{busy ? t('auth.creating') : t('auth.generate')}</strong>
                <small>{t('auth.newWorkspace')}</small>
              </span>
              <Icon name="arrow" />
            </button>
            <button
              className="option"
              onClick={() => {
                setError(null);
                setMode('login');
              }}
              disabled={busy}
            >
              <span className="tile-icon neutral">
                <Icon name="key" />
              </span>
              <span>
                <strong>{t('auth.existingKey')}</strong>
                <small>{t('auth.returnWorkspace')}</small>
              </span>
              <Icon name="arrow" />
            </button>
          </div>
        </>
      )}
      {mode === 'login' && (
        <form onSubmit={login}>
          <p className="muted">{t('auth.loginHelp')}</p>
          <label htmlFor="distributor-key">{t('auth.key')}</label>
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
                setError(null);
              }}
            >
              {t('common.back')}
            </button>
            <button className="button primary" disabled={busy || !key.trim()}>
              {busy ? t('auth.loggingIn') : t('auth.enter')}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </form>
      )}
      {mode === 'saved' && (
        <>
          <p className="muted">{t('auth.onlyCredential')}</p>
          <div className="secret-box">
            <code>{newKey}</code>
            <CopyButton value={newKey} label={t('auth.copyKey')} />
          </div>
          <Notice kind="info">{t('auth.keepSafe')}</Notice>
          <label className="checkbox-label">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            {t('auth.saved')}
          </label>
          <button
            className="button primary full"
            disabled={!saved || !newSession}
            onClick={() => newSession && onDone(newSession)}
          >
            {t('auth.enter')}
            <Icon name="arrow" size={17} />
          </button>
        </>
      )}
    </Dialog>
  );
}
