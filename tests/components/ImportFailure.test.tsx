import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Manager } from '../../src/react-app/components/Manager.tsx';
import { ImportDialog } from '../../src/react-app/components/PoolDialogs.tsx';
import type { CodePage, CodeRow } from '../../src/shared/api-types.ts';
import { deferred, json, mockApi, pool } from './helpers.ts';

const input = Array.from({ length: 90 }, (_, i) => `CODE-${i}`).join('\n');
const row: CodeRow = {
  id: 1,
  code: 'EXISTING',
  status: 'unclaimed',
  claimedAt: null,
  remark: null,
  redeemedMarkedAt: null,
  createdAt: pool.createdAt,
};
const page = (total: number, currentPage = 1): CodePage => ({
  items: [row],
  total,
  page: currentPage,
  pageSize: 20,
  counts: { all: total, unclaimed: total, claimed: 0, redeemed: 0 },
  summary: { total, remaining: total, claimed: 0, redeemed: 0 },
});
const url = (filter: string, currentPage = 1) =>
  `GET /api/manage/pools/1/codes?page=${currentPage}&status=${filter}&pageSize=20`;

test('partial import failure invalidates cached records and selection; failed refresh stays read-only', async () => {
  let total = 21;
  let failRead = false;
  const list = vi.fn(() => json({ items: [{ ...pool, total, remaining: total }] }));
  const all = vi.fn<() => Response | Promise<Response>>(() => json(page(total)));
  const unclaimed = vi.fn(() =>
    failRead ? json({ code: 'SERVICE_UNAVAILABLE' }, 503) : json(page(total, 2)),
  );
  const importer = vi.fn(() => {
    total += 45;
    failRead = true;
    return json({ code: 'SERVICE_UNAVAILABLE' }, 500);
  });
  mockApi({
    'GET /api/manage/pools': list,
    [url('all')]: all,
    [url('unclaimed')]: () => json(page(total)),
    [url('unclaimed', 2)]: unclaimed,
    'POST /api/manage/pools/1/import': importer,
  });
  const user = userEvent.setup();
  render(<Manager poolId="1" onNavigate={vi.fn()} />);
  await screen.findByText(row.code);
  await user.click(screen.getByRole('button', { name: '待领取' }));
  await user.click(screen.getByRole('button', { name: '下一页' }));
  await waitFor(() => expect(unclaimed).toHaveBeenCalledOnce());
  const checkbox = await screen.findByRole('checkbox', { name: `选择兑换码 ${row.code}` });
  await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: '添加兑换码' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(/兑换码内容/), { target: { value: input } });
  await user.click(within(dialog).getByRole('button', { name: '开始导入' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('服务暂时不可用');
  expect(within(dialog).getByLabelText(/兑换码内容/)).toHaveValue(input);
  expect(within(dialog).getByRole('button', { name: '开始导入' })).toBeEnabled();
  await screen.findByText(/数据尚未更新/);
  expect(importer).toHaveBeenCalledOnce();
  expect(unclaimed).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(2);
  await user.click(within(dialog).getByRole('button', { name: '关闭' }));
  expect(screen.getByRole('button', { name: '待领取' })).toHaveAttribute('aria-pressed', 'true');
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeDisabled();
  expect(screen.getByRole('button', { name: '批量删除' })).toBeDisabled();
  const statistics = screen.getByRole('region', { name: '码池统计' });
  expect(within(statistics).getByText('总数').parentElement).toHaveTextContent('—');

  failRead = false;
  await user.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(checkbox).toBeEnabled());
  expect(within(statistics).getByText('总数').parentElement).toHaveTextContent('66');

  // Returning to a previously cached filter must wait for a new read.
  const fresh = deferred<Response>();
  all.mockImplementationOnce(() => fresh.promise);
  await user.click(screen.getByRole('button', { name: '全部' }));
  expect(screen.getByRole('button', { name: '待领取' })).toHaveAttribute('aria-pressed', 'true');
  await act(async () => fresh.resolve(json(page(total))));
  expect(within(statistics).getByText('总数').parentElement).toHaveTextContent('66');
  failRead = false;
  await user.click(screen.getByRole('button', { name: '待领取' }));
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: `选择兑换码 ${row.code}` })).toBeEnabled(),
  );
  expect(screen.getByRole('checkbox', { name: `选择兑换码 ${row.code}` })).not.toBeChecked();
});

