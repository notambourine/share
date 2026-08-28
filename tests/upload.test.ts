import { describe, expect, it } from 'vitest';
import type { Env } from '../src/lib/types';
import { upload } from '../src/routes/upload';
import { adminConfig } from '../src/routes/admin';
import { sha256hex } from '../src/lib/auth';
import { now } from '../src/lib/clock';
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

describe('one upload, one URL', () => {
  it('answers the public URL and serves it', async () => {
    const env = await stubEnv();
    const res = await put(env, 'Bearer raw-token');
    expect(res.status).toBe(201);
    const body = await res.json<{ url: string; hash: string; files: string[] }>();
    expect(body.files).toEqual(['note.md']);
    expect(body.url).toBe(`https://share.test/${SPACE}/${body.hash}/note.md`);

    const view = await fetchWorker(env, new Request(body.url, { headers: { accept: '*/*' } }));
    expect(view.status).toBe(200);
    expect(await view.text()).toContain('hello');
  });

  /* The tier is gone, so a param nobody ships is simply ignored rather than
     answering a second URL nobody can use. */
  it('mints no second link and takes no tier', async () => {
    const env = await stubEnv();
    const body = await (await put(env, 'Bearer raw-token', '?tier=signed'))
      .json<{ url: string; signedUrl?: string }>();
    expect(body.signedUrl).toBeUndefined();
    expect(body.url).not.toContain('/k/');
  });

  it('rejects a bad ttl before a byte lands', async () => {
    const env = await stubEnv();
    expect((await put(env, 'Bearer raw-token', '?ttl=nope')).status).toBe(400);
    expect(env.BUCKET.objects.size).toBe(0);
  });

  it('refuses an anonymous caller', async () => {
    expect((await put(await stubEnv(), 'Bearer wrong')).status).toBe(401);
  });
});

describe('put answers the working-page link', () => {
  it('mints a working link alongside the upload', async () => {
    const env = await stubEnv();
    const res = await put(env, 'Bearer raw-token');
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

  it('missing signing keys drop the working link, not the upload', async () => {
    const env = testEnv({ tokens: JSON.stringify({ tom: await sha256hex('raw-token') }) });
    const res = await put(env, 'Bearer raw-token', '');
    expect(res.status).toBe(201);
    const body = await res.json<{ adminUrl?: string }>();
    expect(body.adminUrl).toBeUndefined();
  });
});
