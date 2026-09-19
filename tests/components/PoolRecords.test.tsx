import { StrictMode } from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { CodePage, CodeRow } from '../../src/shared/api-types.ts';
import { PoolDetail } from '../../src/react-app/components/PoolDetail.tsx';
import { usePoolDetails } from '../../src/react-app/hooks/usePoolDetails.ts';
import { deferred, json, mockApi, pool } from './helpers.ts';

const unclaimed: CodeRow = {
  id: 1,
  code: 'AVAILABLE',
  status: 'unclaimed',
  claimedAt: null,
  remark: null,

  redeemedMarkedAt: null,
  createdAt: pool.createdAt,
};
const claimed: CodeRow = {
  ...unclaimed,
  id: 2,
  code: 'CLAIMED',
  status: 'claimed',
  claimedAt: pool.createdAt,
  remark: 'A long remark\nwith a second line',
};
const redeemed: CodeRow = {
  ...claimed,
  id: 3,
  code: 'USED',
  status: 'redeemed' as const,
  redeemedMarkedAt: pool.createdAt + 1000,
};
const counts = { all: 3, unclaimed: 1, claimed: 1, redeemed: 1 };
const page = (items: CodeRow[], overrides: Partial<CodePage> = {}): CodePage => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
  counts,
  summary: {
    total: counts.all,
    remaining: counts.unclaimed,
    claimed: counts.claimed + counts.redeemed,
    redeemed: counts.redeemed,
  },
  ...overrides,
});
const url = (filter = 'all', n = 1, size = 20) =>
  `GET /api/manage/pools/1/codes?page=${n}&status=${filter}&pageSize=${size}`;
const renderDetail = () =>
  render(
    <PoolDetail
      pool={pool}
      error={null}
      onRefresh={vi.fn()}
      onNavigate={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );

test('slow switch retains the same table and committed view, then commits columns/count/page together', async () => {
  const pending = deferred<Response>();
  mockApi({
    [url()]: () => json(page([unclaimed, claimed])),
    [url('unclaimed')]: () => pending.promise,
  });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('AVAILABLE');
  const table = screen.getByRole('table');
  const region = screen.getByRole('region', { name: '领取明细表格' });
  region.scrollTop = 180;
  await user.click(screen.getByRole('button', { name: '待领取' }));
  expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  expect(
    screen.getByRole('button', { name: '待领取' }).querySelector('.records-spinner'),
  ).not.toBeNull();
  expect(screen.getByRole('table')).toBe(table);
  expect(screen.getByText('CLAIMED')).toBeVisible();
  expect(screen.getByRole('columnheader', { name: '领取时间' })).toBeVisible();
  expect(region.scrollTop).toBe(180);
  await act(async () => pending.resolve(json(page([unclaimed]))));
  expect(screen.getByRole('table')).toBe(table);
  expect(screen.getByRole('button', { name: '待领取' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('columnheader', { name: '领取时间' })).not.toBeInTheDocument();
  expect(screen.queryByText('CLAIMED')).not.toBeInTheDocument();
  expect(region.scrollTop).toBe(0);
  expect(screen.getByRole('checkbox', { name: '全选当前页' })).toBeEnabled();
});

test('failed switch retains old view and retries the failed target rather than the displayed filter', async () => {
  const target = vi
    .fn()
    .mockImplementationOnce(() => json({ code: 'SERVICE_UNAVAILABLE' }, 503))
    .mockImplementationOnce(() => json(page([claimed])));
  mockApi({ [url()]: () => json(page([unclaimed])), [url('claimed')]: target });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('AVAILABLE');
  await user.click(screen.getByRole('button', { name: '已领取' }));
  await screen.findByRole('button', { name: '重试' });
  expect(screen.getByText('AVAILABLE')).toBeVisible();
  expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('CLAIMED');
  expect(target).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '已领取' })).toHaveAttribute('aria-pressed', 'true');
});

test('initial failure is not empty inventory; retry can commit a genuine empty result', async () => {
  const load = vi
    .fn()
    .mockImplementationOnce(() => json({ code: 'SERVICE_UNAVAILABLE' }, 503))
    .mockImplementationOnce(() =>
      json(page([], { counts: { all: 0, unclaimed: 0, claimed: 0, redeemed: 0 } })),
    );
  mockApi({ [url()]: load });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByRole('button', { name: '重试' });
  expect(screen.queryByText('暂无兑换码记录')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('暂无兑换码记录')).toBeVisible();
  expect(screen.getByText('第 0–0 条，共 0 条')).toBeVisible();
});

