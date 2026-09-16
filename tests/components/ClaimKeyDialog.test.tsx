import type { ApiResponses } from './helpers.ts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ClaimKeyDialog } from '../../src/react-app/components/Claims.tsx';
import { deferred, json, mockApi, pool } from './helpers.ts';

test('空白 Key 不可提交，校验期间禁止重复提交，成功后传出修剪后的 Key', async () => {
  const pending = deferred<Response>();
  const fetchMock = mockApi({ 'POST /api/claim/validate': () => pending.promise });
  const user = userEvent.setup();
  const onValidated = vi.fn();
  render(<ClaimKeyDialog onClose={vi.fn()} onValidated={onValidated} />);
  const input = screen.getByLabelText('领码 Key');
  const submit = screen.getByRole('button', { name: '前往领取' });
  expect(submit).toBeDisabled();
  await user.type(input, '   ');
  expect(submit).toBeDisabled();
  await user.type(input, `${pool.claimKey}  `);
  await user.dblClick(submit);
  expect(screen.getByRole('button', { name: /校验中/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(onValidated).not.toHaveBeenCalled();
  pending.resolve(json(pool satisfies ApiResponses['validateClaim']));
  await waitFor(() => expect(onValidated).toHaveBeenCalledExactlyOnceWith(pool.claimKey));
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/claim/validate',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ claimKey: pool.claimKey }),
    }),
  );
});

test('无效 Key 展示错误，修正后可重新校验', async () => {
  const validate = vi
    .fn()
    .mockImplementationOnce(() => json({ error: '领码 Key 无效' }, 404))
    .mockImplementationOnce(() => json(pool satisfies ApiResponses['validateClaim']));
  mockApi({ 'POST /api/claim/validate': validate });
  const user = userEvent.setup();
  const onValidated = vi.fn();
  render(<ClaimKeyDialog onClose={vi.fn()} onValidated={onValidated} />);
  const input = screen.getByLabelText('领码 Key');
  await user.type(input, 'invalid');
  await user.click(screen.getByRole('button', { name: '前往领取' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('领码 Key 无效');
  expect(onValidated).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, pool.claimKey);
  await user.click(screen.getByRole('button', { name: '前往领取' }));
  await waitFor(() => expect(onValidated).toHaveBeenCalledWith(pool.claimKey));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
