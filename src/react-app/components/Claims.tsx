import { MAX_REMARK_LENGTH } from '../../shared/contracts.ts';
import { useDialogRequest } from '../hooks/useDialogRequest.ts';
import { useFormat } from '../i18n/format.ts';
import { useTranslation } from 'react-i18next';
import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useEffect, useRef, useState } from 'react';
import { api, rpc, ApiError } from '../api.ts';
import { readRecords, saveClaim, subscribeRecords } from '../storage.ts';
import { normalizeRemark, codePointLength } from '../../shared/contracts.ts';
import type { ClaimRecord } from '../../shared/contracts.ts';
import { CopyButton, Dialog, Icon, Notice } from './ui.tsx';
import type { PublicConfig, PublicPool } from '../../shared/api-types.ts';
import { Turnstile } from './Turnstile.tsx';

function RecordCard({ record }: { record: ClaimRecord }) {
  const { dateTime } = useFormat();
  const { t } = useTranslation();
  return (
    <article className="record-card">
      <div className="record-head">
        <div>
          <h3>{record.poolName}</h3>
          <span className="muted small-text">
            {t('claim.claimedAt', { date: dateTime(record.claimedAt) })}
          </span>
        </div>
        <span className="status claimed">{t('common.claimed')}</span>
      </div>
      <div className="claimed-code">
        <code>{record.code}</code>
        <CopyButton value={record.code} label={t('common.copyCode')} />
      </div>
    </article>
  );
}
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(readRecords);
  useEffect(() => subscribeRecords(() => setSnapshot(readRecords())), []);
  return (
    <Dialog title={t('common.history')} onClose={onClose} wide>
      <p className="muted">{t('claim.historyHelp')}</p>
      <Notice kind="info">{snapshot.warning}</Notice>
      <div className="history-list">
        {snapshot.records.length ? (
          [...snapshot.records]
            .sort((a, b) => b.claimedAt - a.claimedAt)
            .map((record) => <RecordCard key={record.claimKey} record={record} />)
        ) : (
          <div className="empty-state">
            <Icon name="history" size={36} />
            <h3>{t('claim.noHistory')}</h3>
            <p>{t('claim.historyIntro')}</p>
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
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [error, setError] = useState<Message | null>(null);
  const startRequest = useDialogRequest();
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !key.trim()) return;
    const request = startRequest();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await api(rpc.api.claim.validate.$post({ json: { claimKey: key.trim() } }, request));
      if (request.isCurrent()) onValidated(key.trim());
    } catch (e) {
      if (request.isCurrent()) setError(toMessage(e));
    } finally {
      if (request.isCurrent()) setBusy(false);
      request.finish();
    }
  }
  return (
    <Dialog title={t('claim.title')} onClose={onClose} locked={busy}>
      <p className="muted">{t('claim.keyHelp')}</p>
      <Notice>{error}</Notice>
      <form onSubmit={submit}>
        <label htmlFor="claim-key">{t('claim.key')}</label>
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
            {t('common.cancel')}
          </button>
          <button className="button primary" disabled={busy || !key.trim()}>
            {busy ? t('claim.validating') : t('claim.continue')}
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function ClaimPage({ claimKey, onEnterKey }: { claimKey: string; onEnterKey: () => void }) {
  const { t } = useTranslation();
  const { dateTime } = useFormat();
  const [pool, setPool] = useState<PublicPool | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [snapshot, setSnapshot] = useState(readRecords);
  const [result, setResult] = useState<ClaimRecord | null>(null);
  const [remark, setRemark] = useState('');
  const [token, setToken] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<Message | null>(null);
  const [warning, setWarning] = useState<Message | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [poolMissing, setPoolMissing] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeRecords(() => setSnapshot(readRecords())), []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api(
        rpc.api.claim.validate.$post(
          { json: { claimKey } },
          { init: { signal: controller.signal } },
        ),
      ),
      api(rpc.api.config.$get(undefined, { init: { signal: controller.signal } })),
    ])
      .then(([p, conf]) => {
        if (controller.signal.aborted) return;
        setPool(p);
        setPoolMissing(false);
        setConfig(conf);
        setError(null);
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          if (e instanceof ApiError && e.status === 404) {
            setPool(null);
            setPoolMissing(true);
          }
          setError(toMessage(e));
          setLoaded(true);
        }
      });
    return () => controller.abort();
  }, [claimKey, revision]);
  const record = result ?? snapshot.records.find((r) => r.claimKey === claimKey);
  const available = pool?.status === 'active' && pool.remaining > 0;
  const distributionState = pool?.status === 'stopped' ? 'stopped' : available ? 'active' : 'empty';
  const distributionLabel = {
    stopped: t('manage.stop'),
    active: t('claim.active'),
    empty: t('claim.empty'),
  }[distributionState];
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
      setError(toMessage(e));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const claimed = await api(
        rpc.api.claim.$post({
          json: {
            claimKey,
            remark,
            turnstileToken: token,
          },
        }),
      );
      setResult(claimed);
      setWarning(await saveClaim(claimed));
    } catch (e) {
      setError(toMessage(e));
      if (e instanceof ApiError && e.code === 'POOL_STOPPED')
        setPool((p) => p && { ...p, status: 'stopped' });
      if (e instanceof ApiError && e.code === 'POOL_EMPTY')
        setPool((p) => p && { ...p, remaining: 0 });
      if (e instanceof ApiError && e.status === 404) {
        setPool(null);
        setPoolMissing(true);
      }
    } finally {
      setToken('');
      setAttempt((v) => v + 1);
      setBusy(false);
      submitting.current = false;
    }
  }
  const description = pool?.description ? (
    <section className="claim-description" aria-label={t('claim.description')}>
      <h2>{t('claim.description')}</h2>
      <p>{pool.description}</p>
    </section>
  ) : null;
  return (
    <main className="claim-main">
      <article className="claim-card">
        <header className="claim-intro">
          <span className="claim-hero-icon">
            <Icon name={record ? 'check' : 'gift'} size={23} />
          </span>
          <h1 aria-live="polite">
            {record ? t('claim.success') : (pool?.name ?? t('claim.submit'))}
          </h1>
          {record ? (
            <p className="claim-pool-name">{pool?.name ?? record.poolName}</p>
          ) : pool ? (
            <div className={`claim-distribution ${distributionState}`} role="status">
              <span className="claim-status-dot" aria-hidden="true" />
              {distributionLabel}
            </div>
          ) : null}
        </header>
        <Notice>{error}</Notice>
        <Notice kind="info">{warning || snapshot.warning}</Notice>
        {record ? (
          <div className="claim-result" key={`${record.claimKey}:${record.code}`}>
            <div className="claim-result-code">
              <span>{t('claim.yourCode')}</span>
              <code className={codePointLength(record.code) > 32 ? 'claim-long-code' : undefined}>
                {record.code}
              </code>
            </div>
            <p className="claim-time">
              {t('claim.claimedAt', { date: dateTime(record.claimedAt) })}
            </p>
            <CopyButton
              value={record.code}
              label={t('common.copyCode')}
              className="button primary full claim-copy-button"
            />
            <p className="claim-footnote">
              <Icon name="history" size={14} />
              <span>{t('claim.saveWarning')}</span>
            </p>
            {description}
          </div>
        ) : !loaded ? (
          <div className="empty-state">{t('claim.loading')}</div>
        ) : !pool ? (
          <div className="claim-unavailable">
            {!poolMissing && <p>{t('claim.loadFailed')}</p>}
            <div className="actions">
              <button className="button secondary" onClick={() => setRevision((v) => v + 1)}>
                {t('common.retry')}
              </button>
              <button className="button primary" onClick={onEnterKey}>
                {t('claim.enterAgain')}
              </button>
            </div>
          </div>
        ) : (
          <div className="claim-form-panel">
            {description}
            <form onSubmit={claim}>
              <label htmlFor="remark">
                {t('claim.remark')}
                <span className="muted">
                  {t('claim.optionalCount', { limit: MAX_REMARK_LENGTH, count: length })}
                </span>
              </label>
              <textarea
                id="remark"
                rows={2}
                placeholder={t('claim.remarkPlaceholder')}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                disabled={busy}
              />
              {length > MAX_REMARK_LENGTH && (
                <Notice>{t('claim.remarkTooLong', { limit: MAX_REMARK_LENGTH })}</Notice>
              )}
              {available && config?.turnstileSiteKey && (
                <Turnstile
                  busy={busy}
                  key={attempt}
                  siteKey={config.turnstileSiteKey}
                  onToken={setToken}
                />
              )}
              {available && config && !config.turnstileSiteKey && (
                <Notice>{t('claim.unconfigured')}</Notice>
              )}
              <button
                className="button primary full claim-button"
                disabled={!available || !token || busy || length > MAX_REMARK_LENGTH}
                aria-busy={busy}
              >
                {busy && <span className="claim-spinner" aria-hidden="true" />}
                {busy ? t('claim.claiming') : t('claim.submit')}
                {available && !busy && <Icon name="arrow" size={18} />}
              </button>
            </form>
            {!available && (
              <button className="text-button full" onClick={() => setRevision((v) => v + 1)}>
                {t('claim.refresh')}
              </button>
            )}
            <p className="claim-footnote">
              <Icon name="history" size={14} />
              <span>{t('claim.saveNote')}</span>
            </p>
          </div>
        )}
      </article>
    </main>
  );
}