test('valid cache switches immediately and a failed background refresh keeps its matching data', async () => {
  const background = deferred<Response>();
  const load = vi
    .fn()
    .mockImplementationOnce(() => json(page([unclaimed])))
    .mockImplementationOnce(() => background.promise);
  mockApi({ [url()]: load, [url('claimed')]: () => json(page([claimed])) });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('AVAILABLE');
  await user.click(screen.getByRole('button', { name: '已领取' }));
  await screen.findByText('CLAIMED');
  await user.click(screen.getByRole('button', { name: '全部' }));
  expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('AVAILABLE')).toBeVisible();
  expect(screen.getByRole('button', { name: '已领取' })).toBeDisabled();
  await act(async () => background.resolve(json({ code: 'SERVICE_UNAVAILABLE' }, 503)));
  expect(screen.getByText(/刷新失败，当前显示上次加载的数据/)).toBeVisible();
  expect(screen.getByRole('button', { name: '已领取' })).toBeEnabled();
  expect(screen.getByText('AVAILABLE')).toBeVisible();
});

test('refresh synchronously ignores every competing user entry, including duplicate calls', async () => {
  const pending = deferred<Response>();
  const load = vi
    .fn()
    .mockImplementationOnce(() => json(page([unclaimed])))
    .mockImplementationOnce(() => pending.promise);
  const onRefresh = vi.fn();
  const fetch = mockApi({ [url()]: load });
  const { result } = renderHook(() => usePoolDetails(pool, onRefresh));
  await waitFor(() => expect(result.current.controlsLocked).toBe(false));
  act(() => {
    result.current.refresh();
    result.current.refresh();
    result.current.changeFilter('claimed');
    result.current.changeFilter('all');
    result.current.changePage(2);
    result.current.changePageSize('50');
    result.current.retry();
    void result.current.status();
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(result.current.requestedQuery).toEqual({ filter: 'all', page: 1, pageSize: '20' });
  expect(result.current.controlsLocked).toBe(true);
  await act(async () => pending.resolve(json(page([unclaimed]))));
  expect(result.current.controlsLocked).toBe(false);
});

test('expired cache waits for fresh data instead of committing expired results', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const fresh = deferred<Response>();
  const load = vi
    .fn()
    .mockImplementationOnce(() => json(page([unclaimed])))
    .mockImplementationOnce(() => fresh.promise);
  mockApi({ [url()]: load, [url('claimed')]: () => json(page([claimed])) });
  const { result } = renderHook(() => usePoolDetails(pool, vi.fn()));
  await waitFor(() => expect(result.current.pending).toBe(false));
  act(() => result.current.changeFilter('claimed'));
  await waitFor(() => expect(result.current.filter).toBe('claimed'));
  now += 60_001;
  act(() => result.current.changeFilter('all'));
  expect(result.current.filter).toBe('claimed');
  expect(result.current.pending).toBe(true);
  await act(async () => fresh.resolve(json(page([unclaimed]))));
  expect(result.current.filter).toBe('all');
});

test('invalidation prevents stale requests and caches from restoring outdated rows; retry unlocks mutations', async () => {
  const stale = deferred<Response>();
  const all = vi
    .fn()
    .mockImplementationOnce(() => json(page([unclaimed])))
    .mockImplementationOnce(() => json({ code: 'SERVICE_UNAVAILABLE' }, 503))
    .mockImplementationOnce(() => json(page([])));
  mockApi({ [url()]: all, [url('claimed')]: () => stale.promise });
  const { result } = renderHook(() => usePoolDetails(pool, vi.fn()));
  await waitFor(() => expect(result.current.pending).toBe(false));
  act(() => result.current.changeFilter('claimed'));
  act(() => result.current.refreshAfterMutation());
  await waitFor(() => expect(result.current.codesError).not.toBeNull());
  await act(async () => stale.resolve(json(page([claimed]))));
  expect(result.current.codes?.items[0].code).toBe('AVAILABLE');
  expect(result.current.invalidated).toBe(true);
  expect(result.current.actionsDisabled).toBe(true);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.actionsDisabled).toBe(false));
  expect(result.current.codes?.items).toHaveLength(0);
});

