import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodeFilter, CodePage, CodePageSize, Pool } from '../../shared/api-types.ts';
import { api, rpc } from '../api.ts';
import type { CommitPoolStatus } from './usePools.ts';

export type RecordsQuery = { page: number; filter: CodeFilter; pageSize: CodePageSize };
type Snapshot = { query: RecordsQuery; data: CodePage };
type Lifetime = { active: boolean };
type RecordsState = {
  displayedSnapshot: Snapshot | null;
  requestedQuery: RecordsQuery;
  pending: boolean;
  failedQuery: RecordsQuery | null;
  codesError: Message | null;
  invalidated: boolean;
  selectionRevision: number;
};
const initialQuery: RecordsQuery = { page: 1, filter: 'all', pageSize: '20' };
const queryKey = (query: RecordsQuery) => `${query.filter}:${query.page}:${query.pageSize}`;
const CACHE_TTL = 60_000;
const CACHE_LIMIT = 20;

export function usePoolDetails(
  pool: Pool,
  onRefresh: () => void,
  onStatusCommitted: CommitPoolStatus,
) {
  const [state, setState] = useState<RecordsState>({
    displayedSnapshot: null,
    requestedQuery: initialQuery,
    pending: true,
    failedQuery: null,
    codesError: null,
    invalidated: false,
    selectionRevision: 0,
  });
  const cache = useRef(new Map<string, { snapshot: Snapshot; savedAt: number }>());
  // This ref is also the synchronous lock, including within a single React event batch.
  const operation = useRef<{
    controller: AbortController;
    sequence: number;
    scope: Lifetime;
  } | null>(null);
  const lifetime = useRef<Lifetime | null>(null);
  const committed = useRef<Snapshot | null>(null);
  const failed = useRef<RecordsQuery | null>(null);
  const sequence = useRef(0);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Message | null>(null);

  const load = useCallback(
    (query: RecordsQuery, scope: Lifetime, invalidate = false) => {
      if (!scope.active || lifetime.current !== scope) return;
      operation.current?.controller.abort();
      const controller = new AbortController();
      const id = ++sequence.current;
      operation.current = { controller, sequence: id, scope };
      if (invalidate) {
        generation.current++;
        cache.current.clear();
      }
      const epoch = generation.current;
      const key = queryKey(query);
      const cached = cache.current.get(key);
      const usable = cached && Date.now() - cached.savedAt < CACHE_TTL ? cached : null;
      if (cached) cache.current.delete(key);
      if (usable) {
        cache.current.set(key, usable);
        committed.current = usable.snapshot;
      }
      failed.current = null;
      setBusy(false);
      setState((current) => ({
        ...current,
        requestedQuery: query,
        pending: true,
        failedQuery: null,
        codesError: null,
        selectionRevision: current.selectionRevision + 1,
        invalidated: current.invalidated || invalidate,
        displayedSnapshot: usable?.snapshot ?? current.displayedSnapshot,
      }));
      const isCurrent = () =>
        scope.active &&
        lifetime.current === scope &&
        !controller.signal.aborted &&
        sequence.current === id &&
        generation.current === epoch;
      void (async () => {
        try {
          let target = query;
          // Deletions can shrink several pages while this request is in flight.
          while (isCurrent()) {
            const data = await api(
              rpc.api.manage.pools[':id'].codes.$get(
                {
                  param: { id: String(pool.id) },
                  query: {
                    page: String(target.page),
                    status: target.filter,
                    pageSize: target.pageSize,
                  },
                },
                { init: { signal: controller.signal } },
              ),
            );
            if (!isCurrent()) return;
            const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
            if (target.page > lastPage) {
              target = { ...target, page: lastPage };
              continue;
            }
            const snapshot = { query: target, data };
            const targetKey = queryKey(target);
            cache.current.delete(targetKey);
            cache.current.set(targetKey, { snapshot, savedAt: Date.now() });
            while (cache.current.size > CACHE_LIMIT)
              cache.current.delete(cache.current.keys().next().value!);
            committed.current = snapshot;
            setState((current) => ({
              ...current,
              displayedSnapshot: snapshot,
              requestedQuery: target,
              pending: false,
              invalidated: false,
              failedQuery: null,
              codesError: null,
            }));
            return;
          }
        } catch (error) {
          if (isCurrent()) {
            failed.current = query;
            setState((current) => ({
              ...current,
              pending: false,
              failedQuery: query,
              codesError: toMessage(error),
            }));
          }
        } finally {
          if (isCurrent()) operation.current = null;
        }
      })();
    },
    [pool.id],
  );

  useEffect(() => {
    const scope = { active: true };
    lifetime.current = scope;
    committed.current = null;
    failed.current = null;
    setState((current) => ({ ...current, displayedSnapshot: null, invalidated: false }));
    setError(null);
    load(initialQuery, scope);
    const entries = cache.current;
    return () => {
      scope.active = false;
      if (operation.current?.scope === scope) {
        operation.current.controller.abort();
        operation.current = null;
      }
      entries.clear();
    };
  }, [load]);

  // Callbacks retain the lifecycle in which they were created, not just a mounted boolean.
  const scope = lifetime.current;
  const isActive = () => !!scope?.active && lifetime.current === scope;
  const canStart = () => isActive() && !operation.current;
  const currentQuery = () => committed.current?.query ?? initialQuery;
  const displayedQuery = state.displayedSnapshot?.query ?? initialQuery;
  function changeQuery(query: RecordsQuery) {
    if (!canStart()) return;
    if (queryKey(query) === queryKey(currentQuery()) && committed.current && !failed.current)
      return;
    load(query, scope!);
  }
  function refreshAfterMutation(firstPage = false) {
    if (!isActive()) return;
    setError(null);
    const query = currentQuery();
    load(firstPage ? { ...query, page: 1 } : query, scope!, true);
    onRefresh();
  }
  function refresh() {
    if (!canStart()) return;
    refreshAfterMutation();
  }
  async function status() {
    if (!canStart()) return;
    const controller = new AbortController();
    const id = ++sequence.current;
    const epoch = generation.current;
    operation.current = { controller, sequence: id, scope: scope! };
    const isCurrent = () =>
      isActive() &&
      !controller.signal.aborted &&
      sequence.current === id &&
      generation.current === epoch;
    setBusy(true);
    setError(null);
    setState((current) => ({ ...current, selectionRevision: current.selectionRevision + 1 }));
    try {
      const updated = await api(
        rpc.api.manage.pools[':id'].status.$post(
          {
            param: { id: String(pool.id) },
            json: { status: pool.status === 'active' ? 'stopped' : 'active' },
          },
          { init: { signal: controller.signal } },
        ),
      );
      if (isCurrent()) {
        onStatusCommitted(pool.id, updated.status);
        refreshAfterMutation();
      }
    } catch (error) {
      if (isCurrent()) setError(toMessage(error));
    } finally {
      // A successful write transfers ownership to load; it must not unlock that read.
      if (isCurrent()) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const controlsLocked = state.pending || busy;
  return {
    ...state,
    ...displayedQuery,
    codes: state.displayedSnapshot?.data ?? null,
    controlsLocked,
    actionsDisabled: controlsLocked || state.invalidated || !state.displayedSnapshot,
    busy,
    error,
    refresh,
    status,
    isActive,
    refreshAfterMutation: () => refreshAfterMutation(),
    imported: () => refreshAfterMutation(true),
    retry: () => {
      if (canStart()) load(failed.current ?? currentQuery(), scope!);
    },
    changePage: (page: number) => changeQuery({ ...currentQuery(), page }),
    changeFilter: (filter: CodeFilter) =>
      changeQuery({
        ...currentQuery(),
        filter,
        page: filter === currentQuery().filter ? currentQuery().page : 1,
      }),
    changePageSize: (pageSize: CodePageSize) =>
      changeQuery({ ...currentQuery(), pageSize, page: 1 }),
  };
}
export type PoolDetails = ReturnType<typeof usePoolDetails>;
