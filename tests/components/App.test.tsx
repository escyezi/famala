import type { ApiResponses } from './helpers.ts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import App from '../../src/react-app/App.tsx';
import type { CodeRow } from '../../src/shared/api-types.ts';
import { deferred, json, mockApi, pool, session } from './helpers.ts';

const row: CodeRow = {
  id: 1,
  code: 'POOL-ONE',
  claimStatus: 'unclaimed',
  claimedAt: null,
  remark: null,
  userMarkedUsed: false,
  userMarkedUsedAt: null,
  createdAt: pool.createdAt,
};

test('游客打开首页不会因会话 401 弹出登录框，校验领码 Key 后进入领取页', async () => {
  const sessionResponse = deferred<Response>();
  mockApi({
    'GET /api/manage/session': () => sessionResponse.promise,
    'POST /api/claim/validate': () => json(pool satisfies ApiResponses['validateClaim']),
    'GET /api/config': () =>
      json({ turnstileSiteKey: 'test-key', testMode: true } satisfies ApiResponses['config']),
  });
  const user = userEvent.setup();
  render(<App />);
  // Assert after the 401 has been handled, not merely after fetch was called.
  await act(async () => {
    sessionResponse.resolve(json({ error: '未登录' }, 401));
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /我要发码/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /发码管理/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /我要领码/ }));
  await user.type(screen.getByLabelText('领码 Key'), pool.claimKey);
  await user.click(screen.getByRole('button', { name: '前往领取' }));
  expect(await screen.findByRole('heading', { name: pool.name })).toBeVisible();
  expect(location.pathname).toBe('/claim');
  expect(new URLSearchParams(location.search).get('key')).toBe(pool.claimKey);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('管理接口返回 401 时展示登录框，取消后回到首页', async () => {
  window.history.replaceState(null, '', '/manage');
  mockApi({
    'GET /api/manage/session': () => json({ error: '登录已过期' }, 401),
  });
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole('dialog', { name: '开始发放兑换码' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '关闭弹窗' }));
  expect(location.pathname).toBe('/');
  expect(screen.getByRole('button', { name: /我要发码/ })).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('首页发码入口等待会话确认，登录后直接返回当前空间，退出后恢复游客入口', async () => {
  const initialSession = deferred<Response>();
  const readSession = vi.fn(() => initialSession.promise);
  mockApi({
    'GET /api/manage/session': readSession,
    'POST /api/login': () => {
      return json(session satisfies ApiResponses['login']);
    },
    'GET /api/manage/pools': () => json({ items: [] } satisfies ApiResponses['pools']),
    'POST /api/manage/logout': () => {
      return json({ ok: true } satisfies ApiResponses['logout']);
    },
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: /我要发码/ }));
  expect(screen.getByText('正在连接发码空间…')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => initialSession.resolve(json({ error: '未登录' }, 401)));
  await user.click(screen.getByRole('button', { name: /使用已有 Key/ }));
  await user.type(screen.getByLabelText('发码 Key'), 'd_saved-key');
  await user.click(screen.getByRole('button', { name: '进入管理页面' }));
  expect(await screen.findByText('从第一个码池开始')).toBeVisible();
  expect(location.pathname).toBe('/manage');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(readSession).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('link', { name: 'famala.' }));
  expect(screen.queryByRole('button', { name: /我要发码/ })).not.toBeInTheDocument();
  const manageEntry = screen.getByRole('button', { name: /发码管理/ });
  expect(manageEntry).toHaveTextContent('进入我的发码空间');
  expect(within(screen.getByRole('navigation')).queryByText('发码管理')).not.toBeInTheDocument();
  await user.click(manageEntry);
  expect(await screen.findByText('从第一个码池开始')).toBeVisible();
  expect(location.pathname).toBe('/manage');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(readSession).toHaveBeenCalledTimes(1);
  const menu = screen.getByRole('button', { name: '我的发码空间' });
  await user.click(menu);
  expect(menu).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(String(session.spaceId))).toBeVisible();
  await user.keyboard('{Escape}');
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  expect(menu).toHaveFocus();
  await user.click(menu);
  await user.click(screen.getByRole('button', { name: '退出登录' }));
  expect(await screen.findByRole('button', { name: /我要发码/ })).toBeVisible();
  expect(location.pathname).toBe('/');
  expect(screen.queryByRole('button', { name: /发码管理/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '我的发码空间' })).not.toBeInTheDocument();
});

