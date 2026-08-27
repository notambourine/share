import { describe, expect, it } from 'vitest';
import { ADMIN_SECS, ADMIN_SESSION_SECS, mintAdminToken, verifyAdminToken } from '../src/lib/admin';
import { mintToken, verifyToken } from '../src/lib/sign';
import { sha256hex } from '../src/lib/auth';
import { now } from '../src/lib/clock';
import { decodeMeta } from '../src/lib/r2';
import { adminConfig, adminRemint } from '../src/routes/admin';
import { del } from '../src/routes/del';
import type { TestEnv } from './bindings';
import { fetchWorker, testEnv } from './bindings';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const PREFIX = `${SPACE}/${HASH}`;
const NOW = now();
const EXP = NOW + ADMIN_SECS;
const DAY = 86400;

interface SeedOptions {
  createdAt?: number;
  tokens?: string;
  files?: { path: string; size: number; type: string }[];
}

function seededEnv({
  createdAt = NOW, tokens,
  files = [{ path: 'deck.md', size: 6, type: 'text/markdown' }],
}: SeedOptions = {}): TestEnv {
  const meta = JSON.stringify({
    space: SPACE, hash: HASH, uploader: 'tom',
    createdAt, expiresAt: null,
    files,
  });
  return testEnv({
    signingKeys: JSON.stringify(KEYS),
    tokens,
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

function delReq(c: string | null): Request {
  const query = c === null ? '' : `?c=${c}`;
  return new Request(`https://share.example/${SPACE}/${HASH}/${query}`, { method: 'DELETE' });
}

describe('admin token scope', () => {
  it('round-trips inside its window', async () => {
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await verifyAdminToken(KEYS, SPACE, HASH, token, NOW)).ok).toBe(true);
  });

  /* The scope string is what separates this credential from anything else the
     same key could ever sign: a token over the bare artifact prefix fails here
     on the signature rather than on a check someone has to remember to write. */
  it('a token over another scope fails, in both directions', async () => {
    const other = `${await mintToken(KEYS, `${PREFIX}@${NOW}`, EXP)}.${NOW}`;
    expect(await verifyAdminToken(KEYS, SPACE, HASH, other, NOW)).toMatchObject({
      ok: false, reason: 'bad-signature',
    });
    const admin = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect(await verifyToken(KEYS, PREFIX, admin.replace(/\.\d+$/, ''), NOW)).toMatchObject({
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

  /* The origin rides in the clear but under the signature, so moving it to buy
     a longer session fails on the signature, and an exp past the session fails
     even when correctly signed. */
  it('never outlives the session it was first minted in', async () => {
    const origin = NOW - ADMIN_SESSION_SECS;
    const past = await mintAdminToken(KEYS, SPACE, HASH, NOW + 60, origin);
    expect(await verifyAdminToken(KEYS, SPACE, HASH, past, NOW)).toMatchObject({ ok: false, reason: 'expired' });
    const live = await mintAdminToken(KEYS, SPACE, HASH, EXP, NOW - 60);
    const moved = live.replace(/\.\d+$/, `.${NOW}`);
    expect(await verifyAdminToken(KEYS, SPACE, HASH, moved, NOW)).toMatchObject({ ok: false, reason: 'bad-signature' });
    expect(await verifyAdminToken(KEYS, SPACE, HASH, live.replace(/\.\d+$/, ''), NOW)).toMatchObject({ reason: 'malformed' });
  });
});

describe('DELETE with ?c=', () => {
  it('a live admin token soft-deletes, no bearer needed', async () => {
    const env = seededEnv();
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const res = await del(delReq(token), env, SPACE, HASH);
    expect(res.status).toBe(204);
    expect(env.BUCKET.objects.has(`${PREFIX}/meta.json`)).toBe(false);
    expect(env.BUCKET.objects.has(`_trash/${PREFIX}/meta.json`)).toBe(true);
  });

  it('a token over another scope in c= is refused', async () => {
    const env = seededEnv();
    const view = await mintToken(KEYS, PREFIX, EXP);
    const res = await del(delReq(view), env, SPACE, HASH);
    expect(res.status).toBe(401);
    expect(env.BUCKET.objects.has(`${PREFIX}/meta.json`)).toBe(true);
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

  /* A leaked link could otherwise renew itself every five minutes forever. */
  it('a refresh is cut at the session hour, and the last one stops renewing', async () => {
    const env = seededEnv();
    const origin = NOW - ADMIN_SESSION_SECS + 90;
    const sent = await mintAdminToken(KEYS, SPACE, HASH, NOW + 60, origin);
    const res = await adminConfig(configReq(sent, '{"ttl":"30d"}'), env, SPACE, HASH);
    expect(res.status).toBe(200);
    const body = await res.json<{ c: string; exp: number }>();
    expect(body.exp).toBe(origin + ADMIN_SESSION_SECS);
    expect((await verifyAdminToken(KEYS, SPACE, HASH, body.c, NOW)).ok).toBe(true);
    // Its own exp is the end of the session, so a later refresh has no room left.
    expect((await verifyAdminToken(KEYS, SPACE, HASH, body.c, body.exp + 1)).ok).toBe(false);
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

  it('refuses a missing, foreign, or expired token and names the re-open verb', async () => {
    const env = seededEnv();
    expect((await adminConfig(configReq(null, '{"ttl":"30d"}'), env, SPACE, HASH)).status).toBe(401);
    const view = await mintToken(KEYS, PREFIX, EXP);
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

  it('refuses an anonymous caller and a wrong token', async () => {
    const env = seededEnv({ tokens: await TOKENS() });
    expect((await adminRemint(remintReq(null), env, SPACE, HASH)).status).toBe(401);
    expect((await adminRemint(remintReq('Bearer wrong'), env, SPACE, HASH)).status).toBe(401);
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
    // One tile for a markdown source: the PDF, deck-or-document from the content.
    expect(html).toContain('deck.pdf');
    expect(html.match(/class="tile"/g)).toHaveLength(1);
    // The retired grammar appears nowhere.
    for (const gone of ['deck.slides.pdf', 'deck.doc.pdf', 'deck.slides.html', 'deck.txt']) {
      expect(html).not.toContain(gone);
    }
    // The re-open verb, the page script, the TTL chips.
    expect(html).toContain(`nt-share admin ${SPACE}/${HASH}`);
    expect(html).toContain('/admin.js');
    expect(html).toContain('data-ttl="forever"');
    // The credential lives in the address bar only.
    expect(html).not.toContain(token);
    expect(html).not.toContain('?c=');
  });

  /* The generation half: which files feed it is the sender's pick, and the
     format buttons are the whole registry. */
  it('offers the text files as checkboxes and every generation as a button', async () => {
    const env = seededEnv({
      files: [
        { path: 'notes.txt', size: 40, type: 'text/plain' },
        { path: 'log.md', size: 60, type: 'text/markdown' },
        { path: 'hero.png', size: 900, type: 'image/png' },
      ],
    });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const html = await (await fetchWorker(env, pageReq(token))).text();
    expect(html).toContain('value="notes.txt"');
    expect(html).toContain('value="log.md"');
    expect(html.match(/name="sources"/g)).toHaveLength(2);
    // A picture is material a browser renders, never text a model composes from.
    expect(html).not.toContain('value="hero.png"');
    for (const name of ['deck', 'agenda', 'renewal', 'ship-summary']) {
      expect(html).toContain(`value="${name}"`);
    }
  });

  /* A form submits somewhere, so the page that carries one is the only page
     allowed to: every other shell can host uploaded HTML. */
  it('relaxes form-action to self on the working page alone', async () => {
    const env = seededEnv({ files: [{ path: 'notes.md', size: 40, type: 'text/markdown' }] });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const page = await fetchWorker(env, pageReq(token));
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self'");

    const pub = await fetchWorker(env, new Request(`https://share.test/${SPACE}/${HASH}/`));
    expect(pub.headers.get('content-security-policy')).toContain("form-action 'none'");
  });

  it('leaves the generate panel off a share with no text in it', async () => {
    const env = seededEnv({ files: [{ path: 'hero.png', size: 900, type: 'image/png' }] });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const html = await (await fetchWorker(env, pageReq(token))).text();
    expect(html).not.toContain('data-genform');
  });

  it('missing, expired, or foreign token falls through to the public index', async () => {
    const env = seededEnv();
    const bare = await (await fetchWorker(env, pageReq(null))).text();
    expect(bare).not.toContain('data-ttl');
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    const staleRes = await fetchWorker(env, pageReq(stale));
    expect(staleRes.status).toBe(200);
    expect(await staleRes.text()).toBe(bare);
    const view = await mintToken(KEYS, PREFIX, EXP);
    expect(await (await fetchWorker(env, pageReq(view))).text()).toBe(bare);
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

  /* Nothing polls any more: a tile is a real anchor and the Worker renders
     inline on the first GET, so the tab holds instead of a spinner lying. */
  it('carries no poll hooks at all', async () => {
    const env = seededEnv();
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const html = await (await fetchWorker(env, pageReq(token))).text();
    for (const gone of ['data-await', 'data-gen="1"', 'tstate', 'data-src']) {
      expect(html).not.toContain(gone);
    }
  });

  it('an uploaded page gets its two export tiles', async () => {
    const env = seededEnv({ files: [{ path: 'page.html', size: 9, type: 'text/html' }] });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const html = await (await fetchWorker(env, pageReq(token))).text();
    expect(html).toContain('page.pdf');
    expect(html).toContain('page.png');
    expect(html).not.toContain('page.full.png');
    // The page itself, plus the print and the shot.
    expect(html.match(/class="tile"/g)).toHaveLength(3);
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
