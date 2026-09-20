import { useEffect, useRef } from 'react';

// Dialog writes can outlive browser navigation. Give each effect setup its own
// cancellation scope so late responses cannot publish results or expire a new session.
export function useDialogRequest({ abortOnUnmount = true } = {}) {
  const lifetime = useRef<{ active: boolean; request: AbortController | null } | null>(null);
  useEffect(() => {
    const scope = { active: true, request: null as AbortController | null };
    lifetime.current = scope;
    return () => {
      scope.active = false;
      if (abortOnUnmount) scope.request?.abort();
    };
  }, [abortOnUnmount]);
  return () => {
    const scope = lifetime.current;
    if (!scope?.active || scope.request) return null;
    const controller = new AbortController();
    scope.request = controller;
    return {
      init: { signal: controller.signal },
      isCurrent: () => scope.active && lifetime.current === scope && !controller.signal.aborted,
      finish: () => {
        if (scope.request === controller) scope.request = null;
      },
    };
  };
}
