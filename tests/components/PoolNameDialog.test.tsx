import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PoolNameDialog } from '../../src/react-app/components/PoolDialogs.tsx';
import { json, mockApi, pool } from './helpers.ts';

test.each([false, true])(
  'pool dialog enforces Unicode limits before saving (editing: %s)',
  async (editing) => {
    const save = vi.fn(() => json({ id: 1, name: '😀'.repeat(50) }, editing ? 200 : 201));
    mockApi({ [editing ? 'POST /api/manage/pools/1/name' : 'POST /api/manage/pools']: save });
    const onSaved = vi.fn();
    render(
      <PoolNameDialog
        pool={editing ? pool : undefined}
        onClose={vi.fn()}
        onSaved={onSaved}
        onImport={editing ? undefined : vi.fn()}
      />,
    );
    const name = screen.getByLabelText('码池名称');
    const description = screen.getByLabelText('领取说明（选填）');
    const button = screen.getByRole('button', { name: editing ? '保存修改' : '稍后导入' });
    fireEvent.change(name, { target: { value: '😀'.repeat(51) } });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('码池名称不能超过 50 字');
    expect(button).toBeDisabled();
    if (!editing) expect(screen.getByRole('button', { name: '创建并导入' })).toBeDisabled();
    fireEvent.submit(name.closest('form')!);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: `  ${'😀'.repeat(50)}  ` } });
    fireEvent.change(description, { target: { value: '😀'.repeat(501) } });
    expect(description).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('领取说明不能超过 500 字');
    expect(button).toBeDisabled();
    fireEvent.submit(name.closest('form')!);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(description, { target: { value: `  ${'😀'.repeat(500)}  ` } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/当前 50 \/ 50 字/)).toBeVisible();
    expect(screen.getByText(/当前 500 \/ 500 字/)).toBeVisible();
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({ name: '😀'.repeat(50), description: '😀'.repeat(500) }),
      }),
    );
  },
);
