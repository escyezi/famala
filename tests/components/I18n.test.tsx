import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import App from '../../src/react-app/App.tsx';
import { AuthDialog } from '../../src/react-app/components/AuthDialog.tsx';
import { ClaimPage, HistoryDialog } from '../../src/react-app/components/Claims.tsx';
import { Manager } from '../../src/react-app/components/Manager.tsx';
import { ImportDialog, PoolNameDialog } from '../../src/react-app/components/PoolDialogs.tsx';
import { LanguageToggle } from '../../src/react-app/components/LanguageToggle.tsx';
import { CopyButton, Notice } from '../../src/react-app/components/ui.tsx';
import { detectLocale, i18n, LOCALE_KEY, selectLocale } from '../../src/react-app/i18n/index.ts';
import { useFormat } from '../../src/react-app/i18n/format.ts';
import { en } from '../../src/react-app/i18n/en.ts';
import { zh } from '../../src/react-app/i18n/zh-CN.ts';
import { STORAGE_KEY } from '../../src/react-app/storage.ts';
import { parseImport } from '../../src/shared/contracts.ts';
import {
  claimRecord,
  deferred,
  json,
  mockApi,
  mockTurnstile,
  pool,
  publicPool,
  session,
} from './helpers.ts';
import type { ApiResponses } from './helpers.ts';

// Component reactivity helpers; actual user flows click the App header toggle.
const english = () =>
  act(async () => {
    await i18n.changeLanguage('en');
  });
const chinese = () =>
  act(async () => {
    await i18n.changeLanguage('zh-CN');
  });
const publicRoutes = {
  'POST /api/claim/validate': () => json(publicPool),
  'GET /api/config': () =>
    json({ turnstileSiteKey: 'test-site-key', testMode: true } satisfies ApiResponses['config']),
};

test.each([
  [['fr-FR', 'en-GB', 'zh-CN'], 'en'],
  [['zh-TW', 'en-US'], 'zh-CN'],
  [['fr', 'de'], 'zh-CN'],
  [['EN-us'], 'en'],
])('browser preferences %j select %s', (languages, expected) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
  expect(detectLocale()).toBe(expected);
  localStorage.setItem(LOCALE_KEY, 'invalid');
  expect(detectLocale()).toBe(expected);
  localStorage.setItem(LOCALE_KEY, 'en');
  expect(detectLocale()).toBe('en');
  localStorage.setItem(LOCALE_KEY, 'zh-CN');
  expect(detectLocale()).toBe('zh-CN');
});

test('language switch survives storage failure and updates metadata without navigation', async () => {
  const description = document.createElement('meta');
  description.name = 'description';
  document.head.appendChild(description);
  const user = userEvent.setup();
  render(<LanguageToggle />);
  await user.click(screen.getByRole('button', { name: '切换为英文' }));
  expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
  expect(detectLocale()).toBe('en');
  expect(document.documentElement.lang).toBe('en');
  const englishToggle = screen.getByRole('button', { name: 'Switch to Chinese' });
  expect(englishToggle.querySelector('.language-icon-front')).toHaveTextContent(/^En$/);
  expect(englishToggle.querySelector('.language-icon-back')).toHaveTextContent(/^文$/);
  expect(document.title).toContain('Redemption code distribution');
  expect(description.content).toContain('Create code pools');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await user.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  expect(document.documentElement.lang).toBe('zh-CN');
  const chineseToggle = screen.getByRole('button', { name: '切换为英文' });
  expect(chineseToggle.querySelector('.language-icon-front')).toHaveTextContent(/^文$/);
  expect(chineseToggle.querySelector('.language-icon-back')).toHaveTextContent(/^En$/);
  expect(location.pathname).toBe('/');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  expect(detectLocale()).toBe('en');
  description.remove();
});