test.each([false, true])('partial import refreshes the list (new pool: %s)', async (create) => {
  let created = !create;
  let total = 0;
  const list = vi.fn(() => json({ items: created ? [{ ...pool, total, remaining: total }] : [] }));
  const importer = vi.fn(() => {
    total = 45;
    return json({ code: 'SERVICE_UNAVAILABLE' }, 500);
  });
  mockApi({
    'GET /api/manage/pools': list,
    'POST /api/manage/pools': () => {
      created = true;
      return json({ id: 1 }, 201);
    },
    'POST /api/manage/pools/1/import': importer,
  });
  const user = userEvent.setup();
  render(<Manager onNavigate={vi.fn()} />);
  if (create) {
    await screen.findByText('从第一个码池开始');
    await user.click(screen.getAllByRole('button', { name: '新建兑换码池' })[0]);
    await user.type(screen.getByLabelText('码池名称'), pool.name);
    await user.click(screen.getByRole('button', { name: '创建并导入' }));
  } else {
    await screen.findByRole('heading', { name: pool.name });
    await user.click(screen.getByRole('button', { name: '添加兑换码' }));
  }
  const dialog = await screen.findByRole('dialog', { name: '添加兑换码' });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(create ? 2 : 1));
  fireEvent.change(within(dialog).getByLabelText(/兑换码内容/), { target: { value: input } });
  await user.click(within(dialog).getByRole('button', { name: '开始导入' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('服务暂时不可用');
  expect(within(dialog).getByLabelText(/兑换码内容/)).toHaveValue(input);
  const table = screen.getByRole('table', { name: '我的码池' });
  await waitFor(() => expect(within(table).getAllByText('45')[0]).toBeVisible());
  expect(list).toHaveBeenCalledTimes(create ? 3 : 2);
  expect(importer).toHaveBeenCalledOnce();
});

test.each(['4xx', 'network', 'invalid', 'redeemed'] as const)(
  '%s failure does not invoke partial-import reconciliation',
  async (scenario) => {
    const partial = vi.fn();
    const success = vi.fn();
    const mode = scenario === 'redeemed' ? 'redeemed' : 'codes';
    mockApi({
      [`POST /api/manage/pools/1/${mode === 'redeemed' ? 'redeemed/import' : 'import'}`]: () => {
        if (scenario === 'network') throw new TypeError('Network error');
        if (scenario === 'invalid') return new Response('not JSON');
        return json({ code: 'SERVICE_UNAVAILABLE' }, scenario === '4xx' ? 400 : 500);
      },
    });
    const user = userEvent.setup();
    render(
      <ImportDialog
        pool={pool}
        mode={mode}
        onClose={vi.fn()}
        onImported={success}
        onPartialFailure={partial}
      />,
    );
    fireEvent.change(screen.getByLabelText(/兑换码内容/), { target: { value: 'A' } });
    await user.click(
      screen.getByRole('button', { name: mode === 'codes' ? '开始导入' : '导入并标记' }),
    );
    await screen.findByRole('alert');
    expect(partial).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  },
);

test('late 500 after import dialog unmount does not refresh inventory', async () => {
  const pending = deferred<Response>();
  const partial = vi.fn();
  mockApi({ 'POST /api/manage/pools/1/import': () => pending.promise });
  const user = userEvent.setup();
  const view = render(
    <ImportDialog pool={pool} onClose={vi.fn()} onImported={vi.fn()} onPartialFailure={partial} />,
  );
  fireEvent.change(screen.getByLabelText(/兑换码内容/), { target: { value: input } });
  await user.click(screen.getByRole('button', { name: '开始导入' }));
  view.unmount();
  await act(async () => pending.resolve(json({ code: 'SERVICE_UNAVAILABLE' }, 500)));
  expect(partial).not.toHaveBeenCalled();
});
