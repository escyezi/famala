import { useEffect, useRef, useState } from 'react';
import { Notice } from './ui.tsx';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}
let loading: Promise<void> | undefined;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (!loading)
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      const timeout = setTimeout(() => {
        script.remove();
        loading = undefined;
        reject(new Error('验证组件加载超时，请重试'));
      }, 15000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        loading = undefined;
        reject(new Error('验证组件加载失败，请检查网络后重试'));
      };
      document.head.appendChild(script);
    });
  return loading;
}
export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widget = window.turnstile.render(container.current, {
          sitekey: siteKey,
          action: 'claim',
          theme: 'light',
          size: 'flexible',
          language: 'zh-cn',
          'response-field': false,
          callback: (token: string) => {
            if (!cancelled) {
              setError('');
              callback.current(token);
            }
          },
          'expired-callback': () => {
            if (!cancelled) {
              callback.current('');
              setError('验证已过期，请重新验证');
            }
          },
          'error-callback': () => {
            if (!cancelled) {
              callback.current('');
              setError('人机验证失败，请重新验证');
            }
            return true;
          },
          'timeout-callback': () => {
            if (!cancelled) {
              callback.current('');
              setError('验证超时，请重新验证');
            }
          },
        });
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, attempt]);
  return (
    <div className="turnstile">
      <div ref={container} />
      {error && (
        <>
          <Notice>{error}</Notice>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              callback.current('');
              setError('');
              setAttempt((v) => v + 1);
            }}
          >
            重新验证
          </button>
        </>
      )}
    </div>
  );
}
