import { useCallback, useEffect, useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { api, rpc } from '../api.ts';

export function usePools(poolId?: string) {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [completed, setCompleted] = useState<{ poolId?: string; revision: number } | null>(null);
  const loading = completed?.poolId !== poolId || completed?.revision !== revision;
  useEffect(() => {
    const controller = new AbortController();
    api(rpc.api.manage.pools.$get(undefined, { init: { signal: controller.signal } }))
      .then((result) => {
        if (controller.signal.aborted) return;
        setPools(result.items);
        setError('');
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCompleted({ poolId, revision });
      });
    return () => controller.abort();
  }, [poolId, revision]);

  const refresh = useCallback(() => {
    setError('');
    setRevision((value) => value + 1);
  }, []);
  return { pools, loading, error, refresh };
}
