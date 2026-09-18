import type { ApiResponses } from './helpers.ts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Manager } from '../../src/react-app/components/Manager.tsx';
import { deferred, json, mockApi, pool } from './helpers.ts';

const baseRoutes = {
  'GET /api/manage/pools': () => json({ items: [pool] } satisfies ApiResponses['pools']),
  'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () =>
    json({
      counts: { all: pool.total, unclaimed: pool.remaining, claimed: 0, redeemed: 0 },
      summary: { total: pool.total, remaining: pool.remaining, claimed: 0 + 0, redeemed: 0 },
      items: [],
      total: pool.total,
      page: 1,
      pageSize: 20,
    } satisfies ApiResponses['codes']),
};

function renderManager(poolId?: string) {
  const onNavigate = vi.fn();
  render(<Manager poolId={poolId} onNavigate={onNavigate} />);
  return { onNavigate };
}

test('稍后导入会创建空池，去掉名称首尾空白并导航至新码池', async () => {
  const create = vi.fn(() => json({ id: 3 } satisfies ApiResponses['createPool'], 201));
  mockApi({ ...baseRoutes, 'POST /api/manage/pools': create });
  const user = userEvent.setup();
  const { onNavigate } = renderManager();
  await screen.findByRole('heading', { name: pool.name });
  await user.click(screen.getByRole('button', { name: '新建兑换码池' }));
  const dialog = screen.getByRole('dialog', { name: '新建兑换码池' });
  const submit = within(dialog).getByRole('button', { name: '稍后导入' });
  expect(submit).toBeDisabled();
  await user.type(within(dialog).getByLabelText('码池名称'), '  十月福利  ');
  await user.click(submit);
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/manage/pools/3'));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ body: JSON.stringify({ name: '十月福利' }) }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('创建并导入不等待列表刷新，导入失败可重试且不会重复创建码池', async () => {
  const create = vi.fn(() => json({ id: 3 } satisfies ApiResponses['createPool'], 201));
  const importCodes = vi
    .fn()
    .mockImplementationOnce(() => json({ code: 'SERVICE_UNAVAILABLE' }, 503))
    .mockImplementationOnce(() =>
      json({ succeeded: 1, failed: 0, failures: [] } satisfies ApiResponses['importCodes']),
    );
  // The list still returns old data: the new pool can be imported into immediately.
  mockApi({
    ...baseRoutes,
    'POST /api/manage/pools': create,
    'POST /api/manage/pools/3/import': importCodes,
  });
  const user = userEvent.setup();
  const { onNavigate } = renderManager();
  await screen.findByRole('heading', { name: pool.name });
  await user.click(screen.getByRole('button', { name: '新建兑换码池' }));
  expect(screen.getByRole('button', { name: '创建并导入' })).toBeDisabled();
  await user.type(screen.getByLabelText('码池名称'), '  连续导入  ');
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', { name: '添加兑换码' });
  expect(within(dialog).getByText('连续导入')).toBeVisible();
  expect(onNavigate).not.toHaveBeenCalled();
  await user.type(within(dialog).getByLabelText(/兑换码内容/), 'NEW-CODE');
  await user.click(within(dialog).getByRole('button', { name: '开始导入' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('服务暂时不可用');
  expect(within(dialog).getByLabelText(/兑换码内容/)).toHaveValue('NEW-CODE');
  await user.click(within(dialog).getByRole('button', { name: '开始导入' }));
  expect(await within(dialog).findByText('导入完成：成功 1 条，失败 0 条。')).toBeVisible();
  expect(create).toHaveBeenCalledTimes(1);
  expect(importCodes).toHaveBeenCalledTimes(2);
  expect(importCodes).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: JSON.stringify({ text: 'NEW-CODE' }) }),
  );
  await user.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('修改名称遇到重名时保持弹窗，修正后更新详情标题', async () => {
  let name = pool.name;
  const rename = vi.fn((init: RequestInit) => {
    const next = JSON.parse(init.body as string).name as string;
    if (next === '重复名称') return json({ code: 'POOL_NAME_EXISTS' }, 409);
    name = next;
    return json({ id: pool.id, name } satisfies ApiResponses['renamePool']);
  });
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools': () =>
      json({ items: [{ ...pool, name }] } satisfies ApiResponses['pools']),
    'POST /api/manage/pools/1/name': rename,
  });
  const user = userEvent.setup();
  renderManager(String(pool.id));
  const more = await screen.findByRole('button', { name: '更多' });
  expect(screen.queryByRole('button', { name: '修改名称' })).not.toBeInTheDocument();
  await user.click(more);
  expect(more).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard('{Escape}');
  expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(more).toHaveFocus();
  expect(screen.queryByRole('button', { name: '修改名称' })).not.toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: '更多' }));
  await user.click(await screen.findByRole('button', { name: '修改名称' }));
  const submit = screen.getByRole('button', { name: '保存名称' });
  const input = screen.getByLabelText('码池名称');
  expect(submit).toBeDisabled();
  await user.clear(input);
  await user.type(input, '重复名称');
  await user.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('当前空间已有同名码池');
  await user.clear(input);
  await user.type(input, '新的活动');
  await user.click(submit);
  expect(await screen.findByRole('heading', { name: '新的活动', level: 1 })).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '更多' }));
  const keyToggle = screen.getByRole('button', { name: '查看领码 Key' });
  expect(keyToggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(keyToggle);
  expect(screen.getByText(pool.claimKey)).toBeVisible();
  expect(screen.queryByRole('group', { name: '码池操作' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '更多' }));
  expect(screen.getByRole('button', { name: '查看领码 Key' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await user.click(screen.getByRole('button', { name: '查看领码 Key' }));
  expect(screen.getByText(pool.claimKey)).not.toBeVisible();
});

test('批量导入展示原始失败行和成功数量，完成后防止重复导入并刷新统计', async () => {
  let imported = false;
  const importCodes = vi.fn(() => {
    imported = true;
    return json({
      succeeded: 1,
      failed: 1,
      failures: [
        {
          line: 2,
          code: 'CODE-A',
          reasonCode: 'DUPLICATE_IN_BATCH',
          params: { firstLine: 1 },
        },
      ],
    } satisfies ApiResponses['importCodes']);
  });
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools': () =>
      json({
        items: [{ ...pool, total: imported ? 3 : 2, remaining: imported ? 3 : 2 }],
      } satisfies ApiResponses['pools']),
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () =>
      json({
        counts: { all: imported ? 3 : 2, unclaimed: imported ? 3 : 2, claimed: 0, redeemed: 0 },
        summary: {
          total: imported ? 3 : 2,
          remaining: imported ? 3 : 2,
          claimed: 0 + 0,
          redeemed: 0,
        },
        items: [],
        total: imported ? 3 : 2,
        page: 1,
        pageSize: 20,
      } satisfies ApiResponses['codes']),
    'POST /api/manage/pools/1/import': importCodes,
  });
  const user = userEvent.setup();
  renderManager(String(pool.id));
  await user.click(await screen.findByRole('button', { name: '添加兑换码' }));
  const dialog = screen.getByRole('dialog', { name: '添加兑换码' });
  const submit = within(dialog).getByRole('button', { name: '开始导入' });
  expect(submit).toBeDisabled();
  const input = within(dialog).getByLabelText(/兑换码内容/);
  await user.type(input, 'CODE-A\nCODE-A');
  await user.click(submit);
  expect(await within(dialog).findByRole('status')).toHaveTextContent(
    '导入完成：成功 1 条，失败 1 条',
  );
  expect(within(dialog).getByText('第 2 行')).toBeVisible();
  expect(within(dialog).getByText('与本批第 1 行重复')).toBeVisible();
  expect(submit).toBeDisabled();
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: '码池统计' })).getByText('总数').parentElement,
    ).toHaveTextContent('总数3'),
  );
  expect(importCodes).toHaveBeenCalledWith(
    expect.objectContaining({ body: JSON.stringify({ text: 'CODE-A\nCODE-A' }) }),
  );
  await user.clear(input);
  await user.type(input, 'CODE-B');
  expect(submit).toBeEnabled();
  expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
});

