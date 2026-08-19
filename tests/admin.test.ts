import { describe, expect, it } from 'vitest';
import { ADMIN_SECS, mintAdminToken, verifyAdminToken } from '../src/lib/admin';
import { mintToken, verifyToken } from '../src/lib/sign';
import { sha256hex, mintSession } from '../src/lib/auth';
import { now } from '../src/lib/clock';
import { decodeMeta } from '../src/lib/r2';
import { adminConfig, adminRemint } from '../src/routes/admin';
import { del } from '../src/routes/del';
import type { TestEnv } from './bindings';
import { fetchWorker, testEnv } from './bindings';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const VIEW_PREFIX = `${SPACE}/${HASH}`;
const NOW = now();
const EXP = NOW + ADMIN_SECS;
const DAY = 86400;

interface SeedOptions {
  tier?: 'open' | 'signed';
  createdAt?: number;
  tokens?: string;
  files?: { path: string; size: number; type: string }[];
}

function seededEnv({
  tier = 'open', createdAt = NOW, tokens,
  files = [{ path: 'deck.md', size: 6, type: 'text/markdown' }],
}: SeedOptions = {}): TestEnv {
  const meta = JSON.stringify({
    space: SPACE, hash: HASH, tier, uploader: 'tom',
    createdAt, expiresAt: null,
    files,
  });
  return testEnv({
    signingKeys: JSON.stringify(KEYS),
    tokens,
    objects: {
      [`${VIEW_PREFIX}/meta.json`]: meta,
      [`${VIEW_PREFIX}/f/deck.md`]: '# deck',
    },
  });
}

function storedMeta(env: TestEnv) {
  const text = env.BUCKET.objects.get(`${VIEW_PREFIX}/meta.json`);
  const meta = text === undefined ? null : decodeMeta(text);
  return meta ?? expect.fail('meta.json missing or undecodable');
}

function delReq(c: string | null): Request {
  const query = c === null ? '' : `?c=${c}`;
  return new Request(`https://share.example/${SPACE}/${HASH}/${query}`, { method: 'DELETE' });
}

describe('admin token scope', () => {
  it('round-trips inside its window', async () => {
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await verifyAdminToken(KEYS, SPACE, HASH, token, NOW)).ok).toBe(true);
  });

  it('a view token fails the admin check', async () => {
    const view = await mintToken(KEYS, VIEW_PREFIX, EXP);
    expect(await verifyAdminToken(KEYS, SPACE, HASH, view, NOW)).toMatchObject({
      ok: false, reason: 'bad-signature',
    });
  });

  it('an admin token fails the view check', async () => {
    const admin = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect(await verifyToken(KEYS, VIEW_PREFIX, admin, NOW)).toMatchObject({
      ok: false, reason: 'bad-signature',
    });
  });

  it('admits nothing beyond its one artifact', async () => {
    const admin = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await verifyAdminToken(KEYS, SPACE, 'Zz9dEf6hIj9k', admin, NOW)).ok).toBe(false); // gitleaks:allow
    expect((await verifyAdminToken(KEYS, 'other', HASH, admin, NOW)).ok).toBe(false);
  });

  it('expires, and exp=0 never verifies', async () => {
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    expect(await verifyAdminToken(KEYS, SPACE, HASH, stale, NOW)).toMatchObject({
      ok: false, reason: 'expired',
    });
    const forever = await mintAdminToken(KEYS, SPACE, HASH, 0);
    expect(await verifyAdminToken(KEYS, SPACE, HASH, forever, NOW)).toMatchObject({
      ok: false, reason: 'expired',
    });
  });
});

