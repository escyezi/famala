import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Manager } from '../../src/react-app/components/Manager.tsx';
import { usePools } from '../../src/react-app/hooks/usePools.ts';
import type { CodePage, Pool } from '../../src/shared/api-types.ts';
import { deferred, json, mockApi, pool } from './helpers.ts';

const records = (): CodePage => ({
  items: [],
  total: 2,
  page: 1,
  pageSize: 20,
  counts: { all: 2, unclaimed: 2, claimed: 0, redeemed: 0 },
  summary: { total: 2, remaining: 2, claimed: 0, redeemed: 0 },
});
const codesUrl = 'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20';

test.each(['active', 'stopped'] as const)(
  'confirmed transition from %s survives list refresh failure and reverses correctly',
  async (initial) => {
    let status: Pool['status'] = initial;
    const next = initial === 'active' ? 'stopped' : 'active';
    const initialAction = initial === 'active' ? '停止发放' : '恢复发放';
    const nextAction = initial === 'active' ? '恢复发放' : '停止发放';
    const list = vi
      .fn()
      .mockImplementationOnce(() => json({ items: [{ ...pool, status }] }))
      .mockImplementation(() => json({ code: 'SERVICE_UNAVAILABLE' }, 503));
    const write = vi.fn((init: RequestInit) => {
      status = JSON.parse(init.body as string).status;
      return json({ status });
    });
    mockApi({
      'GET /api/manage/pools': list,
      [codesUrl]: () => json(records()),
      'POST /api/manage/pools/1/status': write,
    });
    const user = userEvent.setup();
    render(<Manager poolId="1" onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '添加兑换码' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(screen.getByRole('button', { name: initialAction }));
    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: '添加兑换码' })).toBeEnabled());
    expect(status).toBe(next);
    const heading = screen.getByRole('heading', { name: pool.name, level: 1 }).parentElement;
    expect(heading).toHaveTextContent(next === 'stopped' ? '已停止' : '发放中');
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(screen.getByRole('button', { name: nextAction }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls.map(([init]) => JSON.parse(init.body as string).status)).toEqual([
      next,
      initial,
    ]);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  },
);

test('list response started before a confirmed stop cannot restore the old status', async () => {
  const old = deferred<Response>();
  let oldSignal: AbortSignal | null | undefined;
  const list = vi
    .fn()
    .mockImplementationOnce(() => json({ items: [pool] }))
    .mockImplementationOnce((init: RequestInit) => {
      oldSignal = init.signal;
      return old.promise;
    })
    .mockImplementation(() => json({ code: 'SERVICE_UNAVAILABLE' }, 503));
  mockApi({
    'GET /api/manage/pools': list,
    [codesUrl]: () => json(records()),
    'POST /api/manage/pools/1/status': () => json({ status: 'stopped' }),
  });
  const user = userEvent.setup();
  const navigate = vi.fn();
  const view = render(<Manager onNavigate={navigate} />);
  await screen.findByRole('heading', { name: pool.name });
  view.rerender(<Manager poolId="1" onNavigate={navigate} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '添加兑换码' })).toBeEnabled());
  expect(oldSignal?.aborted).toBe(false);
  await user.click(screen.getByRole('button', { name: '更多' }));
  await user.click(screen.getByRole('button', { name: '停止发放' }));
  await screen.findByRole('alert');
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => old.resolve(json({ items: [pool] })));
  expect(
    screen.getByRole('heading', { name: pool.name, level: 1 }).parentElement,
  ).toHaveTextContent('已停止');
  await user.click(screen.getByRole('button', { name: '更多' }));
  expect(screen.getByRole('button', { name: '恢复发放' })).toBeEnabled();
  expect(screen.getByRole('alert')).toHaveTextContent('服务暂时不可用');
});

test('committing a status cancels immediately, preserves other pools, and accepts subsequent server reads', async () => {
  const old = deferred<Response>();
  const other = { ...pool, id: 2, name: 'Other' };
  let signal: AbortSignal | null | undefined;
  const list = vi
    .fn()
    .mockImplementationOnce(() => json({ items: [pool, other] }))
    .mockImplementationOnce((init: RequestInit) => {
      signal = init.signal;
      return old.promise;
    })
    .mockImplementation(() => json({ items: [pool, other] }));
  mockApi({ 'GET /api/manage/pools': list });
  const { result } = renderHook(() => usePools());
  await waitFor(() => expect(result.current.loading).toBe(false));
  act(() => result.current.refresh());
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  act(() => {
    result.current.commitPoolStatus(1, 'stopped');
    expect(signal?.aborted).toBe(true);
  });
  await act(async () => old.resolve(json({ items: [pool, other] })));
  expect(result.current.pools?.map((p) => p.status)).toEqual(['stopped', 'active']);
  act(() => result.current.commitPoolStatus(999, 'stopped'));
  expect(result.current.pools).toHaveLength(2);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.pools?.map((p) => p.status)).toEqual(['active', 'active']);
});
