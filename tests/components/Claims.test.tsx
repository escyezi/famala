import type { ApiResponses } from './helpers.ts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ClaimPage, HistoryDialog } from '../../src/react-app/components/Claims.tsx';
import { readRecords, STORAGE_KEY } from '../../src/react-app/storage.ts';
import { claimRecord, deferred, json, mockApi, mockTurnstile, pool } from './helpers.ts';

const publicRoutes = {
  'POST /api/claim/validate': () => json(pool satisfies ApiResponses['validateClaim']),
  'GET /api/config': () =>
    json({ turnstileSiteKey: 'test-site-key', testMode: true } satisfies ApiResponses['config']),
};

function renderClaim() {
  return render(<ClaimPage claimKey={pool.claimKey} onEnterKey={vi.fn()} />);
}

test('验证通过后才能领取，重复点击只发出一次请求，结果在重新挂载后仍可查看', async () => {
  const pending = deferred<Response>();
  const claim = vi.fn(() => pending.promise);
  mockApi({ ...publicRoutes, 'POST /api/claim': claim });
  const turnstile = mockTurnstile();
  const user = userEvent.setup();
  const view = renderClaim();
  const submit = await screen.findByRole('button', { name: '领取兑换码' });
  expect(submit).toBeDisabled();
  await turnstile.trigger('callback', 'verified-token');
  await user.type(screen.getByLabelText(/备注/), '谢谢开发者');
  await user.dblClick(submit);
  expect(submit).toBeDisabled();
  expect(screen.getByLabelText(/备注/)).toBeDisabled();
  expect(claim).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      body: JSON.stringify({
        claimKey: pool.claimKey,
        remark: '谢谢开发者',
        turnstileToken: 'verified-token',
      }),
    }),
  );
  pending.resolve(json(claimRecord satisfies ApiResponses['claim']));
  expect(await screen.findByText(claimRecord.code)).toBeVisible();
  await waitFor(() => expect(readRecords().records).toEqual([claimRecord]));
  expect(screen.queryByRole('button', { name: '领取兑换码' })).not.toBeInTheDocument();

  view.unmount();
  renderClaim();
  expect(await screen.findByText(claimRecord.code)).toBeVisible();
  expect(claim).toHaveBeenCalledTimes(1);
});

test('验证码过期后清除令牌，重新验证才能继续领取', async () => {
  mockApi(publicRoutes);
  const turnstile = mockTurnstile();
  const user = userEvent.setup();
  renderClaim();
  const submit = await screen.findByRole('button', { name: '领取兑换码' });
  await turnstile.trigger('callback', 'first-token');
  expect(submit).toBeEnabled();
  await turnstile.trigger('expired-callback');
  expect(submit).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('验证已过期');
  await user.click(screen.getByRole('button', { name: '重新验证' }));
  await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
  expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
  await turnstile.trigger('callback', 'new-token');
  expect(submit).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('备注按 Unicode 字符计数，超过 500 字时阻止提交', async () => {
  mockApi(publicRoutes);
  const turnstile = mockTurnstile();
  const user = userEvent.setup();
  renderClaim();
  const submit = await screen.findByRole('button', { name: '领取兑换码' });
  await turnstile.trigger('callback', 'token');
  const remark = screen.getByLabelText(/备注/);
  await user.click(remark);
  await user.paste('😀'.repeat(500));
  expect(screen.getByText('选填 · 500/500')).toBeVisible();
  expect(submit).toBeEnabled();
  await user.paste('多');
  expect(submit).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('备注最多 500 字');
  await user.keyboard('{Backspace}');
  expect(submit).toBeEnabled();
});

test.each([
  ['stopped', 2, '停止发放'],
  ['active', 0, '兑换码已发放完毕'],
] as const)('码池状态 %s、库存 %i 时禁止领取，刷新后可恢复', async (status, remaining, label) => {
  const validate = vi
    .fn()
    .mockImplementationOnce(() =>
      json({ ...pool, status, remaining } satisfies ApiResponses['validateClaim']),
    )
    .mockImplementationOnce(() => json(pool satisfies ApiResponses['validateClaim']));
  mockApi({ ...publicRoutes, 'POST /api/claim/validate': validate });
  const turnstile = mockTurnstile();
  const user = userEvent.setup();
  renderClaim();
  expect(await screen.findByText(label)).toBeVisible();
  expect(screen.getByRole('button', { name: '领取兑换码' })).toBeDisabled();
  expect(turnstile.render).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '刷新领取状态' }));
  expect(await screen.findByText('兑换码发放中')).toBeVisible();
  await turnstile.trigger('callback', 'token');
  expect(screen.getByRole('button', { name: '领取兑换码' })).toBeEnabled();
});