test('批量导入超过 500 条时禁止提交', async () => {
  mockApi(baseRoutes);
  const user = userEvent.setup();
  renderManager(String(pool.id));
  await user.click(await screen.findByRole('button', { name: '添加兑换码' }));
  await user.click(screen.getByLabelText(/兑换码内容/));
  await user.paste(Array.from({ length: 501 }, (_, i) => `CODE-${i}`).join('\n'));
  expect(screen.getByText('501 / 500 条')).toBeVisible();
  expect(screen.getByRole('button', { name: '开始导入' })).toBeDisabled();
});

test('按每页条数翻页，切换条数或使用状态筛选回到第一页', async () => {
  const row: ApiResponses['codes']['items'][number] = {
    id: 1,
    code: 'FIRST-PAGE',
    status: 'unclaimed',
    claimedAt: null,
    remark: null,

    redeemedMarkedAt: null,
    createdAt: pool.createdAt,
  };
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () =>
      json({
        counts: { all: 51, unclaimed: 51, claimed: 0, redeemed: 0 },
        summary: { total: 51, remaining: 51, claimed: 0 + 0, redeemed: 0 },
        items: [row],
        total: 51,
        page: 1,
        pageSize: 20,
      } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=2&status=all&pageSize=20': () =>
      json({
        counts: { all: 51, unclaimed: 51, claimed: 0, redeemed: 0 },
        summary: { total: 51, remaining: 51, claimed: 0 + 0, redeemed: 0 },
        items: [{ ...row, code: 'SECOND-PAGE' }],
        total: 51,
        page: 2,
        pageSize: 20,
      } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=50': () =>
      json({
        counts: { all: 51, unclaimed: 51, claimed: 0, redeemed: 0 },
        summary: { total: 51, remaining: 51, claimed: 0 + 0, redeemed: 0 },
        items: Array.from({ length: 50 }, (_, i) => ({
          ...row,
          id: i + 1,
          code: `LARGE-PAGE-${i}`,
        })),
        total: 51,
        page: 1,
        pageSize: 50,
      } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=2&status=all&pageSize=50': () =>
      json({
        counts: { all: 51, unclaimed: 51, claimed: 0, redeemed: 0 },
        summary: { total: 51, remaining: 51, claimed: 0 + 0, redeemed: 0 },
        items: [{ ...row, code: 'LAST-PAGE' }],
        total: 51,
        page: 2,
        pageSize: 50,
      } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=1&status=claimed&pageSize=50': () =>
      json({
        counts: { all: 1, unclaimed: 1, claimed: 0, redeemed: 0 },
        summary: { total: 1, remaining: 1, claimed: 0 + 0, redeemed: 0 },
        items: [{ ...row, code: 'UNUSED-CODE', status: 'claimed', claimedAt: pool.createdAt }],
        total: 1,
        page: 1,
        pageSize: 50,
      } satisfies ApiResponses['codes']),
  });
  const user = userEvent.setup();
  renderManager(String(pool.id));
  await screen.findByText('FIRST-PAGE');
  expect(screen.getByRole('combobox', { name: '每页条数' })).toHaveValue('20');
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '下一页' }));
  expect(await screen.findByText('SECOND-PAGE')).toBeVisible();
  expect(screen.queryByText('FIRST-PAGE')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole('combobox', { name: '每页条数' }), '50');
  await screen.findByText('LARGE-PAGE-0');
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(51);
  expect(screen.queryByText('SECOND-PAGE')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '下一页' }));
  expect(await screen.findByText('LAST-PAGE')).toBeVisible();
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '已领取' }));
  expect(await screen.findByText('UNUSED-CODE')).toBeVisible();
  expect(screen.queryByText('LAST-PAGE')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '每页条数' })).toHaveValue('50');
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
});