test('same-query refresh keeps counts, detail and scrolling; committed query switch closes details', async () => {
  const refreshed = deferred<Response>();
  const all = vi
    .fn()
    .mockImplementationOnce(() => json(page([unclaimed, redeemed])))
    .mockImplementationOnce(() => refreshed.promise);
  mockApi({ [url()]: all, [url('unclaimed')]: () => json(page([unclaimed])) });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('USED');
  await user.click(screen.getByRole('button', { name: '展开 USED 详情' }));
  expect(screen.getByText('兑换标记时间')).toBeVisible();
  const region = screen.getByRole('region', { name: '领取明细表格' });
  const statistics = screen.getByRole('region', { name: '码池统计' });
  const readStatistics = () =>
    within(statistics)
      .getAllByRole('definition')
      .map((value) => value.textContent);
  const readTabCounts = () =>
    ['全部', '待领取', '已领取', '已兑换'].map(
      (name) => screen.getByRole('button', { name }).textContent,
    );
  const previousStatistics = readStatistics();
  const previousTabCounts = readTabCounts();
  region.scrollTop = 90;
  await user.click(screen.getByRole('button', { name: '刷新数据' }));
  expect(readStatistics()).toEqual(previousStatistics);
  expect(readTabCounts()).toEqual(previousTabCounts);
  expect(screen.getByRole('button', { name: '收起 USED 详情' })).toBeVisible();
  await act(async () => refreshed.resolve(json(page([unclaimed, redeemed]))));
  expect(readStatistics()).toEqual(previousStatistics);
  expect(readTabCounts()).toEqual(previousTabCounts);
  expect(region.scrollTop).toBe(90);
  expect(screen.getByRole('button', { name: '收起 USED 详情' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '待领取' }));
  await waitFor(() => expect(screen.queryByText('兑换标记时间')).not.toBeInTheDocument());
});

test('selection is cleared on request and cannot reappear after failure or returning through cache', async () => {
  const pending = deferred<Response>();
  mockApi({
    [url()]: () => json(page([unclaimed])),
    [url('unclaimed')]: () => json(page([unclaimed])),
    [url('claimed')]: () => pending.promise,
  });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('AVAILABLE');
  await user.click(screen.getByRole('button', { name: '待领取' }));
  await user.click(await screen.findByRole('checkbox', { name: '全选当前页' }));
  expect(screen.getByRole('button', { name: '批量删除' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '已领取' }));
  expect(screen.getByRole('checkbox', { name: '全选当前页' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: '全选当前页' })).not.toBeChecked();
  await act(async () => pending.resolve(json({ code: 'SERVICE_UNAVAILABLE' }, 503)));
  expect(screen.getByRole('checkbox', { name: '全选当前页' })).toBeEnabled();
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
});

test('invalidated view disables deletion even when refresh fails, while copy remains available', async () => {
  const all = vi
    .fn()
    .mockImplementationOnce(() => json(page([unclaimed])))
    .mockImplementationOnce(() => json({ code: 'SERVICE_UNAVAILABLE' }, 503));
  mockApi({ [url()]: all });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('AVAILABLE');
  await user.click(screen.getByRole('button', { name: '展开 AVAILABLE 详情' }));
  await user.click(screen.getByRole('button', { name: '刷新数据' }));
  await screen.findByRole('button', { name: '重试' });
  expect(screen.getByRole('button', { name: '删除兑换码' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '复制' })).toBeEnabled();
  expect(screen.getByText(/数据尚未更新/)).toBeVisible();
});

test('pagination waits without clearing content and backs up after the last page is deleted', async () => {
  const second = deferred<Response>();
  let deleted = false;
  mockApi({
    [url()]: () => json(page([unclaimed], { total: deleted ? 20 : 21 })),
    [url('all', 2)]: () => (deleted ? json(page([], { page: 2, total: 20 })) : second.promise),
  });
  const { result } = renderHook(() => usePoolDetails(pool, vi.fn()));
  await waitFor(() => expect(result.current.pending).toBe(false));
  act(() => result.current.changePage(2));
  expect(result.current.page).toBe(1);
  expect(result.current.codes?.items).toHaveLength(1);
  await act(async () => second.resolve(json(page([claimed], { page: 2, total: 21 }))));
  expect(result.current.page).toBe(2);
  deleted = true;
  act(() => result.current.refresh());
  expect(result.current.page).toBe(2);
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(result.current.page).toBe(1);
});

