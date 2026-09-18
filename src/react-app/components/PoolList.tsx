import { useFormat } from '../i18n/format.ts';
import { useTranslation, Trans } from 'react-i18next';
import type { Message } from '../../shared/messages.ts';
import { useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { CopyButton, Icon, Notice } from './ui.tsx';
import { ImportDialog, PoolNameDialog } from './PoolDialogs.tsx';

export function PoolList({
  pools,
  error,
  onRefresh,
  onNavigate,
}: {
  pools: Pool[] | null;
  error: Message | null;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
}) {
  const { dateTime, number } = useFormat();
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [importingPool, setImportingPool] = useState<Pick<Pool, 'id' | 'name'> | null>(null);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('manage.eyebrow')}</div>
          <h1>{t('manage.workspace')}</h1>
          <p className="muted">{t('manage.workspaceHelp')}</p>
        </div>
        <div className="heading-actions">
          <button className="button primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} />
            {t('manage.create')}
          </button>
        </div>
      </div>
      <Notice>{error}</Notice>
      <div className="section-heading">
        <h2>
          {t('manage.myPools')}
          <span className="count-badge">{number(pools?.length ?? 0)}</span>
        </h2>
        <button
          type="button"
          className="text-button refresh-button"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          onClick={onRefresh}
        >
          <Icon name="refresh" size={18} />
        </button>
      </div>
      {!pools ? (
        <div className="empty-state">
          {error ? t('manage.loadFailed') : t('manage.loadingPools')}
        </div>
      ) : pools.length === 0 ? (
        <div className="empty-state bordered">
          <span className="empty-icon">
            <Icon name="box" size={32} />
          </span>
          <h3>{t('manage.firstPool')}</h3>
          <button className="button secondary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
            {t('manage.create')}
          </button>
        </div>
      ) : (
        <div className="pool-grid">
          {pools.map((p) => (
            <article className="pool-card" key={p.id} aria-labelledby={`pool-name-${p.id}`}>
              <a
                className="pool-card-main"
                href={`/manage/pools/${p.id}`}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onNavigate(`/manage/pools/${p.id}`);
                }}
              >
                <div className="pool-card-top">
                  <h3 id={`pool-name-${p.id}`} title={p.name}>
                    {p.name}
                  </h3>
                  <span
                    className={`status ${p.status === 'stopped' ? 'stopped' : p.total === 0 ? 'pending' : p.remaining > 0 ? 'active' : 'exhausted'}`}
                  >
                    {p.status === 'stopped'
                      ? t('manage.stopped')
                      : p.total === 0
                        ? t('manage.pending')
                        : p.remaining > 0
                          ? t('manage.active')
                          : t('manage.empty')}
                  </span>
                </div>
                <p>{t('common.createdAt', { date: dateTime(p.createdAt) })}</p>
                {p.total === 0 ? (
                  <div className="pool-card-empty">
                    <span>{t('manage.noCodes')}</span>
                    <small>
                      {p.status === 'stopped'
                        ? t('manage.resumeAfterImport')
                        : t('manage.shareAfterImport')}
                    </small>
                  </div>
                ) : (
                  <>
                    <div className="pool-progress">
                      <span style={{ width: `${(p.claimed / p.total) * 100}%` }} />
                    </div>
                    <div className="pool-counts">
                      <span>
                        <Trans
                          i18nKey="manage.claimedCount"
                          values={{ claimed: number(p.claimed), total: number(p.total) }}
                          components={{ b: <b /> }}
                        />
                      </span>
                      <span>
                        <Trans
                          i18nKey="manage.remainingCount"
                          values={{ remaining: number(p.remaining) }}
                          components={{ b: <b /> }}
                        />
                      </span>
                    </div>
                  </>
                )}
              </a>
              <div className="pool-card-actions">
                <button className="button primary small" onClick={() => setImportingPool(p)}>
                  <Icon name="plus" size={15} />
                  {t('manage.import')}
                </button>
                <CopyButton
                  value={`${location.origin}/claim?key=${encodeURIComponent(p.claimKey)}`}
                  label={t('manage.copyLink')}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {importingPool && (
        <ImportDialog
          pool={importingPool}
          onClose={() => setImportingPool(null)}
          onImported={onRefresh}
        />
      )}

      {creating && (
        <PoolNameDialog
          onClose={() => setCreating(false)}
          onImport={(pool) => {
            setCreating(false);
            setImportingPool(pool);
            onRefresh();
          }}
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
