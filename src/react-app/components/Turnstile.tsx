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
  const [verified, setVerified] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    const timeout = setTimeout(() => {
      if (!cancelled) setError('人机验证等待时间较长，请重试');
    }, 20000);
    function fail(message: string) {
      if (cancelled) return;
      clearTimeout(timeout);
      callback.current('');
      setVerified(false);
      setError(message);
    }
    loadScript()
      .then(() => {
        if (cancelled || !container.current) return;
        if (!window.turnstile) {
          loading = undefined;
          throw new Error('验证组件未就绪，请重试');
        }
        widget = window.turnstile.render(container.current, {
          sitekey: siteKey,
          action: 'claim',
          theme: 'light',
          size: 'flexible',
          language: 'zh-cn',
          'response-field': false,
          callback: (token: string) => {
            if (!cancelled) {
              clearTimeout(timeout);
              setError('');
              setVerified(true);
              callback.current(token);
            }
          },
          'expired-callback': () => {
            fail('验证已过期，请重新验证');
          },
          'error-callback': (code: string) => {
            if (!cancelled) {
              console.warn('Turnstile verification failed:', code);
              fail('人机验证失败，请重新验证');
            }
            return true;
          },
          'timeout-callback': () => {
            fail('验证超时，请重新验证');
          },
          'unsupported-callback': () => fail('当前浏览器不支持人机验证，请使用其他浏览器打开'),
        });
      })
      .catch((e: Error) => {
        fail(e.message);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, attempt]);
  return (
    <div className="turnstile">
      <div ref={container} />
      {!verified && !error && (
        <p className="field-help" role="status">
          正在进行人机验证，通过后即可领取…
        </p>
      )}
      {error && (
        <>
          <Notice>{error}</Notice>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              callback.current('');
              setVerified(false);
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
