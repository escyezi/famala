import type { ApiResponses } from './helpers.ts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Manager } from '../../src/react-app/components/Manager.tsx';
import { json, mockApi, pool } from './helpers.ts';

const baseRoutes = {
  'GET /api/manage/pools': () => json({ items: [pool] } satisfies ApiResponses['pools']),
  'GET /api/manage/pools/pool-1/codes?page=1&status=all': () =>
    json({ items: [], total: 0, page: 1, pageSize: 50 } satisfies ApiResponses['codes']),
};

function renderManager(poolId?: string) {
  const onNavigate = vi.fn();
  render(<Manager poolId={poolId} onNavigate={onNavigate} />);
  return { onNavigate };
}

test('创建码池去掉名称首尾空白，成功后导航至新码池', async () => {
  const create = vi.fn(() => json({ id: 'new-pool' } satisfies ApiResponses['createPool'], 201));
  mockApi({ ...baseRoutes, 'POST /api/manage/pools': create });
  const user = userEvent.setup();
  const { onNavigate } = renderManager();
  await screen.findByRole('heading', { name: pool.name });
  await user.click(screen.getByRole('button', { name: '新建兑换码池' }));
  const dialog = screen.getByRole('dialog', { name: '新建兑换码池' });
  const submit = within(dialog).getByRole('button', { name: '创建空池' });
  expect(submit).toBeDisabled();
  await user.type(within(dialog).getByLabelText('码池名称'), '  十月福利  ');
  await user.click(submit);
  await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/manage/pools/new-pool'));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ body: JSON.stringify({ name: '十月福利' }) }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('修改名称遇到重名时保持弹窗，修正后更新详情标题', async () => {
  let name = pool.name;
  const rename = vi.fn((init: RequestInit) => {
    const next = JSON.parse(init.body as string).name as string;
    if (next === '重复名称') return json({ error: '码池名称已存在' }, 409);
    name = next;
    return json({ id: pool.id, name } satisfies ApiResponses['renamePool']);
  });
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools': () =>
      json({ items: [{ ...pool, name }] } satisfies ApiResponses['pools']),
    'POST /api/manage/pools/pool-1/name': rename,
  });
  const user = userEvent.setup();
  renderManager(pool.id);
  await user.click(await screen.findByRole('button', { name: '修改名称' }));
  const submit = screen.getByRole('button', { name: '保存名称' });
  const input = screen.getByLabelText('码池名称');
  expect(submit).toBeDisabled();
  await user.clear(input);
  await user.type(input, '重复名称');
  await user.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('码池名称已存在');
  await user.clear(input);
  await user.type(input, '新的活动');
  await user.click(submit);
  expect(await screen.findByRole('heading', { name: '新的活动', level: 1 })).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText(pool.claimKey)).toBeVisible();
});

test('批量导入展示原始失败行和成功数量，完成后防止重复导入并刷新统计', async () => {
  let imported = false;
  const importCodes = vi.fn(() => {
    imported = true;
    return json({
      succeeded: 1,
      failed: 1,
      failures: [{ line: 2, code: 'CODE-A', reason: '与本批第 1 行重复' }],
    } satisfies ApiResponses['importCodes']);
  });
  mockApi({
    ...baseRoutes,
    'GET /api/manage/pools': () =>
      json({
        items: [{ ...pool, total: imported ? 3 : 2, remaining: imported ? 3 : 2 }],
      } satisfies ApiResponses['pools']),
    'POST /api/manage/pools/pool-1/import': importCodes,
  });
  const user = userEvent.setup();
  renderManager(pool.id);
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
  expect(await screen.findByText('0 / 3')).toBeVisible();
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
  renderManager(pool.id);
  await user.click(await screen.findByRole('button', { name: '导入兑换码' }));
  await user.click(screen.getByLabelText(/兑换码内容/));
  await user.paste(Array.from({ length: 501 }, (_, i) => `CODE-${i}`).join('\n'));
  expect(screen.getByText('501 / 500 条')).toBeVisible();
  expect(screen.getByRole('button', { name: '开始导入' })).toBeDisabled();
});

test('按接口 pageSize 分页，切换领取筛选时回到第一页并更新明细', async () => {
  const row: ApiResponses['codes']['items'][number] = {
    id: 'code-1',
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
    'GET /api/manage/pools/pool-1/codes?page=1&status=all': () =>
      json({ items: [row], total: 2, page: 1, pageSize: 1 } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/pool-1/codes?page=2&status=all': () =>
      json({
        items: [{ ...row, code: 'SECOND-PAGE' }],
        total: 2,
        page: 2,
        pageSize: 1,
      } satisfies ApiResponses['codes']),
    'GET /api/manage/pools/pool-1/codes?page=1&status=claimed': () =>
      json({
        items: [{ ...row, code: 'CLAIMED-CODE', claimStatus: 'claimed' }],
        total: 1,
        page: 1,
        pageSize: 50,
      } satisfies ApiResponses['codes']),
  });
  const user = userEvent.setup();
  renderManager(pool.id);
  await screen.findByText('FIRST-PAGE');
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '下一页' }));
  expect(await screen.findByText('SECOND-PAGE')).toBeVisible();
  expect(screen.queryByText('FIRST-PAGE')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '已领取' }));
  expect(await screen.findByText('CLAIMED-CODE')).toBeVisible();
  expect(screen.queryByText('SECOND-PAGE')).not.toBeInTheDocument();
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
    'POST /api/manage/pools/pool-1/status': setStatus,
  });
  const user = userEvent.setup();
  renderManager(pool.id);
  await user.click(await screen.findByRole('button', { name: '停止发放' }));
  expect(await screen.findByText('已停止')).toBeVisible();
  expect(setStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: JSON.stringify({ status: 'stopped' }) }),
  );
  await user.click(screen.getByRole('button', { name: '恢复发放' }));
  expect(await screen.findByText('发放中')).toBeVisible();
  expect(setStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ body: JSON.stringify({ status: 'active' }) }),
  );
});
