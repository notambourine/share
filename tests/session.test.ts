import { describe, expect, it } from 'vitest';
import { session } from '../src/routes/session';
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
    expect(await authenticate(verb, env)).toBe('tom');
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
