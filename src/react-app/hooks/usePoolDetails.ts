import { toMessage } from '../../shared/messages.ts';
import { useCallback, useEffect, useRef, useReducer } from 'react';
import type { CodeFilter, CodePageSize, Pool } from '../../shared/api-types.ts';
import { api, rpc } from '../api.ts';
import type { CommitPoolStatus } from './usePools.ts';

import { initialQuery, initialState, recordsReducer } from './pool-details-state.ts';
import type { RecordsQuery, RecordsAction } from './pool-details-state.ts';
import { queryKey, readCache, saveCache } from './pool-details-cache.ts';
import type { RecordsCache } from './pool-details-cache.ts';
export type { RecordsQuery } from './pool-details-state.ts';
type Lifetime = { active: boolean };

export function usePoolDetails(
  pool: Pool,
  onRefresh: () => void,
  onStatusCommitted: CommitPoolStatus,
) {
  const [state, reactDispatch] = useReducer(recordsReducer, initialState);
  // Event-batch reads use the same reducer transition synchronously. The operation
  // ref below remains the single lock shared by list reads and status writes.
  const currentState = useRef(initialState);
  const dispatch = useCallback((action: RecordsAction) => {
    currentState.current = recordsReducer(currentState.current, action);
    reactDispatch(action);
  }, []);
  const cache = useRef<RecordsCache>(new Map());
  // This ref is also the synchronous lock, including within a single React event batch.
  const operation = useRef<{
    controller: AbortController;
    sequence: number;
    scope: Lifetime;
  } | null>(null);
  const lifetime = useRef<Lifetime | null>(null);
  const sequence = useRef(0);
  const generation = useRef(0);
  const { busy, error } = state;

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
      const cached = readCache(cache.current, query, Date.now());
      cache.current = cached.cache;
      dispatch({ type: 'load', query, cached: cached.snapshot, invalidate });
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
            cache.current = saveCache(cache.current, snapshot, Date.now());
            dispatch({ type: 'loaded', snapshot });
            return;
          }
        } catch (error) {
          if (isCurrent()) {
            dispatch({ type: 'failed', query, error: toMessage(error) });
          }
        } finally {
          if (isCurrent()) operation.current = null;
        }
      })();
    },
    [pool.id, dispatch],
  );

  useEffect(() => {
    const scope = { active: true };
    lifetime.current = scope;
    dispatch({ type: 'reset' });
    load(initialQuery, scope);
    return () => {
      scope.active = false;
      if (operation.current?.scope === scope) {
        operation.current.controller.abort();
        operation.current = null;
      }
      cache.current.clear();
    };
  }, [load, dispatch]);

  // Callbacks retain the lifecycle in which they were created, not just a mounted boolean.
  const scope = lifetime.current;
  const isActive = () => !!scope?.active && lifetime.current === scope;
  const canStart = () => isActive() && !operation.current;
  const currentQuery = () => currentState.current.displayedSnapshot?.query ?? initialQuery;
  const displayedQuery = state.displayedSnapshot?.query ?? initialQuery;
  function changeQuery(query: RecordsQuery) {
    if (!canStart()) return;
    if (
      queryKey(query) === queryKey(currentQuery()) &&
      currentState.current.displayedSnapshot &&
      !currentState.current.failedQuery
    )
      return;
    load(query, scope!);
  }
  function refreshAfterMutation(firstPage = false) {
    if (!isActive()) return;
    dispatch({ type: 'clearError' });
    const query = currentQuery();
    load(firstPage ? { ...query, page: 1 } : query, scope!, true);
    onRefresh();
  }
  function refresh() {
    if (!canStart()) return;
    refreshAfterMutation();
  }
  async function toggleStatus() {
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
    dispatch({ type: 'write' });
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
      if (isCurrent()) dispatch({ type: 'writeFailed', error: toMessage(error) });
    } finally {
      // A successful write transfers ownership to load; it must not unlock that read.
      if (isCurrent()) {
        operation.current = null;
        dispatch({ type: 'writeFinished' });
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
    status: toggleStatus,
    isActive,
    refreshAfterMutation: () => refreshAfterMutation(),
    imported: () => refreshAfterMutation(true),
    retry: () => {
      if (canStart()) load(currentState.current.failedQuery ?? currentQuery(), scope!);
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