test('resources have matching keys and interpolation variables, English plurals and no Chinese', async () => {
  for (const group of Object.keys(zh) as (keyof typeof zh)[]) {
    expect(Object.keys(en[group]).sort()).toEqual(Object.keys(zh[group]).sort());
    for (const key of Object.keys(zh[group])) {
      const cn = (zh[group] as Record<string, string>)[key];
      const englishText = (en[group] as Record<string, string>)[key];
      const params = (value: string) =>
        [...value.matchAll(/\{\{\s*(\w+)/g)].map((m) => m[1]).sort();
      expect(params(englishText), `${group}.${key}`).toEqual(params(cn));
      expect(englishText).not.toMatch(/\p{Script=Han}/u);
    }
  }
  await english();
  expect(i18n.t('manage.recordCount', { count: 0 })).toBe('0 records');
  expect(i18n.t('manage.recordCount', { count: 1 })).toBe('1 record');
  expect(i18n.t('manage.recordCount', { count: 1234 })).toBe('1,234 records');
  await chinese();
  expect(i18n.t('manage.recordCount', { count: 1234 })).toBe('共 1,234 条');
});

test('App header switches both ways, saves preferences and updates metadata without refetching', async () => {
  const description = document.createElement('meta');
  description.name = 'description';
  document.head.appendChild(description);
  const fetch = mockApi({ 'GET /api/manage/session': () => json({ code: 'UNAUTHORIZED' }, 401) });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: '切换为英文' }));
  expect(screen.getByRole('heading', { name: 'One link. Easy code sharing.' })).toBeVisible();
  expect(screen.getByRole('button', { name: /Claim a code/ })).toBeVisible();
  expect(screen.getByRole('button', { name: /Share codes/ })).toBeVisible();
  expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
  expect(document.documentElement.lang).toBe('en');
  expect(document.title).toBe(en.common.title);
  expect(description.content).toBe(en.common.description);
  await user.click(screen.getByRole('button', { name: 'Switch to Chinese' }));
  expect(screen.getByRole('heading', { name: /轻松发码/ })).toBeVisible();
  expect(localStorage.getItem(LOCALE_KEY)).toBe('zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(document.title).toBe(zh.common.title);
  expect(description.content).toBe(zh.common.description);
  expect(fetch).toHaveBeenCalledOnce();
  description.remove();
});

test('choosing English in the header opens an English login modal without a language toggle', async () => {
  const fetch = mockApi({ 'GET /api/manage/session': () => json({ code: 'UNAUTHORIZED' }, 401) });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: '切换为英文' }));
  await user.click(screen.getByRole('button', { name: /Share codes/ }));
  const dialog = within(screen.getByRole('dialog'));
  await user.click(dialog.getByRole('button', { name: /existing key/i }));
  expect(dialog.getByLabelText('Distributor key')).toBeVisible();
  expect(dialog.queryByRole('button', { name: /Switch to|切换为/ })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
});

test('component reactivity: login draft and existing error translate in the same modal without resubmission', async () => {
  const login = vi.fn(() => json({ code: 'INVALID_DISTRIBUTOR_KEY' }, 401));
  mockApi({ 'POST /api/login': login });
  const user = userEvent.setup();
  const done = vi.fn();
  render(<AuthDialog onClose={vi.fn()} onDone={done} />);
  await user.click(screen.getByRole('button', { name: /使用已有 Key/ }));
  const input = screen.getByLabelText('发码 Key');
  await user.type(input, 'd_keep-my-input');
  await user.click(screen.getByRole('button', { name: '进入管理页面' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('发码 Key 无效');
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: '切换为英文' })).not.toBeInTheDocument();
  await english();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(screen.getByLabelText('Distributor key')).toBe(input);
  expect(input).toHaveValue('d_keep-my-input');
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid distributor key');
  expect(login).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
});

test('English workspace creation requires confirmation of saving the key', async () => {
  await english();
  mockApi({
    'POST /api/spaces': () =>
      json({ ...session, key: 'd_example' } satisfies ApiResponses['createSpace'], 201),
  });
  const done = vi.fn();
  const user = userEvent.setup();
  render(<AuthDialog onClose={vi.fn()} onDone={done} />);
  await user.click(screen.getByRole('button', { name: /Generate a new key/ }));
  expect(await screen.findByText('d_example')).toBeVisible();
  const enter = screen.getByRole('button', { name: 'Open workspace' });
  expect(enter).toBeDisabled();
  await user.click(screen.getByRole('checkbox'));
  await user.click(enter);
  expect(done).toHaveBeenCalledExactlyOnceWith(session);
});

test('English code pool creation preserves user content', async () => {
  await english();
  const create = vi.fn<(init: RequestInit) => Response>(() =>
    json({ id: 9 } satisfies ApiResponses['createPool'], 201),
  );
  mockApi({ 'POST /api/manage/pools': create });
  const save = vi.fn();
  const user = userEvent.setup();
  render(<PoolNameDialog onClose={vi.fn()} onSaved={save} />);
  await user.type(screen.getByLabelText('Code pool name'), '九月会员福利');
  await user.click(screen.getByRole('button', { name: 'Create empty pool' }));
  expect(save).toHaveBeenCalledWith(9);
  expect(JSON.parse(create.mock.calls[0][0].body as string)).toEqual({ name: '九月会员福利' });
});