test('前进后退和切换码池重置详情状态，已离开的请求返回 401 不打断当前页面', async () => {
  window.history.replaceState(null, '', '/manage');
  const second = { ...pool, id: 2, name: '十月福利', claimKey: 'c_second' };
  const oldCodes = deferred<Response>();
  let oldSignal: AbortSignal | null | undefined;
  const readSession = vi.fn(() => json(session satisfies ApiResponses['session']));
  mockApi({
    'GET /api/manage/session': readSession,
    'GET /api/manage/pools': () => json({ items: [pool, second] } satisfies ApiResponses['pools']),
    'GET /api/manage/pools/1/codes?page=1&status=all': () =>
      json({ items: [row], total: 1, page: 1, pageSize: 50 } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=1&status=claimed': (init) => {
      oldSignal = init.signal;
      return oldCodes.promise;
    },
    'GET /api/manage/pools/2/codes?page=1&status=all': () =>
      json({
        items: [{ ...row, code: 'POOL-TWO' }],
        total: 1,
        page: 1,
        pageSize: 50,
      } satisfies ApiResponses['codes']),
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('link', { name: new RegExp(pool.name) }));
  await screen.findByText('POOL-ONE');
  await user.click(screen.getByRole('button', { name: '已领取' }));
  await user.click(screen.getByRole('button', { name: '修改名称' }));
  act(() => history.back());
  await screen.findByRole('heading', { name: '我的空间', level: 1 });
  expect(oldSignal?.aborted).toBe(true);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  act(() => history.forward());
  await screen.findByText('POOL-ONE');
  expect(screen.getByRole('button', { name: '全部' })).toHaveClass('active');
  await user.click(screen.getByRole('link', { name: '返回码池列表' }));
  await user.click(await screen.findByRole('link', { name: new RegExp(second.name) }));
  await screen.findByText('POOL-TWO');
  await act(async () => oldCodes.resolve(json({ error: '旧请求已过期' }, 401)));
  expect(screen.getByText('POOL-TWO')).toBeVisible();
  expect(screen.queryByText('POOL-ONE')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(readSession).toHaveBeenCalledTimes(1);
});

test('会话过期清除旧空间详情，重新登录保留目标路由且忽略旧请求结果', async () => {
  window.history.replaceState(null, '', `/manage/pools/${pool.id}`);
  const oldCodes = deferred<Response>();
  let expired = false;
  let loggedInAgain = false;
  mockApi({
    'GET /api/manage/session': () => json(session satisfies ApiResponses['session']),
    'GET /api/manage/pools': () =>
      expired
        ? json({ error: '登录已过期' }, 401)
        : json({
            items: [{ ...pool, name: loggedInAgain ? '重新登录的码池' : pool.name }],
          } satisfies ApiResponses['pools']),
    'GET /api/manage/pools/1/codes?page=1&status=all': () =>
      loggedInAgain
        ? json({
            items: [{ ...row, code: 'NEW-SESSION' }],
            total: 1,
            page: 1,
            pageSize: 50,
          } satisfies ApiResponses['codes'])
        : oldCodes.promise,
    'POST /api/login': () => {
      expired = false;
      loggedInAgain = true;
      return json(session satisfies ApiResponses['login']);
    },
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: pool.name, level: 1 });
  expired = true;
  await user.click(screen.getByRole('button', { name: '刷新数据' }));
  await screen.findByRole('dialog', { name: '开始发放兑换码' });
  expect(screen.queryByText(pool.claimKey)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '我的发码空间' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /使用已有 Key/ }));
  await user.type(screen.getByLabelText('发码 Key'), 'd_saved-key');
  await user.click(screen.getByRole('button', { name: '进入管理页面' }));
  await screen.findByText('NEW-SESSION');
  await act(async () =>
    oldCodes.resolve(
      json({ items: [row], total: 1, page: 1, pageSize: 50 } satisfies ApiResponses['codes']),
    ),
  );
  expect(location.pathname).toBe(`/manage/pools/${pool.id}`);
  expect(screen.getByRole('heading', { name: '重新登录的码池' })).toBeVisible();
  expect(screen.queryByText('POOL-ONE')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('管理页会话查询失败可重试，连接故障不误判为需要登录', async () => {
  window.history.replaceState(null, '', '/manage');
  const retriedSession = deferred<Response>();
  const readSession = vi
    .fn()
    .mockImplementationOnce(() => json({ error: '暂时不可用' }, 503))
    .mockImplementationOnce(() => retriedSession.promise);
  const pools = vi.fn(() => json({ items: [] } satisfies ApiResponses['pools']));
  mockApi({ 'GET /api/manage/session': readSession, 'GET /api/manage/pools': pools });
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时不可用');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(pools).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '重新连接' }));
  expect(screen.getByText('正在连接发码空间…')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => retriedSession.resolve(json(session satisfies ApiResponses['session'])));
  await screen.findByText('从第一个码池开始');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('删除后返回空间并立即移除旧卡片，后退不能重新打开已删除详情', async () => {
  const refreshed = deferred<Response>();
  let deleted = false;
  mockApi({
    'GET /api/manage/session': () => json(session satisfies ApiResponses['session']),
    'GET /api/manage/pools': () =>
      deleted ? refreshed.promise : json({ items: [pool] } satisfies ApiResponses['pools']),
    'GET /api/manage/pools/1/codes?page=1&status=all': () =>
      json({ items: [row], total: 1, page: 1, pageSize: 50 } satisfies ApiResponses['codes']),
    'DELETE /api/manage/pools/1': () => {
      deleted = true;
      return json({ ok: true } satisfies ApiResponses['deletePool']);
    },
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /发码管理/ }));
  await user.click(await screen.findByRole('link', { name: new RegExp(pool.name) }));
  await user.click(await screen.findByRole('button', { name: '删除码池' }));
  await user.click(screen.getByRole('button', { name: '确认删除' }));
  expect(await screen.findByRole('heading', { name: '我的空间' })).toBeVisible();
  expect(location.pathname).toBe('/manage');
  expect(screen.queryByRole('link', { name: new RegExp(pool.name) })).not.toBeInTheDocument();
  await act(async () => refreshed.resolve(json({ items: [] } satisfies ApiResponses['pools'])));
  act(() => history.back());
  expect(await screen.findByText('码池不存在或无权访问。')).toBeVisible();
  expect(screen.queryByText(pool.claimKey)).not.toBeInTheDocument();
});