describe('DELETE with ?c=', () => {
  it('a live admin token soft-deletes, no bearer needed', async () => {
    const env = seededEnv();
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const res = await del(delReq(token), env, SPACE, HASH);
    expect(res.status).toBe(204);
    expect(env.BUCKET.objects.has(`${VIEW_PREFIX}/meta.json`)).toBe(false);
    expect(env.BUCKET.objects.has(`_trash/${VIEW_PREFIX}/meta.json`)).toBe(true);
  });

  it('a view token in c= is refused', async () => {
    const env = seededEnv();
    const view = await mintToken(KEYS, VIEW_PREFIX, EXP);
    const res = await del(delReq(view), env, SPACE, HASH);
    expect(res.status).toBe(401);
    expect(env.BUCKET.objects.has(`${VIEW_PREFIX}/meta.json`)).toBe(true);
  });

  it('an expired admin token is refused', async () => {
    const env = seededEnv();
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    expect((await del(delReq(stale), env, SPACE, HASH)).status).toBe(401);
  });

  it("one artifact's admin token cannot delete another", async () => {
    const env = seededEnv();
    const other = await mintAdminToken(KEYS, SPACE, 'Zz9dEf6hIj9k', EXP); // gitleaks:allow
    expect((await del(delReq(other), env, SPACE, HASH)).status).toBe(401);
  });
});

function configReq(c: string | null, body: string): Request {
  const query = c === null ? '' : `?c=${c}`;
  return new Request(`https://share.example/${SPACE}/${HASH}/config${query}`, { method: 'POST', body });
}

describe('POST /<space>/<hash>/config', () => {
  it('writes the ttl and answers a fresh token plus the rendered countdown', async () => {
    const env = seededEnv();
    // Minted a minute ago: the slide shows as a later exp on the answer. The
    // token is a deterministic HMAC, so same-second bytes would be identical.
    const sent = await mintAdminToken(KEYS, SPACE, HASH, NOW + ADMIN_SECS - 60);
    const res = await adminConfig(configReq(sent, '{"ttl":"30d"}'), env, SPACE, HASH);
    expect(res.status).toBe(200);
    const body = await res.json<{ c: string; exp: number; expiresAt: number; expiry: string }>();
    expect(body.expiresAt).toBe(NOW + 30 * DAY);
    // The page prints this rather than re-deriving it from expiresAt.
    expect(body.expiry).toBe('expires in 30d');
    // A whole fresh window, not the sent token's. The route reads its own
    // clock, so a tick past this file's NOW is the only slack allowed.
    expect(body.exp).toBeGreaterThanOrEqual(EXP);
    expect(body.exp).toBeLessThan(EXP + 60);
    expect(Number(body.c.split('.')[1])).toBeGreaterThan(Number(sent.split('.')[1]));
    expect((await verifyAdminToken(KEYS, SPACE, HASH, body.c, NOW)).ok).toBe(true);
    expect(storedMeta(env).expiresAt).toBe(NOW + 30 * DAY);
  });

  it('forever clears the expiry', async () => {
    const env = seededEnv();
    const sent = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const res = await adminConfig(configReq(sent, '{"ttl":"forever"}'), env, SPACE, HASH);
    expect(res.status).toBe(200);
    expect(storedMeta(env).expiresAt).toBeNull();
    expect((await res.json<{ expiry: string }>()).expiry).toBe('never expires');
  });

  it('a ttl the artifact has outlived counts from the write, not from upload', async () => {
    const env = seededEnv({ createdAt: NOW - 10 * DAY });
    const sent = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const res = await adminConfig(configReq(sent, '{"ttl":"7d"}'), env, SPACE, HASH);
    expect(res.status).toBe(200);
    const body = await res.json<{ expiresAt: number }>();
    expect(body.expiresAt).toBeGreaterThanOrEqual(NOW + 7 * DAY);
  });

  it('refuses a missing, view, or expired token and names the re-open verb', async () => {
    const env = seededEnv();
    expect((await adminConfig(configReq(null, '{"ttl":"30d"}'), env, SPACE, HASH)).status).toBe(401);
    const view = await mintToken(KEYS, VIEW_PREFIX, EXP);
    expect((await adminConfig(configReq(view, '{"ttl":"30d"}'), env, SPACE, HASH)).status).toBe(401);
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    const res = await adminConfig(configReq(stale, '{"ttl":"30d"}'), env, SPACE, HASH);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain(`nt-share admin ${SPACE}/${HASH}`);
    expect(storedMeta(env).expiresAt).toBeNull();
  });

  it('rejects a body without a parseable ttl', async () => {
    const env = seededEnv();
    const sent = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await adminConfig(configReq(sent, 'not json'), env, SPACE, HASH)).status).toBe(400);
    expect((await adminConfig(configReq(sent, '{"ttl":"soon"}'), env, SPACE, HASH)).status).toBe(400);
  });
});

