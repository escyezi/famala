import type { ApiResponses } from './helpers.ts';
import { expect, test } from 'vitest';
import { api, ApiError, rpc } from '../../src/react-app/api.ts';
import { json, mockApi, session } from './helpers.ts';

test('请求携带 Cookie、禁用缓存，无请求体的 POST 仍声明 JSON', async () => {
  const fetch = mockApi({
    'POST /api/spaces': () =>
      json({ key: 'new-key', ...session } satisfies ApiResponses['createSpace'], 201),
  });
  await api(rpc.api.spaces.$post());
  expect(fetch.mock.calls[0][1]).toMatchObject({
    credentials: 'same-origin',
    cache: 'no-store',
  });
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('Content-Type')).toBe('application/json');
});

test('路由和全局错误均转为 ApiError，非法成功响应可读地报错', async () => {
  mockApi({
    'POST /api/claim': () => json({ error: '已停止发放', code: 'POOL_STOPPED' }, 409),
    'GET /api/config': () => new Response('<html>proxy failed</html>', { status: 502 }),
  });
  await expect(
    api(rpc.api.claim.$post({ json: { claimKey: 'key', turnstileToken: 'token' } })),
  ).rejects.toMatchObject({ message: '已停止发放', status: 409, code: 'POOL_STOPPED' });
  await expect(api(rpc.api.config.$get())).rejects.toMatchObject({
    message: '请求失败，请稍后重试',
    status: 502,
  });
  mockApi({
    'GET /api/config': () =>
      new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
  });
  await expect(api(rpc.api.config.$get())).rejects.toMatchObject({
    message: '服务返回异常，请稍后重试',
    status: 500,
  });
  mockApi({ 'GET /api/config': () => new Response('<html>fallback</html>') });
  await expect(api(rpc.api.config.$get())).rejects.toBeInstanceOf(ApiError);
  mockApi({ 'GET /api/config': () => json(null) });
  await expect(api(rpc.api.config.$get())).rejects.toBeInstanceOf(ApiError);
});

test('取消信号原样传递，AbortError 不被改成网络错误', async () => {
  const aborted = new DOMException('Aborted', 'AbortError');
  const fetch = mockApi({
    'GET /api/config': () => {
      throw aborted;
    },
  });
  const controller = new AbortController();
  await expect(
    api(rpc.api.config.$get(undefined, { init: { signal: controller.signal } })),
  ).rejects.toBe(aborted);
  expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal);
});

test('普通网络错误转换为可读的 ApiError', async () => {
  mockApi({
    'GET /api/config': () => {
      throw new TypeError('Failed to fetch');
    },
  });
  await expect(api(rpc.api.config.$get())).rejects.toMatchObject({
    status: 0,
    message: '网络连接失败，请检查网络后重试。',
  });
});
