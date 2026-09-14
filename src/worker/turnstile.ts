import type { Bindings } from './types.ts';
const testKey = /^[123]x0{10,}/;

export function turnstileConfig(env: Bindings, url: string) {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim();
  const hostnames = (env.TURNSTILE_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  const testMode = env.ENVIRONMENT === 'development' && local;
  if (!siteKey || !secretKey || !hostnames.length) return null;
  if (!testMode && (testKey.test(siteKey) || testKey.test(secretKey))) return null;
  return { siteKey, secretKey, hostnames, testMode };
}

export async function verifyTurnstile(env: Bindings, url: string, token: unknown) {
  const config = turnstileConfig(env, url);
  if (!config) return { ok: false, unavailable: true };
  if (typeof token !== 'string' || !token || token.length > 2048)
    return { ok: false, unavailable: false };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: config.secretKey, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, unavailable: true };
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    // Dummy tokens may return fixed test metadata. Only loopback development with
    // an official test secret allows this; production always checks claim + host.
    const dummy =
      config.testMode && testKey.test(config.secretKey) && token === 'XXXX.DUMMY.TOKEN.XXXX';
    const metadataMatches =
      result.action === 'claim' && config.hostnames.includes((result.hostname ?? '').toLowerCase());
    return { ok: result.success === true && (metadataMatches || dummy), unavailable: false };
  } catch {
    return { ok: false, unavailable: true };
  }
}
