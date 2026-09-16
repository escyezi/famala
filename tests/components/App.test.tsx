import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import App from '../../src/react-app/App.tsx';
import { deferred, json, mockApi, pool, session } from './helpers.ts';

test('游客打开首页不会因会话 401 弹出登录框，校验领码 Key 后进入领取页', async () => {
  const sessionResponse = deferred<Response>();
  mockApi({
    'GET /api/manage/session': () => sessionResponse.promise,
    'POST /api/claim/validate': () => json(pool),
    'GET /api/config': () => json({ turnstileSiteKey: 'test-key', testMode: true }),
  });
  const user = userEvent.setup();
  render(<App />);
  // Assert after the 401 has been handled, not merely after fetch was called.
  await act(async () => {
    sessionResponse.resolve(json({ error: '未登录' }, 401));
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '发码管理' })).not.toBeInTheDocument();
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
    'GET /api/manage/pools': () => json({ error: '登录已过期' }, 401),
  });
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole('dialog', { name: '开始发放兑换码' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '关闭弹窗' }));
  expect(location.pathname).toBe('/');
  expect(screen.getByRole('button', { name: /我要发码/ })).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('登录后展示管理入口，通过空间菜单退出后回到首页', async () => {
  let authenticated = false;
  mockApi({
    'GET /api/manage/session': () =>
      authenticated ? json(session) : json({ error: '未登录' }, 401),
    'POST /api/login': () => {
      authenticated = true;
      return json({ ok: true });
    },
    'GET /api/manage/pools': () => json({ items: [] }),
    'POST /api/manage/logout': () => {
      authenticated = false;
      return json({ ok: true });
    },
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: /我要发码/ }));
  await user.click(screen.getByRole('button', { name: /使用已有 Key/ }));
  await user.type(screen.getByLabelText('发码 Key'), 'd_saved-key');
  await user.click(screen.getByRole('button', { name: '进入管理页面' }));
  expect(await screen.findByText('从第一个码池开始')).toBeVisible();
  expect(location.pathname).toBe('/manage');
  expect(screen.getByRole('link', { name: '发码管理' })).toBeVisible();
  const menu = screen.getByRole('button', { name: '我的发码空间' });
  await user.click(menu);
  expect(menu).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{Escape}');
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  expect(menu).toHaveFocus();
  await user.click(menu);
  await user.click(screen.getByRole('button', { name: '退出登录' }));
  expect(await screen.findByRole('button', { name: /我要发码/ })).toBeVisible();
  expect(location.pathname).toBe('/');
  expect(screen.queryByRole('link', { name: '发码管理' })).not.toBeInTheDocument();
});
