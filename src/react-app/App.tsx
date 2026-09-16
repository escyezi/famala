import { useEffect, useState } from 'react';
import { AuthDialog } from './components/AuthDialog.tsx';
import { ClaimKeyDialog, ClaimPage, HistoryDialog } from './components/Claims.tsx';
import { Manager } from './components/Manager.tsx';
import { Icon } from './components/ui.tsx';
import { readSession } from './api.ts';
import './App.css';

function App() {
  const [route, setRoute] = useState(() => ({
    path: location.pathname,
    search: location.search,
    version: 0,
  }));
  const [modal, setModal] = useState<'auth' | 'claim' | 'history' | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [workspaceMenuTarget, setWorkspaceMenuTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Checking a public page's session must not open the login dialog on 401.
    readSession(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setAuthenticated(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuthenticated(false);
      });
    return () => controller.abort();
  }, [route.version]);
  useEffect(() => {
    const changed = () => {
      setModal(null);
      window.scrollTo(0, 0);
      setRoute((r) => ({
        path: location.pathname,
        search: location.search,
        version: r.version + 1,
      }));
    };
    const unauthorized = () => {
      setAuthenticated(false);
      setModal('auth');
    };
    window.addEventListener('popstate', changed);
    window.addEventListener('famala:unauthorized', unauthorized);
    return () => {
      window.removeEventListener('popstate', changed);
      window.removeEventListener('famala:unauthorized', unauthorized);
    };
  }, []);
  function go(path: string) {
    history.pushState(null, '', path);
    setRoute((r) => ({ path: location.pathname, search: location.search, version: r.version + 1 }));
    setModal(null);
    window.scrollTo(0, 0);
  }
  const poolId = /^\/manage\/pools\/([^/]+)\/?$/.exec(route.path)?.[1];
  const managing = route.path === '/manage' || poolId !== undefined;
  const claiming = route.path === '/claim';
  const key = new URLSearchParams(route.search).get('key') ?? '';
  return (
    <>
      <header className={`app-header${managing ? ' manager-header' : ''}`}>
        <a
          href="/"
          className="brand"
          onClick={(e) => {
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
        <span className="product-name">兑换码发放平台</span>
        <nav>
          {authenticated && (
            <a
              href="/manage"
              className={managing ? 'current' : ''}
              onClick={(e) => {
                e.preventDefault();
                go('/manage');
              }}
            >
              发码管理
            </a>
          )}
          <button className="history-button" onClick={() => setModal('history')}>
            <Icon name="history" size={17} />
            <span>已领取的兑换码</span>
          </button>
          {managing && <div className="workspace-menu-slot" ref={setWorkspaceMenuTarget} />}
        </nav>
      </header>
      {managing ? (
        <Manager
          key={route.version}
          poolId={poolId}
          onNavigate={go}
          menuTarget={workspaceMenuTarget}
          onLogout={() => {
            setAuthenticated(false);
            go('/');
          }}
        />
      ) : claiming ? (
        <ClaimPage
          key={`${key}:${route.version}`}
          claimKey={key}
          onEnterKey={() => setModal('claim')}
        />
      ) : (
        <main className="home-main">
          <div className="home-copy">
            <h1>
              一个链接，
              <br />
              <span>轻松发码。</span>
            </h1>
            <div className="home-features">
              <span>
                <Icon name="check" size={16} />
                无需注册
              </span>
              <span>
                <Icon name="check" size={16} />
                批量管理
              </span>
              <span>
                <Icon name="check" size={16} />
                领取记录可查看
              </span>
            </div>
          </div>
          <div className="entry-cards">
            <button className="entry-card distribute" onClick={() => setModal('auth')}>
              <div className="entry-top">
                <span className="tile-icon large">
                  <Icon name="box" size={28} />
                </span>
                <span className="entry-number">01 / SHARE</span>
              </div>
              <h2>我要发码</h2>
              <p>
                创建兑换码池、批量导入，
                <br />
                一个链接，让分享开始。
              </p>
              <span className="entry-link">
                开启我的发码空间
                <Icon name="arrow" />
              </span>
            </button>
            <button className="entry-card receive" onClick={() => setModal('claim')}>
              <div className="entry-top">
                <span className="tile-icon large">
                  <Icon name="gift" size={28} />
                </span>
                <span className="entry-number">02 / RECEIVE</span>
              </div>
              <h2>我要领码</h2>
              <p>
                带上你的领码 Key，
                <br />
                领取一份属于你的惊喜。
              </p>
              <span className="entry-link">
                输入领码 Key
                <Icon name="arrow" />
              </span>
            </button>
          </div>
          <div className="home-bottom">
            <span>简单发放 · 轻松领取</span>
            <span>MADE FOR SHARING</span>
          </div>
        </main>
      )}
      {!managing && (
        <footer className="app-footer">
          <span>famala · 让发码简单一点</span>
          <span>兑换码使用规则以发码者说明为准</span>
        </footer>
      )}
      {modal === 'auth' && (
        <AuthDialog
          onClose={() => {
            setModal(null);
            if (managing) go('/');
          }}
          onDone={() => {
            setAuthenticated(true);
            if (managing) {
              setModal(null);
              setRoute((r) => ({ ...r, version: r.version + 1 }));
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