test('component reactivity: import results and row reasons translate without losing the draft or reimporting', async () => {
  const result = {
    succeeded: 1,
    failed: 1,
    failures: parseImport('A\nA').failures,
  } satisfies ApiResponses['importCodes'];
  const importer = vi.fn(() => json(result));
  mockApi({ 'POST /api/manage/pools/1/import': importer });
  const user = userEvent.setup();
  render(<ImportDialog pool={pool} onClose={vi.fn()} onImported={vi.fn()} />);
  await user.type(screen.getByLabelText(/兑换码内容/), 'A\nA');
  await user.click(screen.getByRole('button', { name: '开始导入' }));
  expect(await screen.findByText('与本批第 1 行重复')).toBeVisible();
  await english();
  expect(screen.getByText('Duplicate of line 1 in this batch')).toBeVisible();
  expect(screen.getByText('Import complete: 1 succeeded, 1 failed.')).toBeVisible();
  expect(screen.getByLabelText(/Codes to import/)).toHaveValue('A\nA');
  expect(screen.getByRole('button', { name: 'Start import' })).toBeDisabled();
  expect(importer).toHaveBeenCalledOnce();
});

test('component reactivity: pagination and filter survive language changes without requests', async () => {
  const rows = (page: number) =>
    json({
      counts: { all: 45, unclaimed: 0, unused: 0, used: 45 },
      items: [],
      page,
      pageSize: 20,
      total: 45,
    } satisfies ApiResponses['codes']);
  const fetch = mockApi({
    'GET /api/manage/pools': () => json({ items: [pool] }),
    'GET /api/manage/pools/1/codes?page=1&status=all&pageSize=20': () => rows(1),
    'GET /api/manage/pools/1/codes?page=1&status=used&pageSize=20': () => rows(1),
    'GET /api/manage/pools/1/codes?page=2&status=used&pageSize=20': () => rows(2),
  });
  const user = userEvent.setup();
  render(<Manager poolId="1" onNavigate={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: '已使用' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: '下一页' }));
  expect(await screen.findByText('2 / 3')).toBeVisible();
  const calls = fetch.mock.calls.length;
  await english();
  expect(screen.getByText('2 / 3')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Used' })).toHaveAttribute('aria-pressed', 'true');
  expect(fetch).toHaveBeenCalledTimes(calls);
});

test.each([
  [{ code: 'SOMETHING_NEW' }, 'Request failed.'],
  [{ code: 'REQUEST_FAILED' }, 'Request failed.'],
  [{ code: 'TURNSTILE_FAILED', status: 503 }, 'temporarily unavailable'],
  [{ code: 'TURNSTILE_FAILED', status: 400 }, 'failed or expired'],
  [{ code: 'CLAIM_NETWORK_ERROR' }, 'may already have been issued and cannot be recovered'],
])('structured error %j has an English fallback', async (message, expected) => {
  await english();
  render(<Notice>{message}</Notice>);
  expect(screen.getByRole('alert')).toHaveTextContent(expected);
});

