import { useDialogRequest } from '../hooks/useDialogRequest.ts';
import { useTranslation } from 'react-i18next';
import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useState } from 'react';
import { api, rpc, SESSION_CHANGED_EVENT } from '../api.ts';
import type { Session } from '../../shared/api-types.ts';
import { CopyButton, Dialog, Icon, Notice } from './ui.tsx';

export function AuthDialog({
  onClose,
  onDone,
  onCreated,
}: {
  onClose: () => void;
  onDone: (session: Session) => void;
  onCreated: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'choose' | 'login'>('choose');
  const [key, setKey] = useState('');
  const startRequest = useDialogRequest({ abortOnUnmount: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  async function create() {
    if (busy) return;
    const request = startRequest();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(rpc.api.spaces.$post(undefined, request));
      // The key is returned only once. Hand it to App even if navigation has
      // unmounted this dialog; App owns its lifetime until the user saves it.
      onCreated(result.key);
    } catch (e) {
      if (request.isCurrent()) setError(toMessage(e));
    } finally {
      if (request.isCurrent()) setBusy(false);
      // Cookie writes are not rolled back by navigation. Reconcile the current
      // session after settlement, without publishing this dialog's old UI callback.
      if (!request.isCurrent()) window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
      request.finish();
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !key.trim()) return;
    const request = startRequest();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api(rpc.api.login.$post({ json: { key: key.trim() } }, request));
      if (request.isCurrent()) onDone(session);
    } catch (e) {
      if (request.isCurrent()) setError(toMessage(e));
    } finally {
      if (request.isCurrent()) setBusy(false);
      // Cookie writes are not rolled back by navigation. Reconcile the current
      // session after settlement, without publishing this dialog's old UI callback.
      if (!request.isCurrent()) window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
      request.finish();
    }
  }
  return (
    <Dialog title={t('auth.start')} onClose={onClose} locked={busy}>
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
    </Dialog>
  );
}

export function SaveKeyDialog({ value, onSaved }: { value: string; onSaved: () => void }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  return (
    <Dialog title={t('auth.saveKey')} onClose={() => {}} locked>
      <p className="muted">{t('auth.onlyCredential')}</p>
      <div className="secret-box">
        <code>{value}</code>
        <CopyButton value={value} label={t('auth.copyKey')} />
      </div>
      <Notice kind="info">{t('auth.keepSafe')}</Notice>
      <label className="checkbox-label">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('auth.saved')}
      </label>
      <button className="button primary full" disabled={!saved} onClick={onSaved}>
        {t('auth.enter')}
        <Icon name="arrow" size={17} />
      </button>
    </Dialog>
  );
}
