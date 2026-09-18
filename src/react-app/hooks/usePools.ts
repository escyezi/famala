import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useCallback, useEffect, useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { api, rpc } from '../api.ts';

export function usePools(poolId?: string) {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [error, setError] = useState<Message | null>(null);
  const [revision, setRevision] = useState(0);
  const [completed, setCompleted] = useState<{ poolId?: string; revision: number } | null>(null);
  const loading = completed?.poolId !== poolId || completed?.revision !== revision;
  useEffect(() => {
    const controller = new AbortController();
    api(rpc.api.manage.pools.$get(undefined, { init: { signal: controller.signal } }))
      .then((result) => {
        if (controller.signal.aborted) return;
        setPools(result.items);
        setError(null);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(toMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCompleted({ poolId, revision });
      });
    return () => controller.abort();
  }, [poolId, revision]);

  const refresh = useCallback(() => {
    setError(null);
    setRevision((value) => value + 1);
  }, []);
  const removePool = useCallback((id: number) => {
    setPools((items) => items?.filter((pool) => pool.id !== id) ?? null);
    setError(null);
  }, []);
  return { pools, loading, error, refresh, removePool };
}