describe('POST /<space>/<hash>/admin', () => {
  const TOKENS = async () => JSON.stringify({ tom: await sha256hex('raw-token') });

  function remintReq(auth: string | null): Request {
    return new Request(`https://share.example/${SPACE}/${HASH}/admin`, {
      method: 'POST', headers: auth ? { authorization: auth } : {},
    });
  }

  it('a vault token mints the admin url', async () => {
    const env = seededEnv({ tokens: await TOKENS() });
    const res = await adminRemint(remintReq('Bearer raw-token'), env, SPACE, HASH);
    expect(res.status).toBe(200);
    const body = await res.json<{ url: string; exp: number }>();
    expect(body.exp).toBeGreaterThan(NOW);
    const c = new URL(body.url).searchParams.get('c');
    expect(body.url.startsWith(`https://share.example/${SPACE}/${HASH}/?c=`)).toBe(true);
    expect(c && (await verifyAdminToken(KEYS, SPACE, HASH, c, NOW)).ok).toBe(true);
  });

  it('refuses sessions and anonymous callers', async () => {
    const env = seededEnv({ tokens: await TOKENS() });
    expect((await adminRemint(remintReq(null), env, SPACE, HASH)).status).toBe(401);
    const sess = await mintSession(KEYS, 'tom', NOW + 600);
    const res = await adminRemint(remintReq(`Bearer ${sess}`), env, SPACE, HASH);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('only authorizes /up');
  });

  it('404s on a missing artifact', async () => {
    const env = testEnv({ signingKeys: JSON.stringify(KEYS), tokens: await TOKENS() });
    expect((await adminRemint(remintReq('Bearer raw-token'), env, SPACE, HASH)).status).toBe(404);
  });
});

