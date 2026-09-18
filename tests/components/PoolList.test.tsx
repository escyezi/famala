import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PoolList } from '../../src/react-app/components/PoolList.tsx';
import { selectLocale } from '../../src/react-app/i18n/index.ts';
import type { Pool } from '../../src/shared/api-types.ts';
import { pool } from './helpers.ts';

const pools: Pool[] = [
  { ...pool, name: 'Alpha 福利' },
  { ...pool, id: 2, name: 'Beta 空池', total: 0, claimed: 0, remaining: 0 },
  { ...pool, id: 3, name: 'Alpha 已领完', total: 2, claimed: 2, remaining: 0 },
  { ...pool, id: 4, name: '停止的空池', status: 'stopped', total: 0, claimed: 0, remaining: 0 },
  { ...pool, id: 5, name: '停止的有码池', status: 'stopped' },
];

function props(items = pools) {
  return { pools: items, error: null, onRefresh: vi.fn(), onNavigate: vi.fn() };
}

test('码池状态互斥分类，搜索忽略大小写与首尾空格并与状态筛选组合', async () => {
  const user = userEvent.setup();
  render(<PoolList {...props()} />);
  expect(screen.getAllByRole('link')).toHaveLength(5);
  expect(screen.getByRole('button', { name: '已停止 2' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '待导入 1' }));
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Beta 空池' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '全部 5' }));
  await user.type(screen.getByRole('searchbox', { name: '搜索码池名称' }), '  ALPHA  ');
  expect(screen.getAllByRole('link')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: '已领完 1' }));
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Alpha 已领完' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '待导入 1' }));
  expect(screen.getByText('没有匹配的码池')).toBeVisible();
  expect(screen.queryByText('从第一个码池开始')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '清除搜索和筛选' }));
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getAllByRole('link')).toHaveLength(5);
  expect(screen.getByRole('status')).toHaveTextContent('显示 5 / 5 个码池');
});

test('刷新后保留已选筛选且更新计数，切换语言保留搜索和筛选', async () => {
  const user = userEvent.setup();
  const original = props();
  const view = render(<PoolList {...original} />);
  await user.type(screen.getByRole('searchbox'), 'Alpha');
  await user.click(screen.getByRole('button', { name: '发放中 1' }));
  view.rerender(<PoolList {...original} pools={pools.filter((p) => p.id !== pool.id)} />);
  expect(screen.getByRole('button', { name: '发放中 0' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('没有匹配的码池')).toBeVisible();
  await act(async () => selectLocale('en'));
  expect(screen.getByRole('searchbox', { name: 'Search pool names' })).toHaveValue('Alpha');
  expect(screen.getByRole('button', { name: 'Active 0' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('No matching code pools')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Refresh data' }));
  expect(original.onRefresh).toHaveBeenCalledOnce();
});

test('行内复制和导入作用于正确码池，名称链接支持普通及修饰键导航', async () => {
  const user = userEvent.setup();
  const actions = props();
  render(<PoolList {...actions} />);
  const row = screen.getByRole('row', { name: /Alpha 福利/ });
  const copy = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValueOnce(new Error('Denied'));
  await user.click(within(row).getByRole('button', { name: '复制领码链接' }));
  expect(within(row).getByRole('textbox')).toHaveValue(
    `${location.origin}/claim?key=${encodeURIComponent(pool.claimKey)}`,
  );
  copy.mockResolvedValue(undefined);
  await user.click(within(row).getByRole('button', { name: '复制领码链接' }));
  expect(copy).toHaveBeenLastCalledWith(
    `${location.origin}/claim?key=${encodeURIComponent(pool.claimKey)}`,
  );
  expect(within(row).getByRole('button', { name: '已复制' })).toBeVisible();
  expect(within(row).queryByRole('textbox')).not.toBeInTheDocument();
  await user.click(within(row).getByRole('button', { name: '导入兑换码' }));
  expect(within(screen.getByRole('dialog')).getByText('Alpha 福利')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '关闭弹窗' }));
  const link = within(row).getByRole('link');
  expect(link).toHaveAttribute('href', `/manage/pools/${pool.id}`);
  fireEvent.click(link, { ctrlKey: true });
  expect(actions.onNavigate).not.toHaveBeenCalled();
  await user.click(link);
  expect(actions.onNavigate).toHaveBeenCalledWith(`/manage/pools/${pool.id}`);
});
