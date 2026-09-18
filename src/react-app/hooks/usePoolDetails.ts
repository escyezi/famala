import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useEffect, useState } from 'react';
import type { CodeFilter, CodePage, CodePageSize, Pool } from '../../shared/api-types.ts';
import { api, rpc } from '../api.ts';

export function usePoolDetails(pool: Pool, onRefresh: () => void) {
  const [query, setQuery] = useState({
    page: 1,
    filter: 'all' as CodeFilter,
    pageSize: '20' as CodePageSize,
    revision: 0,
  });
  const [codes, setCodes] = useState<CodePage | null>(null);
  const [codesError, setCodesError] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);
  const { page, filter, pageSize, revision } = query;

  useEffect(() => {
    const controller = new AbortController();
    api(
      rpc.api.manage.pools[':id'].codes.$get(
        { param: { id: String(pool.id) }, query: { page: String(page), status: filter, pageSize } },
        { init: { signal: controller.signal } },
      ),
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setCodes(result);
        setCodesError(null);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setCodesError(toMessage(error));
      });
    return () => controller.abort();
  }, [pool.id, page, filter, pageSize, revision]);

  function updateQuery(next: Partial<Pick<typeof query, 'page' | 'filter' | 'pageSize'>> = {}) {
    setCodes(null);
    setCodesError(null);
    setQuery((current) => ({ ...current, ...next, revision: current.revision + 1 }));
  }
  function refresh() {
    setError(null);
    updateQuery();
    onRefresh();
  }
  function imported() {
    setError(null);
    updateQuery({ page: 1 });
    onRefresh();
  }
  async function status() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        rpc.api.manage.pools[':id'].status.$post({
          param: { id: String(pool.id) },
          json: { status: pool.status === 'active' ? 'stopped' : 'active' },
        }),
      );
      refresh();
    } catch (error) {
      setError(toMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    codes,
    codesError,
    page,
    pageSize,
    filter,
    busy,
    error,
    refresh,
    imported,
    status,
    changePage: (page: number) => updateQuery({ page }),
    changeFilter: (filter: CodeFilter) => updateQuery({ filter, page: 1 }),
    changePageSize: (pageSize: CodePageSize) => updateQuery({ pageSize, page: 1 }),
  };
}
