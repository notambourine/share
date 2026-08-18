import { describe, expect, it } from 'vitest';
import type { Env } from '../src/lib/types';
import { upload } from '../src/routes/upload';
import { adminConfig } from '../src/routes/admin';
import { mintSession, sha256hex } from '../src/lib/auth';
import { now } from '../src/lib/http';
import type { TestEnv } from './bindings';
import { fetchWorker, testEnv } from './bindings';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';

async function stubEnv(): Promise<TestEnv> {
  return testEnv({
    tokens: JSON.stringify({ tom: await sha256hex('raw-token') }),
    signingKeys: JSON.stringify(KEYS),
  });
}

async function put(env: Env, auth: string, query = '', accept = 'application/json') {
  const form = new FormData();
  form.append('f', new Blob(['# hello\n']), 'note.md');
  const req = new Request(`https://share.test/up/${SPACE}${query}`, {
    method: 'POST', headers: { authorization: auth, accept }, body: form,
  });
  return upload(req, env, SPACE);
}

const sessionBearer = async () =>
  `Bearer ${await mintSession(KEYS, 'tom', now() + 300)}`;

describe('signed-tier upload mints its own link', () => {
  it('a session token gets a working signed URL with no vault token', async () => {
    const env = await stubEnv();
    const res = await put(env, await sessionBearer(), '?tier=signed');
    expect(res.status).toBe(201);
    const body = await res.json<{ url: string; hash: string; signedUrl: string; signedExp: number }>();

    const signed = new URL(body.signedUrl);
    const [, space, hash, k] = signed.pathname.split('/');
    expect([space, hash, k]).toEqual([SPACE, body.hash, 'k']);
    expect(body.signedExp).toBeGreaterThan(now());

    // The router does the /k/ split, so the minted URL is handed over whole.
    const view = await fetchWorker(env, new Request(body.signedUrl, { headers: { accept: '*/*' } }));
    expect(view.status).toBe(200);
    expect(await view.text()).toContain('hello');
  });

  it('the bare URL still 401s, so the signed one is what put prints', async () => {
    const env = await stubEnv();
    const res = await put(env, 'Bearer raw-token', '?tier=signed', 'text/plain');
    const printed = (await res.text()).trim();
    expect(printed).toContain('/k/');

    const [, space, hash, , , ...rest] = new URL(printed).pathname.split('/');
    const view = await fetchWorker(env, new Request(`https://share.test/${space}/${hash}/${rest.join('/')}`));
    expect(view.status).toBe(401);
  });

  it('honors sign ttl and short, and rejects a bad sign duration', async () => {
    const env = await stubEnv();
    const res = await put(env, 'Bearer raw-token', '?tier=signed&sign=forever&short');
    const body = await res.json<{ signedExp: number; short: string }>();
    expect(body.signedExp).toBe(0);
    expect(body.short).toMatch(/\/z\/[A-Za-z0-9]{8}$/);
    expect(env.LINKS.records.size).toBe(1);

    expect((await put(await stubEnv(), 'Bearer raw-token', '?tier=signed&sign=nope')).status).toBe(400);
  });

  it('an open upload mints nothing', async () => {
    const env = await stubEnv();
    const res = await put(env, await sessionBearer(), '');
    const body = await res.json<{ url: string; signedUrl?: string }>();
    expect(body.signedUrl).toBeUndefined();
    expect(body.url).not.toContain('/k/');
  });
});

describe('put answers the admin link', () => {
  it('mints a working admin link alongside the upload', async () => {
    const env = await stubEnv();
    const res = await put(env, await sessionBearer(), '');
    const body = await res.json<{ hash: string; adminUrl: string; adminExp: number }>();
    expect(body.adminExp).toBeGreaterThan(now());

    const admin = new URL(body.adminUrl);
    expect(admin.pathname).toBe(`/${SPACE}/${body.hash}/`);
    const c = admin.searchParams.get('c');

    // Works, not just parses: the token authorizes the config write.
    const write = await adminConfig(new Request(
      `https://share.test/${SPACE}/${body.hash}/config?c=${c}`,
      { method: 'POST', body: JSON.stringify({ ttl: '7d' }) },
    ), env, SPACE, body.hash);
    expect(write.status).toBe(200);
  });

  it('the plain-text answer stays the one hand-over URL', async () => {
    const env = await stubEnv();
    const res = await put(env, 'Bearer raw-token', '', 'text/plain');
    const printed = (await res.text()).trim();
    expect(printed).not.toContain('?c=');
    expect(printed.split('\n')).toHaveLength(1);
  });

  it('missing signing keys drop the admin link, not the open upload', async () => {
    const env = testEnv({ tokens: JSON.stringify({ tom: await sha256hex('raw-token') }) });
    const res = await put(env, 'Bearer raw-token', '');
    expect(res.status).toBe(201);
    const body = await res.json<{ adminUrl?: string }>();
    expect(body.adminUrl).toBeUndefined();
  });
});
