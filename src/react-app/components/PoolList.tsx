import { useFormat } from '../i18n/format.ts';
import { useTranslation } from 'react-i18next';
import type { Message } from '../../shared/messages.ts';
import { useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { CopyButton, Icon, Notice } from './ui.tsx';
import { ImportDialog, PoolNameDialog } from './PoolDialogs.tsx';
import { ExportDialog } from './ExportDialog.tsx';

const poolFilters = ['all', 'active', 'pending', 'exhausted', 'stopped'] as const;
type PoolFilter = (typeof poolFilters)[number];

function poolStatus(pool: Pool): Exclude<PoolFilter, 'all'> {
  if (pool.status === 'stopped') return 'stopped';
  if (pool.total === 0) return 'pending';
  return pool.remaining > 0 ? 'active' : 'exhausted';
}

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
  const [exporting, setExporting] = useState(false);
  const [importingPool, setImportingPool] = useState<Pick<Pool, 'id' | 'name'> | null>(null);
  const [filter, setFilter] = useState<PoolFilter>('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const counts: Record<PoolFilter, number> = {
    all: pools?.length ?? 0,
    active: 0,
    pending: 0,
    exhausted: 0,
    stopped: 0,
  };
  for (const pool of pools ?? []) counts[poolStatus(pool)]++;
  const filteredPools = pools?.filter(
    (pool) =>
      (filter === 'all' || poolStatus(pool) === filter) &&
      pool.name.toLocaleLowerCase().includes(query),
  );
  const labels = {
    all: t('manage.all'),
    active: t('manage.active'),
    pending: t('manage.pending'),
    exhausted: t('manage.empty'),
    stopped: t('manage.stopped'),
  };
  return (
    <div className="pool-list-page">
      <header className="pool-list-heading">
        <h1>
          {t('manage.myPools')}
          <span className="pool-list-count">{pools ? number(pools.length) : '—'}</span>
        </h1>
        <div className="actions">
          <button
            className="button secondary"
            disabled={!pools || !pools.length}
            onClick={() => setExporting(true)}
          >
            {t('exports.allPools')}
          </button>
          <button
            type="button"
            className="text-button refresh-button"
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            onClick={onRefresh}
          >
            <Icon name="refresh" size={18} />
          </button>
          <button
            className="button primary"
            aria-label={t('manage.create')}
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" size={16} />
            {t('manage.createShort')}
          </button>
        </div>
      </header>
      <Notice>{error}</Notice>
      <div className="pool-list-toolbar">
        <div className="pool-filters" role="group" aria-label={t('manage.filterPools')}>
          {poolFilters
            .filter((value) => value === 'all' || counts[value] > 0 || value === filter)
            .map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                disabled={!pools}
                onClick={() => setFilter(value)}
              >
                {labels[value]} <span>{number(counts[value])}</span>
              </button>
            ))}
        </div>
        <div className="pool-search">
          <Icon name="search" size={17} />
          <input
            type="search"
            aria-label={t('manage.searchPools')}
            placeholder={t('manage.searchPools')}
            value={search}
            disabled={!pools}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <div
        className="pool-list-scroll"
        role="region"
        aria-label={t('manage.poolList')}
        tabIndex={0}
        key={`${filter}-${query}`}
      >
        {!pools ? (
          <div className="empty-state">
            {error ? t('manage.loadFailed') : t('manage.loadingPools')}
          </div>
        ) : pools.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">
              <Icon name="box" size={32} />
            </span>
            <h2>{t('manage.firstPool')}</h2>
            <button className="button secondary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
              {t('manage.create')}
            </button>
          </div>
        ) : !filteredPools?.length ? (
          <div className="empty-state">
            <p>{t('manage.noMatchingPools')}</p>
            <button
              className="text-button"
              onClick={() => {
                setSearch('');
                setFilter('all');
              }}
            >
              {t('manage.clearPoolFilters')}
            </button>
          </div>
        ) : (
          <table className="pool-list-table" aria-label={t('manage.myPools')}>
            <thead>
              <tr>
                <th scope="col">{t('manage.poolNameCreated')}</th>
                <th scope="col">{t('manage.codeStatus')}</th>
                <th scope="col" className="pool-remaining-cell">
                  {t('manage.remaining')}
                </th>
                <th scope="col">{t('manage.claimedTotal')}</th>
                <th scope="col" className="pool-actions-heading">
                  {t('manage.codeActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredPools.map((pool) => {
                const status = poolStatus(pool);
                return (
                  <tr key={pool.id}>
                    <td className="pool-name-cell">
                      <a
                        className="pool-row-link"
                        href={`/manage/pools/${pool.id}`}
                        onClick={(event) => {
                          if (
                            event.button !== 0 ||
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.altKey
                          )
                            return;
                          event.preventDefault();
                          onNavigate(`/manage/pools/${pool.id}`);
                        }}
                      >
                        <h2 title={pool.name}>{pool.name}</h2>
                        <time dateTime={new Date(pool.createdAt).toISOString()}>
                          {dateTime(pool.createdAt)}
                        </time>
                      </a>
                    </td>
                    <td className="pool-status-cell">
                      <span className={`pool-row-status ${status}`}>{labels[status]}</span>
                    </td>
                    <td className="pool-remaining-cell">
                      <span className="pool-mobile-label">{t('manage.remaining')}</span>
                      <strong>{number(pool.remaining)}</strong>
                    </td>
                    <td className="pool-claimed-cell">
                      <span className="pool-mobile-label">{t('manage.claimedShort')}</span>
                      <span className="pool-claimed-value">
                        {number(pool.claimed)} <span className="muted">/ {number(pool.total)}</span>
                      </span>
                      <div className="pool-row-progress" aria-hidden="true">
                        <span
                          style={{
                            width: `${pool.total ? (pool.claimed / pool.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="pool-row-actions">
                      <div>
                        <button
                          className="text-button"
                          aria-label={t('manage.import')}
                          onClick={() => setImportingPool(pool)}
                        >
                          {t('manage.importShort')}
                        </button>
                        <CopyButton
                          value={`${location.origin}/claim?key=${encodeURIComponent(pool.claimKey)}`}
                          label={t('manage.copyLink')}
                          className="text-button pool-copy-button"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {pools && (
        <p className="pool-list-summary" role="status">
          {t('manage.poolResults', { shown: filteredPools?.length ?? 0, total: pools.length })}
        </p>
      )}

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
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
    </div>
  );
}
