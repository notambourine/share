import { describe, expect, it } from 'vitest';
import type { Env } from '../src/lib/types';
import { upload } from '../src/routes/upload';
import { serve } from '../src/routes/serve';
import { mintSession, sha256hex } from '../src/lib/auth';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';

const CTX = {
  waitUntil: () => { /* prerender is fire-and-forget */ },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

async function stubEnv(): Promise<Env & { objects: Record<string, string>; links: Record<string, string> }> {
  const objects: Record<string, string> = {};
  const links: Record<string, string> = {};
  const env = {
    objects,
    links,
    BUCKET: {
      put: async (key: string, value: unknown) => {
        objects[key] = value instanceof Blob ? await value.text() : String(value);
      },
      get: async (key: string) => (key in objects ? {
        text: async () => objects[key],
        json: async () => JSON.parse(objects[key]),
        body: new Response(objects[key]).body,
        httpEtag: '"x"',
        size: objects[key].length,
      } : null),
      head: async (key: string) => (key in objects ? { httpEtag: '"x"', size: objects[key].length } : null),
    },
    LINKS: { put: async (key: string, value: string) => { links[key] = value; } },
    ASSETS: { fetch: async () => new Response('') },
    TOKENS: JSON.stringify({ tom: await sha256hex('raw-token') }),
    SIGNING_KEYS: JSON.stringify(KEYS),
  };
  return env as unknown as Env & { objects: Record<string, string>; links: Record<string, string> };
}

async function put(env: Env, auth: string, query = '', accept = 'application/json') {
  const form = new FormData();
  form.append('f', new Blob(['# hello\n']), 'note.md');
  const req = new Request(`https://share.test/up/${SPACE}${query}`, {
    method: 'POST', headers: { authorization: auth, accept }, body: form,
  });
  return upload(req, env, CTX, SPACE);
}

const sessionBearer = async () =>
  `Bearer ${await mintSession(KEYS, 'tom', Math.floor(Date.now() / 1000) + 300)}`;

describe('signed-tier upload mints its own link', () => {
  it('a session token gets a working signed URL with no vault token', async () => {
    const env = await stubEnv();
    const res = await put(env, await sessionBearer(), '?tier=signed');
    expect(res.status).toBe(201);
    const body = await res.json<{ url: string; hash: string; signedUrl: string; signedExp: number }>();

    const signed = new URL(body.signedUrl);
    const [, space, hash, k, token, ...rest] = signed.pathname.split('/');
    expect([space, hash, k]).toEqual([SPACE, body.hash, 'k']);
    expect(body.signedExp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const file = rest.join('/');
    const view = await serve(
      new Request(body.signedUrl, { headers: { accept: '*/*' } }),
      env, CTX, space, hash, token, file,
    );
    expect(view.status).toBe(200);
    expect(await view.text()).toContain('hello');
  });

  it('the bare URL still 401s, so the signed one is what put prints', async () => {
    const env = await stubEnv();
    const res = await put(env, 'Bearer raw-token', '?tier=signed', 'text/plain');
    const printed = (await res.text()).trim();
    expect(printed).toContain('/k/');

    const [, space, hash, ...rest] = new URL(printed).pathname.split('/');
    const view = await serve(
      new Request(`https://share.test/${space}/${hash}/${rest.slice(2).join('/')}`),
      env, CTX, space, hash, null, rest.slice(2).join('/'),
    );
    expect(view.status).toBe(401);
  });

  it('honors sign ttl and short, and rejects a bad sign duration', async () => {
    const env = await stubEnv();
    const res = await put(env, 'Bearer raw-token', '?tier=signed&sign=forever&short');
    const body = await res.json<{ signedExp: number; short: string }>();
    expect(body.signedExp).toBe(0);
    expect(body.short).toMatch(/\/z\/[A-Za-z0-9]{8}$/);
    expect(Object.keys(env.links)).toHaveLength(1);

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
