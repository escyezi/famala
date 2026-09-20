import { toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pool } from '../../shared/api-types.ts';
import { api, rpc } from '../api.ts';

export type CommitPoolStatus = (id: number, status: Pool['status']) => void;

export function usePools(poolId?: string) {
  const [pools, setPools] = useState<Pool[] | null>(null);
  const [error, setError] = useState<Message | null>(null);
  const [revision, setRevision] = useState(0);
  const [completed, setCompleted] = useState<{ poolId?: string; revision: number } | null>(null);
  const loading = completed?.poolId !== poolId || completed?.revision !== revision;
  const pending = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    pending.current = controller;
    const id = ++sequence.current;
    const isCurrent = () => !controller.signal.aborted && sequence.current === id;
    api(rpc.api.manage.pools.$get(undefined, { init: { signal: controller.signal } }))
      .then((result) => {
        if (!isCurrent()) return;
        setPools(result.items);
        setError(null);
      })
      .catch((error: Error) => {
        if (isCurrent()) setError(toMessage(error));
      })
      .finally(() => {
        if (isCurrent()) setCompleted({ poolId, revision });
      });
    return () => {
      controller.abort();
      if (pending.current === controller) pending.current = null;
    };
  }, [poolId, revision]);

  const refresh = useCallback(() => {
    setError(null);
    setRevision((value) => value + 1);
  }, []);
  const removePool = useCallback((id: number) => {
    setPools((items) => items?.filter((pool) => pool.id !== id) ?? null);
    setError(null);
  }, []);
  const commitPoolStatus = useCallback<CommitPoolStatus>((id, status) => {
    // Cancel synchronously: an older list response must not undo this confirmed write
    // while the follow-up refresh is waiting for its effect to run.
    sequence.current++;
    pending.current?.abort();
    setPools(
      (items) => items?.map((pool) => (pool.id === id ? { ...pool, status } : pool)) ?? null,
    );
  }, []);
  return { pools, loading, error, refresh, removePool, commitPoolStatus };
}
