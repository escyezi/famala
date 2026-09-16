import type { ApiResponses } from './helpers.ts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { AuthDialog } from '../../src/react-app/components/AuthDialog.tsx';
import { deferred, json, mockApi, session } from './helpers.ts';

test('新建空间后必须确认已保存 Key 才能进入管理页', async () => {
  const pending = deferred<Response>();
  const fetchMock = mockApi({ 'POST /api/spaces': () => pending.promise });
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<AuthDialog onClose={vi.fn()} onDone={onDone} />);

  await user.click(screen.getByRole('button', { name: /生成新 Key/ }));
  expect(screen.getByRole('button', { name: /正在创建/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '关闭弹窗' })).not.toBeInTheDocument();
  pending.resolve(
    json({ key: 'd_new-key', ...session } satisfies ApiResponses['createSpace'], 201),
  );

  expect(await screen.findByText('d_new-key')).toBeVisible();
  const enter = screen.getByRole('button', { name: '进入管理页面' });
  expect(enter).toBeDisabled();
  await user.click(enter);
  expect(onDone).not.toHaveBeenCalled();
  await user.click(screen.getByRole('checkbox', { name: '我已妥善保存发码 Key' }));
  await user.click(enter);
  expect(onDone).toHaveBeenCalledExactlyOnceWith(session);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('登录失败保留输入并允许重试，成功时提交去掉首尾空白的 Key', async () => {
  const login = vi
    .fn()
    .mockImplementationOnce(() => json({ error: '发码 Key 无效' }, 401))
    .mockImplementationOnce(() => json(session satisfies ApiResponses['login']));
  const fetchMock = mockApi({ 'POST /api/login': login });
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<AuthDialog onClose={vi.fn()} onDone={onDone} />);

  await user.click(screen.getByRole('button', { name: /使用已有 Key/ }));
  const submit = screen.getByRole('button', { name: '进入管理页面' });
  const input = screen.getByLabelText('发码 Key');
  expect(submit).toBeDisabled();
  await user.type(input, '  d_saved-key  ');
  await user.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('发码 Key 无效');
  expect(input).toHaveValue('  d_saved-key  ');
  expect(onDone).not.toHaveBeenCalled();
  await user.click(submit);
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/login',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ key: 'd_saved-key' }),
    }),
  );
});

test('登录请求未完成时禁止重复提交和关闭', async () => {
  const pending = deferred<Response>();
  const fetchMock = mockApi({ 'POST /api/login': () => pending.promise });
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<AuthDialog onClose={vi.fn()} onDone={onDone} />);
  await user.click(screen.getByRole('button', { name: /使用已有 Key/ }));
  await user.type(screen.getByLabelText('发码 Key'), 'd_saved-key');
  await user.dblClick(screen.getByRole('button', { name: '进入管理页面' }));
  expect(screen.getByRole('button', { name: /登录中/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '返回' })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  pending.resolve(json(session satisfies ApiResponses['login']));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
});