test('cache evicts the least recently redeemed query after twenty entries', async () => {
  const reload = deferred<Response>();
  let revisit = false;
  const routes = Object.fromEntries(
    Array.from({ length: 21 }, (_, i) => [
      url('all', i + 1),
      () =>
        i === 0 && revisit
          ? reload.promise
          : json(page([{ ...unclaimed, code: `PAGE-${i + 1}` }], { page: i + 1, total: 500 })),
    ]),
  );
  mockApi(routes);
  const { result } = renderHook(() => usePoolDetails(pool, vi.fn()));
  await waitFor(() => expect(result.current.pending).toBe(false));
  for (let n = 2; n <= 21; n++) {
    act(() => result.current.changePage(n));
    await waitFor(() => expect(result.current.page).toBe(n));
  }
  revisit = true;
  act(() => result.current.changePage(1));
  expect(result.current.page).toBe(21);
  await act(async () => reload.resolve(json(page([unclaimed], { total: 500 }))));
  expect(result.current.page).toBe(1);
});

test('unmount aborts requests and a new pool instance cannot reuse the old cache', async () => {
  const late = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  const all = vi
    .fn()
    .mockImplementationOnce(() => json(page([unclaimed])))
    .mockImplementationOnce(() => json(page([redeemed])));
  mockApi({
    [url()]: all,
    [url('claimed')]: (init) => {
      signal = init.signal;
      return late.promise;
    },
  });
  const first = renderHook(() => usePoolDetails(pool, vi.fn()));
  await waitFor(() => expect(first.result.current.pending).toBe(false));
  act(() => first.result.current.changeFilter('claimed'));
  first.unmount();
  expect(signal?.aborted).toBe(true);
  const second = renderHook(() => usePoolDetails(pool, vi.fn()));
  expect(second.result.current.codes).toBeNull();
  await waitFor(() => expect(second.result.current.codes?.items[0].code).toBe('USED'));
  await act(async () => late.resolve(json(page([claimed]))));
  expect(second.result.current.codes?.items[0].code).toBe('USED');
});

test('row details preserve long content and copying uses the complete code', async () => {
  const long = { ...claimed, code: 'LONG-'.repeat(20) };
  mockApi({ [url()]: () => json(page([long, unclaimed])) });
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText');
  renderDetail();
  await screen.findByText(long.code);
  const row = screen.getByText(long.code).closest('tr')!;
  await user.click(within(row).getByRole('button', { name: '复制' }));
  expect(write).toHaveBeenCalledWith(long.code);
  await user.click(within(row).getByRole('button', { name: `展开 ${long.code} 详情` }));
  expect(screen.getByText('兑换标记时间')).toBeVisible();
  expect(screen.queryByRole('button', { name: '删除兑换码' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '展开 AVAILABLE 详情' }));
  expect(screen.getAllByText('兑换标记时间')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '删除兑换码' })).toBeEnabled();
});

test('refresh locks all query/write controls while read-only interactions stay available', async () => {
  const pending = deferred<Response>();
  const load = vi
    .fn()
    .mockImplementationOnce(() => json(page([unclaimed], { total: 21 })))
    .mockImplementationOnce(() => pending.promise);
  mockApi({ [url()]: load });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('AVAILABLE');
  const table = screen.getByRole('table');
  await user.click(screen.getByRole('button', { name: '刷新数据' }));
  for (const name of [
    '全部',
    '待领取',
    '已领取',
    '已兑换',
    '上一页',
    '下一页',
    '刷新数据',
    '添加兑换码',
  ]) {
    expect(screen.getByRole('button', { name })).toBeDisabled();
  }
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByRole('link', { name: '返回码池列表' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '更多' }));
  expect(screen.getByRole('button', { name: '查看领码 Key' })).toBeEnabled();
  for (const name of ['标记已兑换', '编辑码池', '停止发放', '删除码池']) {
    expect(screen.getByRole('button', { name })).toBeDisabled();
  }
  await user.click(screen.getByRole('button', { name: '查看领码 Key' }));
  expect(screen.getByText(pool.claimKey)).toBeVisible();
  expect(screen.getByRole('button', { name: '复制' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '展开 AVAILABLE 详情' }));
  expect(screen.getByRole('button', { name: '删除兑换码' })).toBeDisabled();
  expect(screen.getByRole('table')).toBe(table);
  await act(async () => pending.resolve(json(page([unclaimed]))));
  expect(screen.getByRole('button', { name: '刷新数据' })).toBeEnabled();
});