test.each([
  ['POOL_STOPPED', '停止发放'],
  ['POOL_EMPTY', '兑换码已发放完毕'],
])('提交时服务端返回 %s，页面同步状态并停止领取', async (code, label) => {
  mockApi({
    ...publicRoutes,
    'POST /api/claim': () => json({ error: '发放状态已变化', code }, 409),
  });
  const turnstile = mockTurnstile();
  const user = userEvent.setup();
  renderClaim();
  const submit = await screen.findByRole('button', { name: '领取兑换码' });
  await turnstile.trigger('callback', 'token');
  await user.click(submit);
  expect(await screen.findByText(label)).toBeVisible();
  expect(submit).toBeDisabled();
  expect(readRecords().records).toEqual([]);
});

test('网络失败提示发码结果可能丢失，必须重新验证才能重试', async () => {
  const claim = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockImplementationOnce(() => json(claimRecord satisfies ApiResponses['claim']));
  mockApi({ ...publicRoutes, 'POST /api/claim': claim });
  const turnstile = mockTurnstile();
  const user = userEvent.setup();
  renderClaim();
  const submit = await screen.findByRole('button', { name: '领取兑换码' });
  await turnstile.trigger('callback', 'old-token');
  await user.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('本次兑换码可能已经发出且无法找回');
  expect(submit).toBeDisabled();
  expect(readRecords().records).toEqual([]);
  await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2));
  await turnstile.trigger('callback', 'fresh-token');
  await user.click(submit);
  expect(await screen.findByText(claimRecord.code)).toBeVisible();
  expect(JSON.parse(claim.mock.lastCall![0].body as string).turnstileToken).toBe('fresh-token');
});

test('未配置人机验证时显示说明并禁止领取', async () => {
  mockApi({
    ...publicRoutes,
    'GET /api/config': () =>
      json({ turnstileSiteKey: null, testMode: false } satisfies ApiResponses['config']),
  });
  renderClaim();
  expect(await screen.findByRole('alert')).toHaveTextContent('人机验证暂未配置');
  expect(screen.getByRole('button', { name: '领取兑换码' })).toBeDisabled();
});

test('加载失败后可以重试，也可以请求重新输入 Key', async () => {
  const validate = vi
    .fn()
    .mockImplementationOnce(() => json({ error: '领取信息加载失败' }, 500))
    .mockImplementationOnce(() => json(pool satisfies ApiResponses['validateClaim']));
  mockApi({ ...publicRoutes, 'POST /api/claim/validate': validate });
  const onEnterKey = vi.fn();
  const user = userEvent.setup();
  render(<ClaimPage claimKey={pool.claimKey} onEnterKey={onEnterKey} />);
  await user.click(await screen.findByRole('button', { name: '重新输入领码 Key' }));
  expect(onEnterKey).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('heading', { name: pool.name })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('本地保存失败仍展示已领取兑换码，并提示手动保存', async () => {
  mockApi({
    ...publicRoutes,
    'POST /api/claim': () => json(claimRecord satisfies ApiResponses['claim']),
  });
  const turnstile = mockTurnstile();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage full', 'QuotaExceededError');
  });
  const user = userEvent.setup();
  renderClaim();
  const submit = await screen.findByRole('button', { name: '领取兑换码' });
  await turnstile.trigger('callback', 'token');
  await user.click(submit);
  expect(await screen.findByText(claimRecord.code)).toBeVisible();
  expect(await screen.findByText(/本地保存失败，请复制保存兑换码/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '领取兑换码' })).not.toBeInTheDocument();
});

test('领取历史为空时展示空状态', () => {
  render(<HistoryDialog onClose={vi.fn()} />);
  expect(screen.getByText('暂无已领取的兑换码')).toBeVisible();
});

test('标记使用失败不修改记录，重试成功后持久化并禁止重复标记', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([claimRecord]));
  const usedAt = claimRecord.claimedAt + 1000;
  const used = vi
    .fn()
    .mockImplementationOnce(() => json({ error: '标记失败' }, 500))
    .mockImplementationOnce(() =>
      json({ userMarkedUsed: true, userMarkedUsedAt: usedAt } satisfies ApiResponses['markUsed']),
    );
  mockApi({ 'POST /api/claim/used': used });
  const user = userEvent.setup();
  const view = render(<HistoryDialog onClose={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: '我已使用' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('标记失败');
  expect(readRecords().records[0].userMarkedUsed).toBe(false);
  await user.click(screen.getByRole('button', { name: '我已使用' }));
  expect(await screen.findByRole('button', { name: '已标记使用' })).toBeDisabled();
  await waitFor(() =>
    expect(readRecords().records[0]).toEqual({
      ...claimRecord,
      userMarkedUsed: true,
      userMarkedUsedAt: usedAt,
    }),
  );
  expect(used).toHaveBeenLastCalledWith(
    expect.objectContaining({
      body: JSON.stringify({ claimKey: pool.claimKey, code: claimRecord.code }),
    }),
  );
  view.unmount();
  render(<HistoryDialog onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: '已标记使用' })).toBeDisabled();
  expect(used).toHaveBeenCalledTimes(2);
});
