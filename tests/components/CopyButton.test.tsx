import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { CopyButton } from '../../src/react-app/components/ui.tsx';

test('点击复制写入实际兑换码并展示成功反馈', async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText');
  render(<CopyButton value="WELCOME-001" label="复制兑换码" />);
  await user.click(screen.getByRole('button', { name: '复制兑换码' }));
  expect(write).toHaveBeenCalledExactlyOnceWith('WELCOME-001');
  expect(screen.getByRole('button', { name: '已复制' })).toBeVisible();
});

test('复制失败保留可全选的只读内容，重试成功后收起', async () => {
  const user = userEvent.setup();
  const value = `https://famala.test/claim?key=c_${'a'.repeat(43)}`;
  const write = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    .mockResolvedValue(undefined);
  render(<CopyButton value={value} label="复制领码链接" />);
  const button = screen.getByRole('button', { name: '复制领码链接' });
  vi.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('复制失败，请手动选择文本复制');
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole('textbox')).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
  const input = screen.getByRole('textbox', {
    name: '复制领码链接：手动复制内容',
  }) as HTMLInputElement;
  expect(input).toHaveValue(value);
  expect(input).toHaveAttribute('readonly');
  button.focus();
  await user.tab();
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(value.length);
  input.setSelectionRange(4, 4);
  await user.click(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(value.length);
  await user.click(button);
  expect(write).toHaveBeenLastCalledWith(value);
  expect(screen.getByRole('button', { name: '已复制' })).toBeVisible();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