test('停止和恢复发放后刷新状态，提交正确的目标状态', async () => {
  let status = pool.status;
  const setStatus = vi.fn((init: RequestInit) => {
    status = JSON.parse(init.body as string).status;
    return json({ status } satisfies ApiResponses['poolStatus']);
  });
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools': () =>
      json({ items: [{ ...pool, status }] } satisfies ApiResponses['pools']),
    'POST /api/manage/pools/1/status': setStatus,
  });
  const user = userEvent.setup();
  renderManager(String(pool.id));
  await user.click(await screen.findByRole('button', { name: '更多' }));
  await user.click(await screen.findByRole('button', { name: '停止发放' }));
  expect(await screen.findByText('已停止')).toBeVisible();
  expect(setStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: JSON.stringify({ status: 'stopped' }) }),
  );
  await user.click(await screen.findByRole('button', { name: '更多' }));
  await user.click(screen.getByRole('button', { name: '恢复发放' }));
  expect(await screen.findByText('发放中')).toBeVisible();
  expect(setStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: JSON.stringify({ status: 'active' }) }),
  );
});

test('删除需确认，取消不发请求；失败可重试，提交中不能重复删除或关闭', async () => {
  const pending = deferred<Response>();
  const remove = vi
    .fn()
    .mockImplementationOnce(() => json({ code: 'SERVICE_UNAVAILABLE' }, 500))
    .mockImplementationOnce(() => pending.promise);
  const fetch = mockApi({ ...baseRoutes, 'DELETE /api/manage/pools/1': remove });
  const user = userEvent.setup();
  const { onNavigate } = renderManager(String(pool.id));
  await user.click(await screen.findByRole('button', { name: '更多' }));
  await user.click(await screen.findByRole('button', { name: '删除码池' }));
  let dialog = screen.getByRole('dialog', { name: '删除码池' });
  expect(dialog).toHaveTextContent(pool.name);
  expect(dialog).toHaveTextContent('此操作无法撤销');
  await user.click(within(dialog).getByRole('button', { name: '取消' }));
  expect(remove).not.toHaveBeenCalled();
  expect(onNavigate).not.toHaveBeenCalled();
  await user.click(await screen.findByRole('button', { name: '更多' }));
  await user.click(screen.getByRole('button', { name: '删除码池' }));
  dialog = screen.getByRole('dialog', { name: '删除码池' });
  await user.click(within(dialog).getByRole('button', { name: '确认删除' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('服务暂时不可用');
  expect(onNavigate).not.toHaveBeenCalled();
  await user.dblClick(within(dialog).getByRole('button', { name: '确认删除' }));
  expect(within(dialog).getByRole('button', { name: '正在删除…' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
  expect(within(dialog).queryByRole('button', { name: '关闭弹窗' })).not.toBeInTheDocument();
  expect(remove).toHaveBeenCalledTimes(2);
  const deleteCall = fetch.mock.calls.find(([, init]) => init?.method === 'DELETE');
  expect(new Headers(deleteCall?.[1]?.headers).get('Content-Type')).toBe('application/json');
  pending.resolve(json({ ok: true } satisfies ApiResponses['deletePool']));
  await waitFor(() => expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/manage'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('码池已被其他页面删除时，再次删除也返回列表', async () => {
  mockApi({
    ...baseRoutes,
    'DELETE /api/manage/pools/1': () => json({ code: 'POOL_NOT_FOUND' }, 404),
  });
  const user = userEvent.setup();
  const { onNavigate } = renderManager(String(pool.id));
  await user.click(await screen.findByRole('button', { name: '更多' }));
  await user.click(await screen.findByRole('button', { name: '删除码池' }));
  await user.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(onNavigate).toHaveBeenCalledExactlyOnceWith('/manage'));
});

const unclaimedCode: ApiResponses['codes']['items'][number] = {
  id: 1,
  code: 'AVAILABLE-CODE',
  status: 'unclaimed',
  claimedAt: null,
  remark: null,

  redeemedMarkedAt: null,
  createdAt: pool.createdAt,
};
const unusedCode = {
  ...unclaimedCode,
  id: 2,
  code: 'UNUSED-CODE',
  status: 'claimed' as const,
  claimedAt: pool.createdAt,
};
const usedCode = {
  ...unusedCode,
  id: 3,
  code: 'USED-CODE',
  status: 'redeemed' as const,
  redeemedMarkedAt: pool.createdAt + 3_600_000,
};

test('明细显示三种状态和使用时间，仅待领取可删除，三种筛选请求各自状态', async () => {
  const codeRows = [unclaimedCode, unusedCode, usedCode];
  const page = (items: typeof codeRows) =>
    json({
      counts: { all: 3, unclaimed: 1, claimed: 1, redeemed: 1 },
      summary: { total: 3, remaining: 1, claimed: 1 + 1, redeemed: 1 },
      items,
      total: items.length,
      page: 1,
      pageSize: 20,
    } satisfies ApiResponses['codes']);
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () => page(codeRows),
    'GET /api/manage/pools/1/codes?page=1&status=unclaimed&pageSize=20': () =>
      page([unclaimedCode]),
    'GET /api/manage/pools/1/codes?page=1&status=claimed&pageSize=20': () => page([unusedCode]),
    'GET /api/manage/pools/1/codes?page=1&status=redeemed&pageSize=20': () => page([usedCode]),
  });
  const user = userEvent.setup();
  renderManager('1');
  await screen.findByText(unclaimedCode.code);
  for (const [code, label] of [
    [unclaimedCode, '待领取'],
    [unusedCode, '已领取'],
    [usedCode, '已兑换'],
  ] as const) {
    const row = screen.getByText(code.code).closest('tr')!;
    expect(within(row).getByText(label)).toBeVisible();
    expect(within(row).queryByRole('button', { name: '删除兑换码' })).not.toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: `展开 ${code.code} 详情` }));
    expect(screen.queryByRole('button', { name: '删除兑换码' }) !== null).toBe(
      code === unclaimedCode,
    );
    await user.click(within(row).getByRole('button', { name: `收起 ${code.code} 详情` }));
  }
  await user.click(screen.getByRole('button', { name: `展开 ${usedCode.code} 详情` }));
  const expectedTime = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(usedCode.redeemedMarkedAt);
  expect(screen.getByText(expectedTime)).toBeVisible();
  expect(screen.getByText('兑换标记时间')).toBeVisible();
  expect(screen.queryByRole('columnheader', { name: '兑换标记时间' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: `收起 ${usedCode.code} 详情` }));
  for (const [label, code] of [
    ['已兑换', usedCode],
    ['已领取', unusedCode],
    ['待领取', unclaimedCode],
  ] as const) {
    await user.click(screen.getByRole('button', { name: label }));
    await screen.findByText(code.code);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  }
});

test('删除兑换码可取消和重试，提交期间禁用操作，删除末页最后一条后刷新统计并退页', async () => {
  const pending = deferred<Response>();
  let removed = false;
  const remove = vi
    .fn()
    .mockImplementationOnce(() => json({ code: 'SERVICE_UNAVAILABLE' }, 500))
    .mockImplementationOnce(async () => {
      const response = await pending.promise;
      removed = true;
      return response;
    });
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools': () =>
      json({
        items: [{ ...pool, total: removed ? 20 : 21, remaining: removed ? 20 : 21 }],
      } satisfies ApiResponses['pools']),
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () =>
      json({
        counts: { all: removed ? 20 : 21, unclaimed: removed ? 20 : 21, claimed: 0, redeemed: 0 },
        summary: {
          total: removed ? 20 : 21,
          remaining: removed ? 20 : 21,
          claimed: 0 + 0,
          redeemed: 0,
        },
        items: [{ ...unclaimedCode, id: 2, code: 'FIRST-PAGE' }],
        total: removed ? 20 : 21,
        page: 1,
        pageSize: 20,
      } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=2&status=all&pageSize=20': () =>
      json({
        counts: { all: removed ? 20 : 21, unclaimed: removed ? 20 : 21, claimed: 0, redeemed: 0 },
        summary: {
          total: removed ? 20 : 21,
          remaining: removed ? 20 : 21,
          claimed: 0 + 0,
          redeemed: 0,
        },
        items: removed ? [] : [unclaimedCode],
        total: removed ? 20 : 21,
        page: 2,
        pageSize: 20,
      } satisfies ApiResponses['codes']),
    'DELETE /api/manage/pools/1/codes/1': remove,
  });
  const user = userEvent.setup();
  renderManager('1');
  await screen.findByText('FIRST-PAGE');
  await user.click(screen.getByRole('button', { name: '下一页' }));
  await user.click(await screen.findByRole('button', { name: `展开 ${unclaimedCode.code} 详情` }));
  await user.click(screen.getByRole('button', { name: '删除兑换码' }));
  expect(screen.getByRole('dialog')).toHaveTextContent(unclaimedCode.code);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '删除兑换码' }));
  await user.click(screen.getByRole('button', { name: '确认删除' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用');
  await user.dblClick(screen.getByRole('button', { name: '确认删除' }));
  expect(remove).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '正在删除…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  // jsdom does not turn Escape into a native dialog cancel event.
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.getByRole('dialog')).toBeVisible();
  pending.resolve(json({ ok: true } satisfies ApiResponses['deleteCode']));
  expect(await screen.findByText('FIRST-PAGE')).toBeVisible();
  expect(screen.queryByText(unclaimedCode.code)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('1 / 1')).toBeVisible();
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: '码池统计' })).getByText('可领取').parentElement,
    ).toHaveTextContent('20'),
  );
});

