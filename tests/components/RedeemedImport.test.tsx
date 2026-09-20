import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ImportDialog } from '../../src/react-app/components/PoolDialogs.tsx';
import { PoolDetail } from '../../src/react-app/components/PoolDetail.tsx';
import { i18n } from '../../src/react-app/i18n/index.ts';
import type { CodePage } from '../../src/shared/api-types.ts';
import { deferred, json, mockApi, pool, type ApiResponses } from './helpers.ts';

const result = {
  marked: 1,
  alreadyRedeemed: 1,
  removedFromAvailable: 1,
  failed: 1,
  failures: [{ line: 3, code: 'MISSING', reasonCode: 'CODE_NOT_IN_POOL' as const }],
} satisfies ApiResponses['importRedeemed'];

test('redeemed codes submit directly without preview, lock while pending and show detailed results', async () => {
  const pending = deferred<Response>();
  const importer = vi.fn(() => pending.promise);
  const refreshed = vi.fn();
  mockApi({ 'POST /api/manage/pools/1/redeemed/import': importer });
  const user = userEvent.setup();
  render(<ImportDialog pool={pool} mode="redeemed" onClose={vi.fn()} onImported={refreshed} />);
  const input = screen.getByRole('textbox', { name: /兑换码内容/ });
  await user.type(input, 'A\nB\nMISSING');
  expect(screen.getByRole('dialog')).toHaveTextContent('标记暂不支持撤销');
  expect(screen.queryByRole('button', { name: /预览|确认/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '导入并标记' }));
  expect(importer).toHaveBeenCalledOnce();
  expect(importer).toHaveBeenCalledWith(
    expect.objectContaining({ body: JSON.stringify({ text: 'A\nB\nMISSING' }) }),
  );
  expect(input).toBeDisabled();
  expect(screen.getByRole('button', { name: '正在导入…' })).toBeDisabled();
  await act(async () => pending.resolve(json(result)));
  expect(screen.getByRole('dialog')).toHaveTextContent('新增标记 1 条，已标记 1 条，失败 1 条');
  expect(screen.getByRole('dialog')).toHaveTextContent('本次减少可领取库存 1 条');
  expect(screen.getByText('第 3 行')).toBeVisible();
  expect(screen.getByText('当前码池中未找到此兑换码')).toBeVisible();
  expect(refreshed).toHaveBeenCalledOnce();
  expect(input).toHaveValue('A\nB\nMISSING');
  expect(screen.getByRole('button', { name: '导入并标记' })).toBeDisabled();
  await user.type(input, '\nC');
  expect(screen.getByRole('button', { name: '导入并标记' })).toBeEnabled();
});

test('network failure retains input and allows retry; English results and reasons are translated', async () => {
  await i18n.changeLanguage('en');
  const importer = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Network error'))
    .mockImplementationOnce(() => json(result));
  const refreshed = vi.fn();
  mockApi({ 'POST /api/manage/pools/1/redeemed/import': importer });
  const user = userEvent.setup();
  render(<ImportDialog pool={pool} mode="redeemed" onClose={vi.fn()} onImported={refreshed} />);
  const input = screen.getByRole('textbox', { name: /Codes to import/ });
  await user.type(input, 'A\nB\nMISSING');
  await user.click(screen.getByRole('button', { name: 'Import and mark' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Network');
  expect(input).toHaveValue('A\nB\nMISSING');
  expect(refreshed).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Import and mark' }));
  expect(await screen.findByText('Code not found in this pool.')).toBeVisible();
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '1 newly marked, 1 already marked, 1 failed',
  );
  expect(refreshed).toHaveBeenCalledOnce();
});

test('redeemed import invalidates selection and cached inventory; failed refresh remains read-only until retry', async () => {
  let imported = false;
  let refreshFails = true;
  const row = {
    id: 1,
    code: 'ONLY-CODE',
    status: 'unclaimed' as const,
    claimedAt: null,
    remark: null,
    redeemedMarkedAt: null,
    createdAt: pool.createdAt,
  };
  const page = (): CodePage => ({
    items: imported ? [] : [row],
    total: imported ? 0 : 1,
    page: 1,
    pageSize: 20,
    counts: { all: 1, unclaimed: imported ? 0 : 1, claimed: 0, redeemed: imported ? 1 : 0 },
    summary: { total: 1, remaining: imported ? 0 : 1, claimed: 0, redeemed: imported ? 1 : 0 },
  });
  const refreshed = vi.fn();
  mockApi({
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () => json(page()),
    'GET /api/manage/pools/1/codes?page=1&status=unclaimed&pageSize=20': () =>
      imported && refreshFails ? json({ code: 'SERVICE_UNAVAILABLE' }, 500) : json(page()),
    'POST /api/manage/pools/1/redeemed/import': () => {
      imported = true;
      return json({
        marked: 1,
        alreadyRedeemed: 0,
        removedFromAvailable: 1,
        failed: 0,
        failures: [],
      } satisfies ApiResponses['importRedeemed']);
    },
  });
  const user = userEvent.setup();
  render(
    <PoolDetail
      pool={pool}
      error={null}
      onRefresh={refreshed}
      onStatusCommitted={vi.fn()}
      onNavigate={vi.fn()}
      onDeleted={vi.fn()}
    />,
  );
  await screen.findByText('ONLY-CODE');
  await user.click(screen.getByRole('button', { name: '待领取' }));
  const checkbox = await screen.findByRole('checkbox', { name: '选择兑换码 ONLY-CODE' });
  await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: '更多' }));
  await user.click(screen.getByRole('button', { name: '标记已兑换' }));
  await user.type(screen.getByRole('textbox', { name: /兑换码内容/ }), 'ONLY-CODE');
  await user.click(screen.getByRole('button', { name: '导入并标记' }));
  expect(await screen.findByText(/数据尚未更新/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.getByRole('button', { name: '待领取' })).toHaveAttribute('aria-pressed', 'true');
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeDisabled();
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
  const statistics = screen.getByRole('region', { name: '码池统计' });
  expect(within(statistics).getByText('可领取').nextElementSibling).toHaveTextContent('—');
  refreshFails = false;
  await user.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.getByText('暂无兑换码记录')).toBeVisible());
  expect(within(statistics).getByText('可领取').nextElementSibling).toHaveTextContent('0');
  expect(within(statistics).getByText('累计领取').nextElementSibling).toHaveTextContent('0');
  expect(within(statistics).getByText('已确认兑换').nextElementSibling).toHaveTextContent('1');
  expect(refreshed).toHaveBeenCalledOnce();
});

test('late import response cannot refresh an unmounted pool', async () => {
  const pending = deferred<Response>();
  const refreshed = vi.fn();
  mockApi({ 'POST /api/manage/pools/1/redeemed/import': () => pending.promise });
  const user = userEvent.setup();
  const view = render(
    <ImportDialog pool={pool} mode="redeemed" onClose={vi.fn()} onImported={refreshed} />,
  );
  await user.type(screen.getByRole('textbox', { name: /兑换码内容/ }), 'A');
  await user.click(screen.getByRole('button', { name: '导入并标记' }));
  view.unmount();
  await act(async () => pending.resolve(json(result)));
  expect(refreshed).not.toHaveBeenCalled();
});