test.each([200, 503])(
  'status serializes duplicate calls and its follow-up read (read status %s)',
  async (readStatus) => {
    const write = deferred<Response>();
    const read = deferred<Response>();
    const load = vi
      .fn()
      .mockImplementationOnce(() => json(page([unclaimed])))
      .mockImplementationOnce(() => read.promise);
    const mutate = vi.fn(() => write.promise);
    const parent = vi.fn();
    mockApi({ [url()]: load, 'POST /api/manage/pools/1/status': mutate });
    const { result } = renderHook(() => usePoolDetails(pool, parent));
    await waitFor(() => expect(result.current.controlsLocked).toBe(false));
    act(() => {
      void result.current.status();
      void result.current.status();
      result.current.changeFilter('claimed');
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    expect(result.current.controlsLocked).toBe(true);
    await act(async () => write.resolve(json({ status: 'stopped' })));
    expect(parent).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
    expect(result.current.controlsLocked).toBe(true);
    act(() => {
      result.current.changeFilter('claimed');
      result.current.refresh();
    });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () =>
      read.resolve(
        readStatus === 200 ? json(page([unclaimed])) : json({ code: 'SERVICE_UNAVAILABLE' }, 503),
      ),
    );
    expect(result.current.filter).toBe('all');
    expect(result.current.controlsLocked).toBe(false);
    expect(result.current.actionsDisabled).toBe(readStatus !== 200);
  },
);

test('failed status unlocks without invalidating the snapshot or refreshing', async () => {
  const parent = vi.fn();
  const read = vi.fn(() => json(page([unclaimed])));
  mockApi({
    [url()]: read,
    'POST /api/manage/pools/1/status': () => json({ code: 'SERVICE_UNAVAILABLE' }, 503),
  });
  const { result } = renderHook(() => usePoolDetails(pool, parent));
  await waitFor(() => expect(result.current.controlsLocked).toBe(false));
  await act(async () => result.current.status());
  expect(result.current.error).not.toBeNull();
  expect(result.current.controlsLocked).toBe(false);
  expect(result.current.actionsDisabled).toBe(false);
  expect(parent).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
});

test.each([200, 503, 401])(
  'late status response after unmount has no side effects (%s)',
  async (statusCode) => {
    const pending = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    const parent = vi.fn();
    const unauthorized = vi.fn();
    window.addEventListener('famala:unauthorized', unauthorized);
    const fetch = mockApi({
      [url()]: () => json(page([unclaimed])),
      'POST /api/manage/pools/1/status': (init) => {
        signal = init.signal;
        return pending.promise;
      },
    });
    const { result, unmount } = renderHook(() => usePoolDetails(pool, parent));
    await waitFor(() => expect(result.current.controlsLocked).toBe(false));
    act(() => {
      void result.current.status();
    });
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      pending.resolve(
        json(statusCode === 200 ? { status: 'stopped' } : { code: 'UNAUTHORIZED' }, statusCode),
      ),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(parent).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
    window.removeEventListener('famala:unauthorized', unauthorized);
  },
);

test('retained refresh and import callbacks use the latest committed filter and page', async () => {
  const unusedPage2 = vi.fn(() => json(page([claimed], { page: 2, total: 21 })));
  const unusedPage1 = vi.fn(() => json(page([claimed], { total: 21 })));
  const all = vi.fn(() => json(page([unclaimed])));
  mockApi({ [url()]: all, [url('claimed')]: unusedPage1, [url('claimed', 2)]: unusedPage2 });
  const { result } = renderHook(() => usePoolDetails(pool, vi.fn()));
  await waitFor(() => expect(result.current.controlsLocked).toBe(false));
  const refresh = result.current.refresh;
  const imported = result.current.imported;
  act(() => result.current.changeFilter('claimed'));
  await waitFor(() => expect(result.current.controlsLocked).toBe(false));
  act(() => result.current.changePage(2));
  await waitFor(() => expect(result.current.page).toBe(2));
  act(() => refresh());
  await waitFor(() => expect(result.current.controlsLocked).toBe(false));
  expect(result.current.filter).toBe('claimed');
  expect(result.current.page).toBe(2);
  expect(unusedPage2).toHaveBeenCalledTimes(2);
  act(() => imported());
  await waitFor(() => expect(result.current.controlsLocked).toBe(false));
  expect(result.current.filter).toBe('claimed');
  expect(result.current.page).toBe(1);
  expect(all).toHaveBeenCalledTimes(1);
  expect(unusedPage1).toHaveBeenCalledTimes(2);
});

test('StrictMode cleanup does not let old read completion unlock the new lifecycle', async () => {
  const old = deferred<Response>();
  const fresh = deferred<Response>();
  let signal: AbortSignal | null | undefined;
  const load = vi
    .fn()
    .mockImplementationOnce((init: RequestInit) => {
      signal = init.signal;
      return old.promise;
    })
    .mockImplementationOnce(() => fresh.promise);
  mockApi({ [url()]: load });
  const { result } = renderHook(() => usePoolDetails(pool, vi.fn()), { wrapper: StrictMode });
  expect(load).toHaveBeenCalledTimes(2);
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve(json(page([claimed]))));
  expect(result.current.codes).toBeNull();
  expect(result.current.controlsLocked).toBe(true);
  act(() => result.current.changeFilter('redeemed'));
  await act(async () => fresh.resolve(json(page([unclaimed]))));
  expect(result.current.codes?.items[0].code).toBe('AVAILABLE');
  expect(result.current.controlsLocked).toBe(false);
});

