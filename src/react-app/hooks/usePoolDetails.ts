import { useEffect, useState } from 'react';
import type { CodeFilter, CodePage, Pool } from '../../shared/api-types.ts';
import { api, rpc } from '../api.ts';

export function usePoolDetails(pool: Pool, onRefresh: () => void) {
  const [query, setQuery] = useState({ page: 1, filter: 'all' as CodeFilter, revision: 0 });
  const [codes, setCodes] = useState<CodePage | null>(null);
  const [codesError, setCodesError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { page, filter, revision } = query;

  useEffect(() => {
    const controller = new AbortController();
    api(
      rpc.api.manage.pools[':id'].codes.$get(
        { param: { id: pool.id }, query: { page: String(page), status: filter } },
        { init: { signal: controller.signal } },
      ),
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setCodes(result);
        setCodesError('');
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setCodesError(error.message);
      });
    return () => controller.abort();
  }, [pool.id, page, filter, revision]);

  function updateQuery(next: Partial<Pick<typeof query, 'page' | 'filter'>> = {}) {
    setCodes(null);
    setCodesError('');
    setQuery((current) => ({ ...current, ...next, revision: current.revision + 1 }));
  }
  function refresh() {
    setError('');
    updateQuery();
    onRefresh();
  }
  function imported() {
    setError('');
    updateQuery({ page: 1 });
    onRefresh();
  }
  async function status() {
    if (busy) return;
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
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {
    codes,
    codesError,
    page,
    filter,
    busy,
    error,
    refresh,
    imported,
    status,
    changePage: (page: number) => updateQuery({ page }),
    changeFilter: (filter: CodeFilter) => updateQuery({ filter, page: 1 }),
  };
}
