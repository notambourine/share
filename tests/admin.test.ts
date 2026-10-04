import { describe, expect, it } from 'vitest';
import { now } from '../src/lib/clock';
import { decodeMeta } from '../src/lib/r2';
import type { TestEnv } from './bindings';
import { fetchWorker, testEnv } from './bindings';
import { signedIn } from './access';

const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const PREFIX = `${SPACE}/${HASH}`;
const ADMIN = `https://share.example/admin/${PREFIX}/`;
const NOW = now();
const DAY = 86400;

interface SeedOptions {
  createdAt?: number;
  files?: { path: string; size: number; type: string }[];
}

function seededEnv({
  createdAt = NOW,
  files = [{ path: 'deck.md', size: 6, type: 'text/markdown' }],
}: SeedOptions = {}): TestEnv {
  const meta = JSON.stringify({
    space: SPACE, hash: HASH, uploader: 'tom@notambourine.com',
    createdAt, expiresAt: null,
    files,
  });
  return testEnv({
    objects: {
      [`${PREFIX}/meta.json`]: meta,
      [`${PREFIX}/f/deck.md`]: '# deck',
    },
  });
}

function storedMeta(env: TestEnv) {
  const text = env.BUCKET.objects.get(`${PREFIX}/meta.json`);
  const meta = text === undefined ? null : decodeMeta(text);
  return meta ?? expect.fail('meta.json missing or undecodable');
}

async function as(init: RequestInit = {}, url = ADMIN, signed = true): Promise<Request> {
  const headers = new Headers(init.headers);
  if (signed) for (const [k, v] of Object.entries(await signedIn())) headers.set(k, v);
  return new Request(url, { ...init, headers });
}

describe('DELETE /admin/<space>/<hash>/', () => {
  it('soft-deletes for a signed-in caller', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, await as({ method: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(env.BUCKET.objects.has(`${PREFIX}/meta.json`)).toBe(false);
    expect(env.BUCKET.objects.has(`_trash/${PREFIX}/meta.json`)).toBe(true);
  });

  it('refuses an anonymous caller', async () => {
    const env = seededEnv();
    expect((await fetchWorker(env, await as({ method: 'DELETE' }, ADMIN, false))).status).toBe(401);
    expect(env.BUCKET.objects.has(`${PREFIX}/meta.json`)).toBe(true);
  });

  it('the public URL takes no DELETE at all', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, await as({ method: 'DELETE' }, `https://share.example/${PREFIX}/`));
    expect(res.status).toBe(405);
    expect(env.BUCKET.objects.has(`${PREFIX}/meta.json`)).toBe(true);
  });
});

function config(body: string, signed = true): Promise<Request> {
  return as({ method: 'POST', body }, `${ADMIN}config`, signed);
}

describe('POST /admin/<space>/<hash>/config', () => {
  it('writes the ttl and answers the rendered countdown', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, await config('{"ttl":"30d"}'));
    expect(res.status).toBe(200);
    const body = await res.json<{ expiresAt: number; expiry: string }>();
    expect(body.expiresAt).toBe(NOW + 30 * DAY);
    expect(body.expiry).toBe('expires in 30d');
    expect(storedMeta(env).expiresAt).toBe(NOW + 30 * DAY);
  });

  it('forever clears the expiry', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, await config('{"ttl":"forever"}'));
    expect(storedMeta(env).expiresAt).toBeNull();
    expect((await res.json<{ expiry: string }>()).expiry).toBe('never expires');
  });

  it('a ttl the artifact has outlived counts from the write, not from upload', async () => {
    const env = seededEnv({ createdAt: NOW - 10 * DAY });
    const res = await fetchWorker(env, await config('{"ttl":"7d"}'));
    const body = await res.json<{ expiresAt: number }>();
    expect(body.expiresAt).toBeGreaterThanOrEqual(NOW + 7 * DAY);
  });

  it('refuses an anonymous caller', async () => {
    const env = seededEnv();
    expect((await fetchWorker(env, await config('{"ttl":"30d"}', false))).status).toBe(401);
    expect(storedMeta(env).expiresAt).toBeNull();
  });

  it('rejects a body without a parseable ttl', async () => {
    const env = seededEnv();
    expect((await fetchWorker(env, await config('not json'))).status).toBe(400);
    expect((await fetchWorker(env, await config('{"ttl":"soon"}'))).status).toBe(400);
  });

  /* Public paths only read now, so a file named `config` keeps its GET. */
  it('a POST to the public path is refused', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, await as({ method: 'POST', body: '{"ttl":"forever"}' }, `https://share.example/${PREFIX}/config`));
    expect(res.status).toBe(405);
    expect(storedMeta(env).expiresAt).toBeNull();
  });
});

describe('GET /admin/<space>/<hash>/ - the working page', () => {
  const page = async (env: TestEnv) => fetchWorker(env, await as({ headers: { accept: 'text/html' } }));

  it('serves the page to a signed-in caller', async () => {
    const env = seededEnv();
    const res = await page(env);
    expect(res.status).toBe(200);
    const html = await res.text();
    // One tile for a markdown source: the PDF, deck-or-document from the content.
    expect(html).toContain('deck.pdf');
    expect(html.match(/class="tile"/g)).toHaveLength(1);
    expect(html).toContain('/admin.js');
    expect(html).toContain('data-ttl="forever"');
    // Tiles point at the public share, never back under /admin/.
    expect(html).toContain(`https://share.example/${PREFIX}/deck.pdf`);
  });

  it('refuses an anonymous caller', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, await as({}, ADMIN, false));
    expect(res.status).toBe(401);
  });

  it('nudges a bare path onto its trailing slash', async () => {
    const env = seededEnv();
    const res = await fetchWorker(env, await as({}, ADMIN.slice(0, -1)));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(ADMIN);
  });

  it('404s an artifact that does not exist', async () => {
    const env = testEnv();
    expect((await page(env)).status).toBe(404);
  });

  it('offers the text files as checkboxes and every generation as a button', async () => {
    const env = seededEnv({
      files: [
        { path: 'notes.txt', size: 40, type: 'text/plain' },
        { path: 'log.md', size: 60, type: 'text/markdown' },
        { path: 'hero.png', size: 900, type: 'image/png' },
      ],
    });
    const html = await (await page(env)).text();
    expect(html).toContain('value="notes.txt"');
    expect(html).toContain('value="log.md"');
    expect(html.match(/name="sources"/g)).toHaveLength(2);
    expect(html).not.toContain('value="hero.png"');
    for (const name of ['deck', 'agenda', 'renewal', 'ship-summary']) {
      expect(html).toContain(`value="${name}"`);
    }
    expect(html).toContain('action="generate"');
  });

  it('relaxes form-action to self on the working page alone', async () => {
    const env = seededEnv({ files: [{ path: 'notes.md', size: 40, type: 'text/markdown' }] });
    expect((await page(env)).headers.get('content-security-policy')).toContain("form-action 'self'");
    const pub = await fetchWorker(env, new Request(`https://share.test/${PREFIX}/`));
    expect(pub.headers.get('content-security-policy')).toContain("form-action 'none'");
  });

  it('leaves the generate panel off a share with no text in it', async () => {
    const env = seededEnv({ files: [{ path: 'hero.png', size: 900, type: 'image/png' }] });
    expect(await (await page(env)).text()).not.toContain('data-genform');
  });

  it('carries no poll hooks and no token grammar', async () => {
    const html = await (await page(seededEnv())).text();
    for (const gone of ['data-await', 'data-gen="1"', 'tstate', 'data-src', '?c=', 'data-countdown']) {
      expect(html).not.toContain(gone);
    }
  });
});
