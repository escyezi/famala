import { useTranslation } from 'react-i18next';
import { BusinessError, toMessage } from '../../shared/messages.ts';
import type { Message } from '../../shared/messages.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
        reject(new BusinessError('WIDGET_LOAD_TIMEOUT'));
      }, 15000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        loading = undefined;
        reject(new BusinessError('WIDGET_LOAD_FAILED'));
      };
      document.head.appendChild(script);
    });
  return loading;
}
export function Turnstile({
  siteKey,
  onToken,
  busy = false,
}: {
  siteKey: string;
  busy?: boolean;
  onToken: (token: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'zh-cn';
  const [language, setLanguage] = useState(locale);
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  const [error, setError] = useState<Message | null>(null);
  const [verified, setVerified] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Freeze widget configuration until an in-flight claim finishes.
  if (!busy && language !== locale) {
    setLanguage(locale);
    setError(null);
    setVerified(false);
  }
  useLayoutEffect(() => {
    callback.current = onToken;
  }, [onToken]);
  useLayoutEffect(() => {
    callback.current('');
  }, [language, siteKey, attempt]);
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    const timeout = setTimeout(() => {
      if (!cancelled) setError({ code: 'WIDGET_WAIT_TIMEOUT' });
    }, 20000);
    function fail(message: Message) {
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
          throw new BusinessError('WIDGET_NOT_READY');
        }
        widget = window.turnstile.render(container.current, {
          sitekey: siteKey,
          action: 'claim',
          theme: 'light',
          size: 'flexible',
          language,
          'response-field': false,
          callback: (token: string) => {
            if (!cancelled) {
              clearTimeout(timeout);
              setError(null);
              setVerified(true);
              callback.current(token);
            }
          },
          'expired-callback': () => {
            fail({ code: 'WIDGET_EXPIRED' });
          },
          'error-callback': (code: string) => {
            if (!cancelled) {
              console.warn('Turnstile verification failed:', code);
              fail({ code: 'WIDGET_FAILED' });
            }
            return true;
          },
          'timeout-callback': () => {
            fail({ code: 'WIDGET_TIMEOUT' });
          },
          'unsupported-callback': () => fail({ code: 'WIDGET_UNSUPPORTED' }),
        });
      })
      .catch((e: Error) => {
        fail(toMessage(e));
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, attempt, language]);
  return (
    <div className="turnstile">
      <div ref={container} />
      {!verified && !error && (
        <p className="field-help" role="status">
          {t('claim.verifying')}
        </p>
      )}
      {error && (
        <>
          <Notice>{error}</Notice>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              callback.current('');
              setVerified(false);
              setError(null);
              setAttempt((v) => v + 1);
            }}
          >
            {t('claim.verifyAgain')}
          </button>
        </>
      )}
    </div>
  );
}
