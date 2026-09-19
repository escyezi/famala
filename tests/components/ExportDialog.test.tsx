import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ExportDialog } from '../../src/react-app/components/ExportDialog.tsx';
import { runExport } from '../../src/react-app/export/run-export.ts';
import { i18n } from '../../src/react-app/i18n/index.ts';
import { deferred } from './helpers.ts';
import type { ExportResult } from '../../src/react-app/export/types.ts';
vi.mock('../../src/react-app/export/run-export.ts', () => ({ runExport: vi.fn() }));
afterEach(() => vi.mocked(runExport).mockReset());

function mockDownload() {
  const create = vi.fn(() => 'blob:export');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }),
  );
  return { create, revoke };
}

test('captures filter/language, locks duplicate exports and downloads only a complete file', async () => {
  const urls = mockDownload();
  const pending = deferred<ExportResult>();
  vi.mocked(runExport).mockImplementation((options) => {
    options.onProgress({ stage: 'reading', rows: 500, completed: 0, total: 1 });
    return pending.promise;
  });
  const user = userEvent.setup();
  const view = render(<ExportDialog poolId={1} initialStatus="redeemed" onClose={vi.fn()} />);
  expect(screen.queryByLabelText('文件格式')).not.toBeInTheDocument();
  expect(screen.getByLabelText('兑换码状态')).toHaveValue('redeemed');
  expect(screen.getByText(/CSV 保留原文/)).toBeVisible();
  await user.dblClick(screen.getByRole('button', { name: '开始导出' }));
  expect(runExport).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('兑换码状态')).toBeDisabled();
  expect(screen.queryByRole('link', { name: '下载文件' })).not.toBeInTheDocument();
  const options = vi.mocked(runExport).mock.calls[0][0];
  expect(options).toMatchObject({ poolId: 1, status: 'redeemed' });
  await act(() => i18n.changeLanguage('en'));
  expect(options.labels.code).toBe('兑换码');
  await act(async () => {
    options.onProgress({ stage: 'done', rows: 500, completed: 1, total: 1 });
    pending.resolve({ filename: 'codes.csv', blob: new Blob(['ok']) });
  });
  expect(screen.getByRole('link', { name: 'Download file' })).toHaveAttribute(
    'download',
    'codes.csv',
  );
  expect(urls.create).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(urls.revoke).toHaveBeenCalledWith('blob:export');
});

test('closing/unmounting aborts pending work and ignores a late result', async () => {
  const urls = mockDownload();
  const pending = deferred<ExportResult>();
  vi.mocked(runExport).mockReturnValue(pending.promise);
  const user = userEvent.setup();
  const close = vi.fn();
  const view = render(<ExportDialog onClose={close} />);
  await user.click(screen.getByRole('button', { name: '开始导出' }));
  await waitFor(() => expect(runExport).toHaveBeenCalledTimes(1));
  const options = vi.mocked(runExport).mock.calls[0][0];
  await user.click(screen.getByRole('button', { name: '取消' }));
  expect(close).toHaveBeenCalledOnce();
  expect(options.signal.aborted).toBe(true);
  view.unmount();
  await act(async () => pending.resolve({ filename: 'late.zip', blob: new Blob() }));
  expect(urls.create).not.toHaveBeenCalled();
});

test('a failure has no partial download and can be retried', async () => {
  mockDownload();
  vi.mocked(runExport).mockRejectedValueOnce({ code: 'EXPORT_FAILED' });
  const user = userEvent.setup();
  const view = render(<ExportDialog onClose={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '开始导出' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('导出失败');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  vi.mocked(runExport).mockImplementationOnce(async (options) => {
    options.onProgress({ stage: 'done', rows: 0, total: 1, completed: 1 });
    return { filename: 'empty.zip', blob: new Blob() };
  });
  await user.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('link', { name: '下载文件' })).toBeVisible();
  expect(runExport).toHaveBeenCalledTimes(2);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('兑换码状态')).toHaveValue('all');
  view.unmount();
});
