import { describe, expect, it } from 'vitest';
import { session } from '../src/routes/session';
import { del } from '../src/routes/del';
import { upload } from '../src/routes/upload';
import { authenticate, mintSession, sha256hex } from '../src/lib/auth';
import type { Env } from '../src/lib/types';

const KEYS = { v1: 'unit-test-signing-secret' };

async function makeEnv(): Promise<Env> {
  return {
    TOKENS: JSON.stringify({ tom: await sha256hex('raw-token') }),
    SIGNING_KEYS: JSON.stringify(KEYS),
  } as Env;
}

function post(auth: string | null, ttl?: string): Request {
  const url = `https://share.example/session${ttl ? `?ttl=${ttl}` : ''}`;
  return new Request(url, {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  });
}

describe('POST /session', () => {
  it('trades a raw token for a working session token', async () => {
    const env = await makeEnv();
    const res = await session(post('Bearer raw-token'), env);
    expect(res.status).toBe(201);
    const body = await res.json<{ token: string; name: string; expiresAt: number }>();
    expect(body.name).toBe('tom');
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const verb = new Request('https://share.example/up/acme', {
      method: 'POST', headers: { authorization: `Bearer ${body.token}` },
    });
    const a = await authenticate(verb, env);
    expect(a.name).toBe('tom');
    expect(a.session).toBe(true);
  });

  it('rejects anonymous callers and session tokens', async () => {
    const env = await makeEnv();
    expect((await session(post(null), env)).status).toBe(401);
    const sess = await mintSession(KEYS, 'tom', Math.floor(Date.now() / 1000) + 600);
    expect((await session(post(`Bearer ${sess}`), env)).status).toBe(401);
  });

  it('caps ttl at 1h and rejects forever', async () => {
    const env = await makeEnv();
    expect((await session(post('Bearer raw-token', '2h'), env)).status).toBe(400);
    expect((await session(post('Bearer raw-token', 'forever'), env)).status).toBe(400);
    const res = await session(post('Bearer raw-token', '1h'), env);
    expect(res.status).toBe(201);
  });
});

describe('session scope and expiry messages', () => {
  const bearer = async (exp: number) => `Bearer ${await mintSession(KEYS, 'tom', exp)}`;
  const t = Math.floor(Date.now() / 1000);

  it('an expired session on upload 401s with the reason', async () => {
    const env = await makeEnv();
    const r = new Request('https://share.example/up/acme', {
      method: 'POST', headers: { authorization: await bearer(t - 60) },
    });
    const res = await upload(r, env, {} as ExecutionContext, 'acme');
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('session expired');
  });

  it('a live session cannot delete', async () => {
    const env = await makeEnv();
    const r = new Request('https://share.example/acme/Ab3dEf6hIj9k/', {
      method: 'DELETE', headers: { authorization: await bearer(t + 300) },
    });
    const res = await del(r, env, 'acme', 'Ab3dEf6hIj9k');
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('only authorizes /up');
  });
});
