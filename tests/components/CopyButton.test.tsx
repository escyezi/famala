import { render, screen } from '@testing-library/react';
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

test('剪贴板权限被拒绝时提示手动复制', async () => {
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
    new DOMException('Denied', 'NotAllowedError'),
  );
  render(<CopyButton value="WELCOME-001" label="复制兑换码" />);
  await user.click(screen.getByRole('button', { name: '复制兑换码' }));
  expect(screen.getByRole('alert')).toHaveTextContent('复制失败，请手动选择文本复制');
  expect(screen.getByRole('button', { name: '复制兑换码' })).toBeEnabled();
});
