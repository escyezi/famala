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
              <div className="entry-top">
                <span className="tile-icon large">
                  <Icon name="box" size={28} />
                </span>
                <span className="entry-number">{t('home.shareEyebrow')}</span>
              </div>
              <h2>{session ? t('home.manage') : t('home.distribute')}</h2>
              <p>
                <Trans i18nKey="home.shareDescription" components={{ br: <br /> }} />
              </p>
              <span className="entry-link">
                {session ? t('home.enter') : t('home.start')}
                <Icon name="arrow" />
              </span>
            </button>
            <button className="entry-card receive" onClick={() => setModal('claim')}>
              <div className="entry-top">
                <span className="tile-icon large">
                  <Icon name="gift" size={28} />
                </span>
                <span className="entry-number">{t('home.receiveEyebrow')}</span>
              </div>
              <h2>{t('home.receive')}</h2>
              <p>
                <Trans i18nKey="home.claimDescription" components={{ br: <br /> }} />
              </p>
              <span className="entry-link">
                {t('home.enterKey')}
                <Icon name="arrow" />
              </span>
            </button>
          </div>
          <div className="home-bottom">
            <span>{t('home.tagline')}</span>
            <span>{t('home.bottomEyebrow')}</span>
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
