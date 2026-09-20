import { useTranslation, Trans } from 'react-i18next';
import { useEffect, useState } from 'react';
import { AuthDialog } from './components/AuthDialog.tsx';
import { ClaimKeyDialog, ClaimPage, HistoryDialog } from './components/Claims.tsx';
import { Manager } from './components/Manager.tsx';
import { Icon, Notice } from './components/ui.tsx';
import { WorkspaceMenu } from './components/WorkspaceMenu.tsx';
import { useSession } from './hooks/useSession.ts';
import './App.css';
import { LanguageToggle } from './components/LanguageToggle.tsx';

function App() {
  const { t } = useTranslation();
  const [route, setRoute] = useState(() => ({
    path: location.pathname,
    search: location.search,
  }));
  const [modal, setModal] = useState<'auth' | 'claim' | 'history' | null>(null);
  const { session, loading, error, loggingOut, acceptSession, reload, logout } = useSession();
  useEffect(() => {
    const changed = () => {
      setModal(null);
      window.scrollTo(0, 0);
      setRoute({ path: location.pathname, search: location.search });
    };
    const unauthorized = () => {
      acceptSession(null);
      setModal('auth');
    };
    window.addEventListener('popstate', changed);
    window.addEventListener('famala:unauthorized', unauthorized);
    return () => {
      window.removeEventListener('popstate', changed);
      window.removeEventListener('famala:unauthorized', unauthorized);
    };
  }, [acceptSession]);
  function go(path: string) {
    history.pushState(null, '', path);
    setRoute({ path: location.pathname, search: location.search });
    setModal(null);
    window.scrollTo(0, 0);
  }
  const poolId = /^\/manage\/pools\/([^/]+)\/?$/.exec(route.path)?.[1];
  const managing = route.path === '/manage' || poolId !== undefined;
  // Derive the protected-route gate so back/forward navigation cannot dismiss it.
  const needsLogin = managing && !loading && !session && !error;
  const claiming = route.path === '/claim';
  const key = new URLSearchParams(route.search).get('key') ?? '';
  return (
    <>
      <header className={`app-header${managing ? ' manager-header' : ''}`}>
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            go('/');
          }}
        >
          <span className="brand-icon">
            <Icon name="gift" size={22} />
          </span>
          <span>
            famala<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-divider" />
        <span className="product-name">{t('common.product')}</span>
        <nav>
          <LanguageToggle />
          <a
            className="github-link"
            href="https://github.com/escyezi/famala"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="famala · GitHub"
            title="famala · GitHub"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.334-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3-.405c1.02.005 2.045.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
          </a>
          <button
            className="history-button"
            aria-label={t('common.history')}
            onClick={() => setModal('history')}
          >
            <Icon name="history" size={17} />
            <span>{t('common.history')}</span>
          </button>
          {managing && session && (
            <div className="workspace-menu-slot">
              <WorkspaceMenu
                key={session.spaceId}
                session={session}
                busy={loggingOut}
                onLogout={async () => {
                  if (await logout()) go('/');
                }}
              />
            </div>
          )}
        </nav>
      </header>
      {managing ? (
        <>
          <Notice>{error}</Notice>
          {session ? (
            <Manager key={session.spaceId} poolId={poolId} onNavigate={go} />
          ) : (
            <main className="manager-main">
              <div className="empty-state">
                {loading ? (
                  t('home.connecting')
                ) : error ? (
                  <button className="button secondary" onClick={() => void reload()}>
                    {t('common.reconnect')}
                  </button>
                ) : (
                  t('home.loginRequired')
                )}
              </div>
            </main>
          )}
        </>
      ) : claiming ? (
        <ClaimPage key={key} claimKey={key} onEnterKey={() => setModal('claim')} />
      ) : (
        <main className="home-main">
          <div className="home-copy">
            <h1>
              <Trans i18nKey="home.headline" components={{ br: <br />, accent: <span /> }} />
            </h1>
            <div className="home-features">
              <span>
                <Icon name="check" size={16} />
                {t('home.noSignup')}
              </span>
              <span>
                <Icon name="check" size={16} />
                {t('home.bulk')}
              </span>
              <span>
                <Icon name="check" size={16} />
                {t('home.records')}
              </span>
            </div>
          </div>
          <div className="entry-cards">
            <button className="entry-card distribute" onClick={() => go('/manage')}>
              <span className="tile-icon large">
                <Icon name="box" size={28} />
              </span>
              <h2>{session ? t('home.manage') : t('home.distribute')}</h2>
              <p>{t('home.shareDescription')}</p>
              <span className="entry-link">
                {session ? t('home.enter') : t('home.start')}
                <Icon name="arrow" />
              </span>
            </button>
            <button className="entry-card receive" onClick={() => setModal('claim')}>
              <span className="tile-icon large">
                <Icon name="gift" size={28} />
              </span>
              <h2>{t('home.receive')}</h2>
              <p>{t('home.claimDescription')}</p>
              <span className="entry-link">
                {t('home.enterKey')}
                <Icon name="arrow" />
              </span>
            </button>
          </div>
          <div className="home-bottom">
            <span>{t('home.tagline')}</span>
          </div>
        </main>
      )}
      {!managing && (
        <footer className="app-footer">
          <span>{t('home.footer')}</span>
          <span>{t('home.rules')}</span>
        </footer>
      )}
      {(modal === 'auth' || needsLogin) && (
        <AuthDialog
          onClose={() => {
            setModal(null);
            if (managing) go('/');
          }}
          onDone={(value) => {
            acceptSession(value);
            if (managing) {
              setModal(null);
            } else {
              go('/manage');
            }
          }}
        />
      )}
      {modal === 'claim' && (
        <ClaimKeyDialog
          onClose={() => setModal(null)}
          onValidated={(claimKey) => go(`/claim?key=${encodeURIComponent(claimKey)}`)}
        />
      )}
      {modal === 'history' && <HistoryDialog onClose={() => setModal(null)} />}
    </>
  );
}
export default App;