test.each([false, true])(
  '删除时处理领取冲突或已删除（已领取：%s），刷新列表且禁止误删',
  async (claimed) => {
    let changed = false;
    const remove = vi.fn(() => {
      changed = true;
      return json({ code: claimed ? 'CODE_NOT_AVAILABLE' : 'CODE_NOT_FOUND' }, claimed ? 409 : 404);
    });
    mockApi({
      ...baseRoutes,
      'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () => {
        const items = changed
          ? claimed
            ? [{ ...unclaimedCode, status: 'claimed' as const, claimedAt: pool.createdAt }]
            : []
          : [unclaimedCode];
        return json({
          counts: { all: 3, unclaimed: 1, claimed: 1, redeemed: 1 },
          summary: { total: 3, remaining: 1, claimed: 1 + 1, redeemed: 1 },
          items,
          total: items.length,
          page: 1,
          pageSize: 20,
        } satisfies ApiResponses['codes']);
      },
      'DELETE /api/manage/pools/1/codes/1': remove,
    });
    const user = userEvent.setup();
    renderManager('1');
    await user.click(
      await screen.findByRole('button', { name: `展开 ${unclaimedCode.code} 详情` }),
    );
    await user.click(screen.getByRole('button', { name: '删除兑换码' }));
    await user.click(screen.getByRole('button', { name: '确认删除' }));
    if (claimed) {
      expect(await screen.findByRole('alert')).toHaveTextContent('仅待领取的兑换码可以删除');
      expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled();
      await waitFor(() =>
        expect(within(screen.getByRole('table')).getByText('已领取')).toBeVisible(),
      );
      await user.click(screen.getByRole('button', { name: '取消' }));
    } else {
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(await screen.findByText('暂无兑换码记录')).toBeVisible();
    }
    expect(screen.queryByRole('button', { name: '删除兑换码' })).not.toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
  },
);

