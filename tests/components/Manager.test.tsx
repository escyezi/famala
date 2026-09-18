import type { ApiResponses } from './helpers.ts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Manager } from '../../src/react-app/components/Manager.tsx';
import { deferred, json, mockApi, pool } from './helpers.ts';

const baseRoutes = {
  'GET /api/manage/pools': () => json({ items: [pool] } satisfies ApiResponses['pools']),
  'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () =>
    json({ items: [], total: 0, page: 1, pageSize: 20 } satisfies ApiResponses['codes']),
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
  const dialog = await screen.findByRole('dialog', { name: '导入兑换码' });
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
  const keyToggle = screen.getByRole('button', { name: '查看领码 Key' });
  expect(keyToggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(keyToggle);
  expect(keyToggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(pool.claimKey)).toBeVisible();
  await user.click(keyToggle);
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
    'POST /api/manage/pools/1/import': importCodes,
  });
  const user = userEvent.setup();
  renderManager(String(pool.id));
  await user.click(await screen.findByRole('button', { name: '导入兑换码' }));
  const dialog = screen.getByRole('dialog', { name: '导入兑换码' });
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
  await user.click(await screen.findByRole('button', { name: '导入兑换码' }));
  await user.click(screen.getByLabelText(/兑换码内容/));
  await user.paste(Array.from({ length: 501 }, (_, i) => `CODE-${i}`).join('\n'));
  expect(screen.getByText('501 / 500 条')).toBeVisible();
  expect(screen.getByRole('button', { name: '开始导入' })).toBeDisabled();
});

test('按每页条数翻页，切换条数或领取筛选回到第一页', async () => {
  const row: ApiResponses['codes']['items'][number] = {
    id: 1,
    code: 'FIRST-PAGE',
    claimStatus: 'unclaimed',
    claimedAt: null,
    remark: null,
    userMarkedUsed: false,
    userMarkedUsedAt: null,
    createdAt: pool.createdAt,
  };
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () =>
      json({ items: [row], total: 51, page: 1, pageSize: 20 } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=2&status=all&pageSize=20': () =>
      json({
        items: [{ ...row, code: 'SECOND-PAGE' }],
        total: 51,
        page: 2,
        pageSize: 20,
      } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=50': () =>
      json({
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
        items: [{ ...row, code: 'LAST-PAGE' }],
        total: 51,
        page: 2,
        pageSize: 50,
      } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/1/codes?page=1&status=claimed&pageSize=50': () =>
      json({
        items: [{ ...row, code: 'CLAIMED-CODE', claimStatus: 'claimed' }],
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
  expect(await screen.findByText('CLAIMED-CODE')).toBeVisible();
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
