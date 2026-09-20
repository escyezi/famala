import { Hono } from 'hono';
import { errorBody } from '../../shared/messages.ts';
import { clearSession, sessionCookie } from '../auth.ts';
import { createSpace, loginSession, revokeSession } from '../operations/sessions.ts';
import { turnstileConfig } from '../turnstile.ts';
import type { AppEnv } from '../types.ts';
import { loginInput } from '../validation.ts';

export const authRoutes = new Hono<AppEnv>()
  .get('/api/config', (c) => {
    const config = turnstileConfig(c.env, c.req.url);
    return c.json(
      { turnstileSiteKey: config?.siteKey ?? null, testMode: config?.testMode ?? false },
      200,
    );
  })
  .post('/api/spaces', async (c) => {
    const { key, token, spaceId, expiresAt } = await createSpace(c.env.DB);
    sessionCookie(c, token, expiresAt);
    return c.json({ key, spaceId, expiresAt }, 201);
  })
  .post('/api/login', loginInput, async (c) => {
    const { key } = c.req.valid('json');
    const session = await loginSession(c.env.DB, key);
    if (!session) return c.json(errorBody('INVALID_DISTRIBUTOR_KEY'), 401);
    const { token, spaceId, expiresAt } = session;
    sessionCookie(c, token, expiresAt);
    return c.json({ spaceId, expiresAt }, 200);
  })
  .get('/api/manage/session', (c) =>
    c.json({ spaceId: c.get('spaceId'), expiresAt: c.get('expiresAt') }, 200),
  )
  .post('/api/manage/logout', async (c) => {
    await revokeSession(c.env.DB, c.get('sessionId'));
    clearSession(c);
    return c.json({ ok: true }, 200);
  });