test.each(['import', 'rename', 'single', 'bulk', 'pool'] as const)(
  'unmounted %s completion cannot refresh, publish results, or navigate',
  async (kind) => {
    const pending = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    const path = {
      import: 'POST /api/manage/pools/1/import',
      rename: 'POST /api/manage/pools/1/name',
      single: 'DELETE /api/manage/pools/1/codes/1',
      bulk: 'DELETE /api/manage/pools/1/codes',
      pool: 'DELETE /api/manage/pools/1',
    }[kind];
    const mutation = vi.fn((init: RequestInit) => {
      signal = init.signal;
      return pending.promise;
    });
    const load = vi.fn(() => json(page([unclaimed])));
    mockApi({ [url()]: load, [url('unclaimed')]: load, [path]: mutation });
    const parent = vi.fn();
    const navigate = vi.fn();
    const deleted = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <PoolDetail
        pool={pool}
        error={null}
        onRefresh={parent}
        onNavigate={navigate}
        onDeleted={deleted}
      />,
    );
    await screen.findByText('AVAILABLE');
    if (kind === 'import') {
      await user.click(screen.getByRole('button', { name: '添加兑换码' }));
      await user.type(screen.getByRole('textbox'), 'NEW-CODE');
      await user.click(screen.getByRole('button', { name: '开始导入' }));
    } else if (kind === 'rename') {
      await user.click(screen.getByRole('button', { name: '更多' }));
      await user.click(screen.getByRole('button', { name: '编辑码池' }));
      await user.type(screen.getByRole('textbox', { name: '码池名称' }), 'new');
      await user.click(screen.getByRole('button', { name: '保存修改' }));
    } else {
      if (kind === 'single') {
        await user.click(screen.getByRole('button', { name: '展开 AVAILABLE 详情' }));
        await user.click(screen.getByRole('button', { name: '删除兑换码' }));
      } else if (kind === 'bulk') {
        await user.click(screen.getByRole('button', { name: '待领取' }));
        await user.click(await screen.findByRole('checkbox', { name: '全选当前页' }));
        await user.click(screen.getByRole('button', { name: '批量删除' }));
      } else {
        await user.click(screen.getByRole('button', { name: '更多' }));
        await user.click(screen.getByRole('button', { name: '删除码池' }));
      }
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: '确认删除' }),
      );
    }
    expect(mutation).toHaveBeenCalledTimes(1);
    const calls = load.mock.calls.length;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      pending.resolve(
        json({ id: 1, succeeded: 1, failed: 0, failures: [], deleted: 1, skipped: 0 }),
      ),
    );
    expect(load).toHaveBeenCalledTimes(calls);
    expect(parent).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
  },
);

test('single-pool export starts with the currently displayed filter and includes all pages', async () => {
  mockApi({
    [url()]: () => json(page([unclaimed, claimed, redeemed])),
    [url('redeemed')]: () => json(page([redeemed])),
  });
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('AVAILABLE');
  await user.click(screen.getByRole('button', { name: /^已兑换$/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: '导出明细' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: '导出明细' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('兑换码状态')).toHaveValue('redeemed');
  expect(within(dialog).getByText(/包含所有分页/)).toBeVisible();
});