test('批量选择仅在待领取页签出现，全选限定当前页，翻页、切换条数及刷新清空选择', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    ...unclaimedCode,
    id: i + 1,
    code: `SELECT-${i + 1}`,
  }));
  const response = (page: number, size: number) =>
    json({
      counts: { all: rows.length, unclaimed: rows.length, claimed: 0, redeemed: 0 },
      summary: { total: rows.length, remaining: rows.length, claimed: 0 + 0, redeemed: 0 },
      items: rows.slice((page - 1) * size, page * size),
      total: rows.length,
      page,
      pageSize: size,
    } satisfies ApiResponses['codes']);
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools/1/codes?page=1&status=unclaimed&pageSize=20': () => response(1, 20),
    'GET /api/manage/pools/1/codes?page=2&status=unclaimed&pageSize=20': () => response(2, 20),
    'GET /api/manage/pools/1/codes?page=1&status=unclaimed&pageSize=50': () => response(1, 50),
  });
  const user = userEvent.setup();
  renderManager('1');
  await screen.findByRole('button', { name: '待领取' });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '批量删除' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '待领取' }));
  await screen.findByText('SELECT-1');
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: '选择兑换码 SELECT-1' }));
  expect(screen.getByRole('checkbox', { name: '全选当前页' })).toBePartiallyChecked();
  await user.click(screen.getByRole('checkbox', { name: '全选当前页' }));
  expect(screen.getByText('已选 20 条 · 仅当前页')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('SELECT-21');
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: '全选当前页' }));
  expect(screen.getByText('已选 1 条 · 仅当前页')).toBeVisible();
  await user.selectOptions(screen.getByRole('combobox', { name: '每页条数' }), '50');
  await screen.findByText('SELECT-1');
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: '全选当前页' }));
  expect(screen.getByText('已选 21 条 · 仅当前页')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '刷新数据' }));
  await screen.findByText('SELECT-1');
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: '全选当前页' }));
  await user.click(screen.getByRole('checkbox', { name: '全选当前页' }));
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
});

