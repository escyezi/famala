import { errorBody } from '../shared/messages.ts';
import { and, eq, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { distributorSessions } from './db/schema.ts';
import type { AppEnv } from './types.ts';

const COOKIE = 'famala_session';
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export function randomKey(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    prefix +
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  );
}
export async function digest(value: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join('');
}
export function sessionCookie(c: Context<AppEnv>, token: string, expiresAt: number) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_MS / 1000,
    expires: new Date(expiresAt),
  });
}
export function clearSession(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(c.req.url).protocol === 'https:',
  });
}
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token || !/^s_[A-Za-z0-9_-]{43}$/.test(token)) return c.json(errorBody('UNAUTHORIZED'), 401);
  const session = await drizzle(c.env.DB)
    .select()
    .from(distributorSessions)
    .where(
      and(
        eq(distributorSessions.tokenHash, await digest(token)),
        gt(distributorSessions.expiresAt, Date.now()),
      ),
    )
    .get();
  if (!session) {
    clearSession(c);
    return c.json(errorBody('UNAUTHORIZED'), 401);
  }
  c.set('spaceId', session.spaceId);
  c.set('sessionId', session.id);
  c.set('expiresAt', session.expiresAt);
  await next();
});
