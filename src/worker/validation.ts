import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { validator } from 'hono/validator';
import { codePointLength, normalizeRemark } from '../shared/contracts.ts';
import type { AppEnv } from './types.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HTTPException(400, { message: '请求内容不是有效的 JSON 对象' });
  return value as Record<string, unknown>;
}

function claimKey(value: unknown) {
  if (typeof value !== 'string' || !/^c_[A-Za-z0-9_-]{43}$/.test(value.trim()))
    throw new HTTPException(404, { message: '领码 Key 无效，请检查后重试' });
  return value.trim();
}

export const loginInput = validator('json', (value: unknown, c) => {
  const { key } = object(value);
  if (typeof key !== 'string' || !/^d_[A-Za-z0-9_-]{43}$/.test(key.trim()))
    return c.json({ error: '发码 Key 无效，请检查后重试' }, 401);
  return { key: key.trim() };
});

export const poolNameInput = validator('json', (value: unknown, c) => {
  const { name } = object(value);
  if (typeof name !== 'string' || !name.trim()) return c.json({ error: '码池名称不能为空' }, 400);
  if (name.includes('\0')) return c.json({ error: '码池名称包含不支持的空字符' }, 400);
  return { name: name.trim() };
});

export const poolStatusInput = validator('json', (value: unknown, c) => {
  const { status } = object(value);
  if (status !== 'active' && status !== 'stopped') return c.json({ error: '无效的码池状态' }, 400);
  return { status } as const;
});

export const importInput = validator('json', (value: unknown, c) => {
  const { text } = object(value);
  if (typeof text !== 'string') return c.json({ error: '请提交每行一个的兑换码文本' }, 400);
  return { text };
});

export const claimKeyInput = validator('json', (value: unknown) => ({
  claimKey: claimKey(object(value).claimKey),
}));

export const claimInput = validator('json', (value: unknown, c) => {
  const data = object(value);
  const key = claimKey(data.claimKey);
  let remark;
  try {
    remark = normalizeRemark(data.remark);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
  if (
    typeof data.turnstileToken !== 'string' ||
    !data.turnstileToken ||
    data.turnstileToken.length > 2048
  )
    return c.json({ error: '人机验证失败或已过期，请重新验证', code: 'TURNSTILE_FAILED' }, 400);
  return {
    claimKey: key,
    ...(data.remark === undefined ? {} : { remark }),
    turnstileToken: data.turnstileToken,
  };
});

export const usedInput = validator('json', (value: unknown, c) => {
  const data = object(value);
  const key = claimKey(data.claimKey);
  if (typeof data.code !== 'string' || !data.code || codePointLength(data.code) > 100)
    return c.json({ error: '兑换码无效' }, 400);
  return { claimKey: key, code: data.code };
});

type CodeFilter = 'all' | 'claimed' | 'unclaimed';
// Hono's default query input allows arbitrary strings/arrays. Narrow the public
// RPC input to the values this validator actually accepts; keep parsed numbers
// on the server side only.
export const codesQuery: MiddlewareHandler<
  AppEnv,
  string,
  {
    in: { query: { page?: string; status?: CodeFilter; pageSize?: '20' | '50' } };
    out: { query: { page: number; status: CodeFilter; pageSize: number } };
  }
> = async (c, next) => {
  const query = c.req.queries();
  const page = Number(query.page?.[0] ?? '1');
  if (
    (query.page && query.page.length !== 1) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1_000_000
  )
    throw new HTTPException(400, { message: '无效的页码' });
  const status = query.status?.[0] || 'all';
  if (
    (query.status && query.status.length !== 1) ||
    (status !== 'all' && status !== 'claimed' && status !== 'unclaimed')
  )
    throw new HTTPException(400, { message: '无效的领取状态' });
  const size = query.pageSize?.[0] ?? '50';
  if ((query.pageSize && query.pageSize.length !== 1) || (size !== '20' && size !== '50'))
    throw new HTTPException(400, { message: '每页条数仅支持 20 或 50' });
  c.req.addValidatedData('query', { page, status, pageSize: Number(size) });
  await next();
};