test.each([0, 1])(
  '批量删除确认、失败重试和防重复提交，成功后展示删除及跳过数（跳过 %s）',
  async (skipped) => {
    const second = { ...unclaimedCode, id: 2, code: 'BULK-SECOND' };
    let completed = false;
    const pending = deferred<Response>();
    const remove = vi
      .fn()
      .mockImplementationOnce(() => json({ code: 'SERVICE_UNAVAILABLE' }, 500))
      .mockImplementationOnce(async () => {
        const response = await pending.promise;
        completed = true;
        return response;
      });
    mockApi({
      ...baseRoutes,
      'GET /api/manage/pools': () =>
        json({
          items: [
            {
              ...pool,
              total: completed ? skipped : 2,
              remaining: completed ? 0 : 2,
              claimed: completed ? skipped : 0,
            },
          ],
        } satisfies ApiResponses['pools']),
      'GET /api/manage/pools/1/codes?page=1&status=unclaimed&pageSize=20': () =>
        json({
          counts: { all: completed ? 0 : 2, unclaimed: completed ? 0 : 2, claimed: 0, redeemed: 0 },
          summary: {
            total: completed ? 0 : 2,
            remaining: completed ? 0 : 2,
            claimed: 0 + 0,
            redeemed: 0,
          },
          items: completed ? [] : [unclaimedCode, second],
          total: completed ? 0 : 2,
          page: 1,
          pageSize: 20,
        } satisfies ApiResponses['codes']),
      'DELETE /api/manage/pools/1/codes': remove,
    });
    const user = userEvent.setup();
    renderManager('1');
    await user.click(await screen.findByRole('button', { name: '待领取' }));
    await screen.findByText(unclaimedCode.code);
    await user.click(screen.getByRole('checkbox', { name: '全选当前页' }));
    await user.click(screen.getByRole('button', { name: '批量删除' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(unclaimedCode.code)).toBeVisible();
    expect(within(dialog).getByText(second.code)).toBeVisible();
    expect(dialog).toHaveTextContent('确认删除选中的 2 个兑换码');
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText('已选 2 条 · 仅当前页')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '批量删除' }));
    dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('服务暂时不可用');
    await user.dblClick(within(dialog).getByRole('button', { name: '确认删除' }));
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: JSON.stringify({ ids: [1, 2] }) }),
    );
    expect(within(dialog).getByRole('button', { name: '正在删除…' })).toBeDisabled();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(dialog).toBeVisible();
    pending.resolve(json({ deleted: 2 - skipped, skipped } satisfies ApiResponses['deleteCodes']));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('暂无兑换码记录')).toBeVisible();
    expect(
      screen.getAllByRole('status').find((node) => node.classList.contains('notice'))!,
    ).toHaveTextContent(
      skipped ? '已删除 1 个兑换码，跳过 1 个（已领取、已兑换或不存在）。' : '已删除 2 个兑换码。',
    );
    expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '全选当前页' })).toBeDisabled();
  },
);
