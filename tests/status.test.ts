import { describe, expect, it } from 'vitest';
import { ADMIN_SECS, mintAdminToken } from '../src/lib/admin';
import { mintToken } from '../src/lib/sign';
import { checkKey, derivedKey } from '../src/lib/exportPath';
import { decodeSlideCheck } from '../src/lib/pdf';
import { adminStatus } from '../src/routes/admin';
import type { TestEnv } from './bindings';
import { testEnv } from './bindings';

const KEYS = { v1: 'unit-test-signing-secret' };
const SPACE = 'acme';
const HASH = 'Ab3dEf6hIj9k';
const NOW = Math.floor(Date.now() / 1000);
const EXP = NOW + ADMIN_SECS;

interface StatusBody {
  sources: { path: string; rendered: string[]; check: { slides: number; overflow: number[] } | null }[];
}

function seededEnv(extra: Record<string, string> = {}, files?: { path: string; size: number; type: string }[]): TestEnv {
  const meta = JSON.stringify({
    space: SPACE, hash: HASH, tier: 'open', uploader: 'tom',
    createdAt: NOW, expiresAt: null, idleTtl: null, lastAccess: NOW,
    files: files ?? [
      { path: 'deck.md', size: 6, type: 'text/markdown' },
      { path: 'notes.md', size: 6, type: 'text/markdown' },
      { path: 'hero.png', size: 9, type: 'image/png' },
    ],
  });
  return testEnv({
    signingKeys: JSON.stringify(KEYS),
    objects: { [`${SPACE}/${HASH}/meta.json`]: meta, ...extra },
  });
}

function statusReq(c: string | null): Request {
  const query = c === null ? '' : `?c=${c}`;
  return new Request(`https://share.example/${SPACE}/${HASH}/status${query}`);
}

describe('GET /<space>/<hash>/status', () => {
  it('answers readiness and the overflow verdict; pending sources ride along empty', async () => {
    const env = seededEnv({
      [derivedKey(SPACE, HASH, 'deck.md', 'slides', 'html')]: '<!doctype html>',
      [derivedKey(SPACE, HASH, 'deck.md', 'slides', 'pdf')]: 'PDFBYTES',
      [checkKey(SPACE, HASH, 'deck.md')]: '{"slides":12,"overflow":[7]}',
    });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const res = await adminStatus(statusReq(token), env, SPACE, HASH);
    expect(res.status).toBe(200);
    const body = await res.json<StatusBody>();
    // Markdown sources only: hero.png renders nothing and never appears.
    expect(body.sources).toEqual([
      { path: 'deck.md', rendered: ['slides.html', 'slides.pdf'], check: { slides: 12, overflow: [7] } },
      { path: 'notes.md', rendered: [], check: null },
    ]);
  });

  it('an undecodable check answers null rather than failing the report', async () => {
    const env = seededEnv({
      [derivedKey(SPACE, HASH, 'deck.md', 'slides', 'pdf')]: 'PDFBYTES',
      [checkKey(SPACE, HASH, 'deck.md')]: '{"slides":"twelve"}',
    });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    const body = await (await adminStatus(statusReq(token), env, SPACE, HASH)).json<StatusBody>();
    expect(body.sources[0]).toEqual({ path: 'deck.md', rendered: ['slides.pdf'], check: null });
  });

  it('refuses a missing, view, or expired token and names the re-open verb', async () => {
    const env = seededEnv();
    expect((await adminStatus(statusReq(null), env, SPACE, HASH)).status).toBe(401);
    const view = await mintToken(KEYS, `${SPACE}/${HASH}`, EXP);
    expect((await adminStatus(statusReq(view), env, SPACE, HASH)).status).toBe(401);
    const stale = await mintAdminToken(KEYS, SPACE, HASH, NOW - 1);
    const res = await adminStatus(statusReq(stale), env, SPACE, HASH);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain(`nt-share admin ${SPACE}/${HASH}`);
  });

  it('404s on a missing artifact', async () => {
    const env = testEnv({ signingKeys: JSON.stringify(KEYS) });
    const token = await mintAdminToken(KEYS, SPACE, HASH, EXP);
    expect((await adminStatus(statusReq(token), env, SPACE, HASH)).status).toBe(404);
  });

});

describe('decodeSlideCheck', () => {
  it('round-trips the shape and rejects the rest', () => {
    expect(decodeSlideCheck('{"slides":3,"overflow":[]}')).toEqual({ slides: 3, overflow: [] });
    expect(decodeSlideCheck('{"slides":3,"overflow":[1,3]}')).toEqual({ slides: 3, overflow: [1, 3] });
    expect(decodeSlideCheck('not json')).toBeNull();
    expect(decodeSlideCheck('{"overflow":[1]}')).toBeNull();
    expect(decodeSlideCheck('{"slides":3,"overflow":["7"]}')).toBeNull();
    expect(decodeSlideCheck('{"slides":3}')).toBeNull();
  });
});
