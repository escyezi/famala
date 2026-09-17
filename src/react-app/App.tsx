import { useEffect, useState } from 'react';
import { AuthDialog } from './components/AuthDialog.tsx';
import { ClaimKeyDialog, ClaimPage, HistoryDialog } from './components/Claims.tsx';
import { Manager } from './components/Manager.tsx';
import { Icon, Notice } from './components/ui.tsx';
import { WorkspaceMenu } from './components/WorkspaceMenu.tsx';
import { useSession } from './hooks/useSession.ts';
import './App.css';

function App() {
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
        <span className="product-name">兑换码发放平台</span>
        <nav>
          <button className="history-button" onClick={() => setModal('history')}>
            <Icon name="history" size={17} />
            <span>已领取的兑换码</span>
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
                  '正在连接发码空间…'
                ) : error ? (
                  <button className="button secondary" onClick={() => void reload()}>
                    重新连接
                  </button>
                ) : (
                  '请登录后管理码池。'
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
            <button className="entry-card distribute" onClick={() => go('/manage')}>
              <div className="entry-top">
                <span className="tile-icon large">
                  <Icon name="box" size={28} />
                </span>
                <span className="entry-number">01 / SHARE</span>
              </div>
              <h2>{session ? '发码管理' : '我要发码'}</h2>
              <p>
                创建兑换码池、批量导入，
                <br />
                一个链接，让分享开始。
              </p>
              <span className="entry-link">
                {session ? '进入我的发码空间' : '开启我的发码空间'}
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