test('responses without error codes do not leak server text into English UI', async () => {
  await english();
  mockApi({ 'POST /api/login': () => json({ error: '任意旧中文错误' }, 500) });
  const user = userEvent.setup();
  render(<AuthDialog onClose={vi.fn()} onDone={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /Use an existing key/ }));
  await user.type(screen.getByLabelText('Distributor key'), 'd_test');
  await user.click(screen.getByRole('button', { name: 'Open workspace' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Request failed. Please try again later.',
  );
  expect(screen.getByRole('alert')).not.toHaveTextContent('任意旧中文错误');
});

test('copy feedback and local storage warnings translate while retaining content', async () => {
  const user = userEvent.setup();
  render(
    <>
      <CopyButton value="KEEP" />
      <Notice kind="info">{{ code: 'STORAGE_WRITE_FAILED' }}</Notice>
    </>,
  );
  await user.click(screen.getByRole('button', { name: '复制' }));
  await english();
  expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Could not save locally');
});

test('component reactivity: Turnstile resets language and token, ignores old callbacks, and preserves remarks', async () => {
  const fetch = mockApi(publicRoutes);
  const widget = mockTurnstile();
  const user = userEvent.setup();
  render(<ClaimPage claimKey={pool.claimKey} onEnterKey={vi.fn()} />);
  await widget.trigger('callback', 'old-token');
  const oldOptions = widget.render.mock.lastCall![1];
  expect(oldOptions.language).toBe('zh-cn');
  await user.type(screen.getByLabelText(/备注/), 'Keep this remark');
  const calls = fetch.mock.calls.length;
  await english();
  await waitFor(() => expect(widget.render).toHaveBeenCalledTimes(2));
  expect(widget.render.mock.lastCall![1].language).toBe('en');
  expect(widget.remove).toHaveBeenCalledWith('widget-1');
  expect(screen.getByRole('button', { name: 'Claim code' })).toBeDisabled();
  expect(screen.getByLabelText(/Remark/)).toHaveValue('Keep this remark');
  await act(async () => {
    (oldOptions.callback as (token: string) => void)('late-token');
  });
  expect(screen.getByRole('button', { name: 'Claim code' })).toBeDisabled();
  await widget.trigger('callback', 'new-token');
  expect(screen.getByRole('button', { name: 'Claim code' })).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(calls);
});

test('component reactivity: language switch during claim defers widget recreation until failure and keeps the warning', async () => {
  const pending = deferred<Response>();
  const claim = vi.fn(() => pending.promise);
  mockApi({ ...publicRoutes, 'POST /api/claim': claim });
  const widget = mockTurnstile();
  const user = userEvent.setup();
  render(<ClaimPage claimKey={pool.claimKey} onEnterKey={vi.fn()} />);
  await widget.trigger('callback', 'token');
  await user.click(screen.getByRole('button', { name: '领取兑换码' }));
  await english();
  expect(widget.render).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Claim code' })).toBeDisabled();
  await act(async () => pending.resolve(json({ code: 'TURNSTILE_FAILED' }, 503)));
  await waitFor(() => expect(widget.render).toHaveBeenCalledTimes(2));
  expect(widget.render.mock.lastCall![1].language).toBe('en');
  expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable');
  expect(screen.getByRole('button', { name: 'Claim code' })).toBeDisabled();
  expect(claim).toHaveBeenCalledOnce();
});

test('English claim and historical usage marking retain original user data', async () => {
  await english();
  const usedAt = claimRecord.claimedAt + 60000;
  mockApi({
    ...publicRoutes,
    'POST /api/claim': () => json(claimRecord),
    'POST /api/claim/used': () =>
      json({ userMarkedUsed: true, userMarkedUsedAt: usedAt } satisfies ApiResponses['markUsed']),
  });
  const widget = mockTurnstile();
  const user = userEvent.setup();
  const view = render(<ClaimPage claimKey={pool.claimKey} onEnterKey={vi.fn()} />);
  await widget.trigger('callback', 'english-token');
  await user.click(screen.getByRole('button', { name: 'Claim code' }));
  expect(await screen.findByText(claimRecord.code)).toBeVisible();
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual([claimRecord]),
  );
  await chinese();
  expect(screen.getByText(claimRecord.code)).toBeVisible();
  view.unmount();
  await english();
  render(<HistoryDialog onClose={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Mark as used' }));
  expect(await screen.findByRole('button', { name: 'Marked as used' })).toBeDisabled();
  expect(screen.getByText(claimRecord.poolName)).toBeVisible();
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[0].userMarkedUsedAt).toBe(usedAt),
  );
});

function DateExample() {
  const { dateTime } = useFormat();
  return <span>{dateTime(claimRecord.claimedAt)}</span>;
}
test('dates follow locale and keep the browser time zone', async () => {
  render(<DateExample />);
  await english();
  expect(
    screen.getByText(
      new Intl.DateTimeFormat('en', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(claimRecord.claimedAt),
    ),
  ).toBeVisible();
  await act(async () => selectLocale('zh-CN'));
  expect(
    screen.getByText(
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(claimRecord.claimedAt),
    ),
  ).toBeVisible();
});

test('English login succeeds with a trimmed distributor key', async () => {
  await english();
  const login = vi.fn<(init: RequestInit) => Response>(() => json(session));
  mockApi({ 'POST /api/login': login });
  const done = vi.fn();
  const user = userEvent.setup();
  render(<AuthDialog onClose={vi.fn()} onDone={done} />);
  await user.click(screen.getByRole('button', { name: /Use an existing key/ }));
  await user.type(screen.getByLabelText('Distributor key'), '  d_saved-key  ');
  await user.click(screen.getByRole('button', { name: 'Open workspace' }));
  expect(done).toHaveBeenCalledExactlyOnceWith(session);
  expect(JSON.parse(login.mock.calls[0][0].body as string)).toEqual({ key: 'd_saved-key' });
});
