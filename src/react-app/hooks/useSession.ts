import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/api-types.ts';
import { ApiError, api, readSession, rpc } from '../api.ts';

// App owns the session; navigation and pool refreshes do not re-fetch it.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const pending = useRef<AbortController | null>(null);

  const acceptSession = useCallback((value: Session | null) => {
    pending.current?.abort();
    setSession(value);
    setLoading(false);
    setError('');
  }, []);

  const loadSession = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    return readSession(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSession(value);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSession(null);
        if (!(error instanceof ApiError && error.status === 401))
          setError((error as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    return loadSession();
  }, [loadSession]);

  useEffect(() => {
    void loadSession();
    return () => pending.current?.abort();
  }, [loadSession]);

  async function logout() {
    if (loggingOut) return false;
    setLoggingOut(true);
    setError('');
    try {
      await api(rpc.api.manage.logout.$post());
      acceptSession(null);
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setLoggingOut(false);
    }
  }

  return { session, loading, error, loggingOut, acceptSession, reload, logout };
}