describe('GET /<space>/<hash>/?c= - the admin page', () => {
  function pageReq(c: string | null): Request {
    const query = c === null ? '' : `?c=${c}`;
    return new Request(`https://share.example/${SPACE}/${HASH}/${query}`, {
      headers: { accept: 'text/html' },
    });
  }

  it('a live token serves the page, and the token leaks into no link', async () => {
    const env = seededEnv();
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const res = await fetchWorker(env, pageReq(token));
    expect(res.status).toBe(200);
    const html = await res.text();
    // Five tiles for a single markdown upload: two live views, two PDFs, the source.
    expect(html).toContain('deck.slides.html');
    expect(html).toContain('deck.doc.html');
    expect(html).toContain('deck.slides.pdf');
    expect(html).toContain('deck.doc.pdf');
    expect(html).toContain('deck.txt');
    // The re-open verb, the page script, the TTL chips.
    expect(html).toContain(`nt-share admin ${SPACE}/${HASH}`);
    expect(html).toContain('/admin.js');
    expect(html).toContain('data-ttl="forever"');
    // The credential lives in the address bar only.
    expect(html).not.toContain(token);
    expect(html).not.toContain('?c=');
  });

  it('missing, expired, or view token falls through to today\'s view', async () => {
    const env = seededEnv();
    const bare = await (await fetchWorker(env, pageReq(null))).text();
    expect(bare).not.toContain('data-ttl');
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    const staleRes = await fetchWorker(env, pageReq(stale));
    expect(staleRes.status).toBe(200);
    expect(await staleRes.text()).toBe(bare);
    const view = await mintToken(KEYS, VIEW_PREFIX, EXP);
    expect(await (await fetchWorker(env, pageReq(view))).text()).toBe(bare);
  });

  it('signed tier: a live c= wins the 401 and the links ride a fresh /k/', async () => {
    const env = seededEnv({ tier: 'signed' });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const res = await fetchWorker(env, pageReq(token));
    expect(res.status).toBe(200);
    const html = await res.text();
    const k = /\/k\/(v1\.\d+\.[A-Za-z0-9_-]{22})\/deck\.slides\.html/.exec(html);
    expect(k).not.toBeNull();
    expect((await verifyToken(KEYS, VIEW_PREFIX, k![1], NOW)).ok).toBe(true);
    // Expired c= falls through to the tier's own answer.
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    expect((await fetchWorker(env, pageReq(stale))).status).toBe(401);
  });

  it('c= never wins a file path, only the artifact root', async () => {
    const env = seededEnv();
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const req = new Request(`https://share.example/${SPACE}/${HASH}/deck.md?c=${token}`, {
      headers: { accept: 'text/html' },
    });
    const html = await (await fetchWorker(env, req)).text();
    expect(html).not.toContain('data-ttl');
  });

  it('markdown tiles carry the hooks the status poll paints', async () => {
    const env = seededEnv();
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const html = await (await fetchWorker(env, pageReq(token))).text();
    expect(html).toContain('data-src="deck.md" data-await="slides.pdf"');
    expect(html).toContain('data-src="deck.md" data-await="doc.pdf"');
    /* Only the PDFs wait on a browser. The two html tiles render per request, so
       they are ready on arrival and have no state to paint; the txt tile derives
       nothing at all. */
    expect(html.match(/data-await/g)).toHaveLength(2);
    expect(html.match(/class="tstate"/g)).toHaveLength(2);
    expect(html.match(/data-gen="1"/g)).toHaveLength(2);
  });

  it('an uploaded page gets its click-to-generate export tiles', async () => {
    const env = seededEnv({ files: [{ path: 'page.html', size: 9, type: 'text/html' }] });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const html = await (await fetchWorker(env, pageReq(token))).text();
    expect(html).toContain('page.pdf');
    expect(html).toContain('page.png');
    expect(html).not.toContain('page.browser.png');
    expect(html).toContain('data-src="page.html" data-await="page.full.png" data-gen="1"');
    // Two exports generate on click; the page tile itself awaits nothing.
    expect(html.match(/data-gen/g)).toHaveLength(2);
    expect(html.match(/data-await/g)).toHaveLength(2);
  });

  it('a folder with an index.html reads as one site tile', async () => {
    const env = seededEnv({
      files: [
        { path: 'index.html', size: 100, type: 'text/html; charset=utf-8' },
        { path: 'style.css', size: 40, type: 'text/css; charset=utf-8' },
        { path: 'hero.png', size: 900, type: 'image/png' },
      ],
    });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const html = await (await fetchWorker(env, pageReq(token))).text();
    expect(html).toContain('>site<');
    expect(html).not.toContain('hotlink'); // never a tile per asset
    expect(html).toContain('index.html'); // the plain file list still names them
  });
});

describe('view routes with an admin token', () => {
  it('the /k/ slot refuses an admin token where a view token works', async () => {
    const env = seededEnv({ tier: 'signed' });
    const at = (token: string) =>
      new Request(`https://share.example/${SPACE}/${HASH}/k/${token}/deck.md`);
    const admin = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await fetchWorker(env, at(admin))).status).toBe(401);
    const view = await mintToken(KEYS, VIEW_PREFIX, EXP);
    expect((await fetchWorker(env, at(view))).status).toBe(200);
  });
});
